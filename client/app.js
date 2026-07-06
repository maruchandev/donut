const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
const MAX_ENTRIES = 200;
const WAITING_CLS = 'sub waiting';

let ws = null;
let recognition = null;
let isRecording = false;
let uttId = 0;
let clientId = '';
let localInterim = null;
let nickCustomized = false;
let intentionalClose = false;

const logEl = document.getElementById('log');
const emptyState = document.getElementById('emptyState');
const emptyText = document.getElementById('emptyText');
const statusMsg = document.getElementById('statusMsg');
const connDot = document.getElementById('connDot');
const connLabel = document.getElementById('connLabel');
const myLang = document.getElementById('myLang');
const dirHint = document.getElementById('dirHint');
const spkInput = document.getElementById('spkInput');
const recordBtn = document.getElementById('recordBtn');
const textInput = document.getElementById('textInput');
const sendBtn = document.getElementById('sendBtn');
const inputHint = document.getElementById('inputHint');

const SR_LANG = { ja: 'ja-JP', ko: 'ko-KR' };

const SPEAKER_COLORS = [
  '#3d8bfd', '#a371f7', '#f778ba', '#ffa657',
  '#79c0ff', '#56d364', '#e3b341', '#ff7b72',
];

var fallbackLang = (navigator.language || 'en').slice(0, 2);
var UI = (fallbackLang === 'ko' || fallbackLang === 'ja') ? fallbackLang : 'en';
var TXT = {
  ja: {
    lang: '話す言語', nick: 'ニックネーム', ph: 'なまえ',
    conn: '接続済', disc: '切断', recon: '再接続中...',
    ready: '準備完了', rec: '録音', stop: '停止',
    recOn: '録音中', recOff: '停止', send: '送信',
    inputPh: 'テキストを入力...',
    inputHint: 'Enter で送信 · Ctrl+Enter で改行',
    empty: '録音ボタンまたはテキスト入力で翻訳を始めましょう',
    waiting: '翻訳中',
    errPrefix: 'エラー',
    noSpeech: '音声認識に対応していないブラウザです',
    dir: { ja: '→ 한국어', ko: '→ 日本語' },
  },
  ko: {
    lang: '내 언어', nick: '닉네임', ph: '이름',
    conn: '연결됨', disc: '연결 끊김', recon: '재연결 중...',
    ready: '준비 완료', rec: '녹음', stop: '중지',
    recOn: '녹음 중', recOff: '중지', send: '보내기',
    inputPh: '텍스트 입력...',
    inputHint: 'Enter 전송 · Ctrl+Enter 줄바꿈',
    empty: '녹음 버튼이나 텍스트 입력으로 번역을 시작하세요',
    waiting: '번역 중',
    errPrefix: '오류',
    noSpeech: '이 브라우저는 음성 인식을 지원하지 않습니다',
    dir: { ja: '→ 한국어', ko: '→ 日本語' },
  },
  en: {
    lang: 'My language', nick: 'Nickname', ph: 'name',
    conn: 'Connected', disc: 'Disconnected', recon: 'Reconnecting...',
    ready: 'Ready', rec: 'Record', stop: 'Stop',
    recOn: 'Recording', recOff: 'Stopped', send: 'Send',
    inputPh: 'Type a message...',
    inputHint: 'Enter to send · Ctrl+Enter for newline',
    empty: 'Press Record or type a message to start translating',
    waiting: 'Translating',
    errPrefix: 'Error',
    noSpeech: 'Speech recognition is not supported in this browser',
    dir: { ja: '→ Korean', ko: '→ Japanese' },
  },
};

function applyUI() {
  var t = TXT[UI];
  document.documentElement.lang = UI;
  document.getElementById('hintLang').textContent = t.lang;
  document.getElementById('hintNick').textContent = t.nick;
  spkInput.placeholder = t.ph;
  textInput.placeholder = t.inputPh;
  inputHint.textContent = t.inputHint;
  emptyText.textContent = t.empty;
  sendBtn.textContent = t.send;
  recordBtn.textContent = t.rec;
}

function speakerColor(name) {
  var h = 0;
  for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return SPEAKER_COLORS[h % SPEAKER_COLORS.length];
}

function updateEmptyState() {
  var hasEntries = logEl.querySelector('.entry');
  emptyState.style.display = hasEntries ? 'none' : 'flex';
}

function trimEntries() {
  var keys = Object.keys(entries);
  if (keys.length <= MAX_ENTRIES) return;
  var sorted = keys.sort(function(a, b) {
    return (entries[a].row.dataset.ts || 0) - (entries[b].row.dataset.ts || 0);
  });
  var remove = sorted.slice(0, keys.length - MAX_ENTRIES);
  for (var i = 0; i < remove.length; i++) {
    var uid = remove[i];
    if (entries[uid] && entries[uid].row.parentNode) {
      entries[uid].row.remove();
    }
    delete entries[uid];
  }
}

var micStream = null;

function requestMic() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  navigator.mediaDevices.getUserMedia({audio: true}).then(function(s) {
    micStream = s;
  }).catch(function() {});
}

function connect() {
  intentionalClose = false;
  ws = new WebSocket(WS_URL);
  ws.onopen = function() {
    connDot.className = 'dot on';
    connLabel.textContent = TXT[UI].conn;
    recordBtn.disabled = false;
    textInput.disabled = false;
    sendBtn.disabled = false;
    textInput.focus();
    clientId = Math.random().toString(36).slice(2, 6);
    dirHint.textContent = TXT[UI].dir[myLang.value];
    setStatus(TXT[UI].conn);
    ws.send(JSON.stringify({ type: 'init', lang: myLang.value }));
  };
  ws.onclose = function() {
    connDot.className = 'dot off';
    connLabel.textContent = TXT[UI].disc;
    recordBtn.disabled = true;
    textInput.disabled = true;
    sendBtn.disabled = true;
    if (isRecording) stopRecording();
    if (!intentionalClose) {
      setStatus(TXT[UI].recon);
      setTimeout(connect, 2000);
    }
  };
  ws.onmessage = function(e) {
    var msg = JSON.parse(e.data);
    if (msg.type === 'system' && msg.speaker_id) {
      if (!nickCustomized) spkInput.value = msg.speaker_id;
      return;
    }
    handleServerMsg(msg);
  };
}

var entries = {};

function handleServerMsg(msg) {
  if (msg.type === 'error') {
    showError(msg.message || TXT[UI].errPrefix, msg.uid);
    return;
  }

  var uid = msg.uid;
  var isFinal = msg.final;

  if (!entries[uid]) {
    if (!msg.src) return;
    var ml = myLang.value;
    var isMine = msg.src_lang === ml;
    var mainText = isMine ? msg.src : (msg.acc || msg.full || '');
    var subText = isMine ? (msg.acc || msg.full || '') : msg.src;
    createEntry(uid, msg.spk || '?', mainText, subText, isFinal, isMine);
    return;
  }

  var e = entries[uid];
  var isMine = e.isMine;

  if (msg.type === 't_chunk') {
    if (isMine) {
      e.main.textContent = msg.src;
      e.sub.textContent = msg.acc || '';
      e.sub.className = msg.acc ? 'sub ' + (isFinal ? 'final' : 'tent') : WAITING_CLS;
    } else {
      e.main.textContent = msg.acc || '';
      e.sub.textContent = msg.src;
      e.main.className = 'main ' + (msg.acc ? (isFinal ? 'final' : 'tent') : 'tent');
      e.sub.className = 'sub final';
    }
  }

  if (msg.type === 't_done') {
    if (isMine) {
      e.main.textContent = msg.src;
      e.sub.textContent = msg.full || '';
    } else {
      e.main.textContent = msg.full || '';
      e.sub.textContent = msg.src;
    }
    e.main.className = 'main final';
    e.sub.className = 'sub final';
    if (isFinal) e.row.dataset.final = 'true';
  }
}

function createEntry(uid, spkLabel, mainText, subText, isFinal, isMine) {
  var row = document.createElement('div');
  row.className = 'entry ' + (isMine ? 'mine' : 'other');
  row.dataset.uid = uid;
  row.dataset.ts = Date.now();

  var color = speakerColor(spkLabel);
  var spkSpan = document.createElement('div');
  spkSpan.className = 'spk';
  spkSpan.style.color = color;
  var dot = document.createElement('span');
  dot.className = 'spk-dot';
  dot.style.background = color;
  spkSpan.appendChild(dot);
  spkSpan.appendChild(document.createTextNode(esc(spkLabel)));

  var main = document.createElement('div');
  main.className = 'main ' + (isFinal ? 'final' : 'tent');
  main.textContent = mainText;

  var sub = document.createElement('div');
  if (!subText && isMine) {
    sub.className = WAITING_CLS;
    sub.textContent = TXT[UI].waiting + '…';
  } else {
    sub.className = 'sub ' + (isFinal ? 'final' : 'tent');
    sub.textContent = subText;
  }

  row.appendChild(spkSpan);
  row.appendChild(main);
  row.appendChild(sub);
  logEl.appendChild(row);
  logEl.scrollTop = logEl.scrollHeight;

  entries[uid] = { row: row, main: main, sub: sub, isMine: !!isMine };
  updateEmptyState();
  trimEntries();
}

function showError(message, uid) {
  if (uid && entries[uid]) {
    var e = entries[uid];
    e.sub.textContent = TXT[UI].errPrefix + ': ' + message;
    e.sub.className = 'sub tent';
    e.row.classList.add('error');
    return;
  }
  var row = document.createElement('div');
  row.className = 'entry error';
  row.textContent = TXT[UI].errPrefix + ': ' + message;
  logEl.appendChild(row);
  logEl.scrollTop = logEl.scrollHeight;
  updateEmptyState();
}

function esc(s) { return s.replace(/[&<>]/g, function(c) { return { '&':'&amp;','<':'&lt;','>':'&gt;' }[c]; }); }

function spk() { return spkInput.value.trim() || '?'; }

function resizeTextarea() {
  textInput.style.height = 'auto';
  textInput.style.height = Math.min(textInput.scrollHeight, 120) + 'px';
}

/* ---- recording ---- */

function clearLocalInterim() {
  if (localInterim) {
    localInterim.remove();
    localInterim = null;
  }
}

function startRecording() {
  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { alert(TXT[UI].noSpeech); return; }

  recognition = new SpeechRecognition();
  recognition.lang = SR_LANG[myLang.value] || 'ja-JP';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = function(event) {
    var finalText = '';
    var interim = '';
    for (var i = event.resultIndex; i < event.results.length; i++) {
      var r = event.results[i];
      if (r.isFinal) {
        finalText += r[0].transcript;
      } else {
        interim += r[0].transcript;
      }
    }

    if (interim) {
      if (!localInterim) {
        localInterim = document.createElement('div');
        localInterim.className = 'entry mine interim';
        var color = speakerColor(spk());
        localInterim.innerHTML =
          '<div class="spk" style="color:' + color + '">' +
          '<span class="spk-dot" style="background:' + color + '"></span>' +
          esc(spk()) + '</div><div class="main tent"></div>';
        logEl.appendChild(localInterim);
        updateEmptyState();
      }
      localInterim.querySelector('.main').textContent = interim;
      logEl.scrollTop = logEl.scrollHeight;
    } else {
      clearLocalInterim();
    }

    if (finalText) {
      clearLocalInterim();
      send(finalText, true);
    }
  };

  recognition.onerror = function(event) {
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    setStatus(TXT[UI].errPrefix + ': ' + event.error);
    stopRecording();
  };

  recognition.onend = function() {
    if (isRecording) {
      try { recognition.start(); } catch(e) {}
    }
  };

  recognition.start();
  isRecording = true;
  recordBtn.textContent = TXT[UI].stop;
  recordBtn.className = 'btn-record recording';
  setStatus(TXT[UI].recOn);
}

function stopRecording() {
  clearLocalInterim();
  if (recognition) {
    try { recognition.stop(); } catch(e) {}
    recognition = null;
  }
  isRecording = false;
  recordBtn.textContent = TXT[UI].rec;
  recordBtn.className = 'btn-record idle';
  setStatus(TXT[UI].recOff);
}

/* ---- send ---- */

function send(text, isFinal) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  var uid = clientId + '-' + (++uttId);
  createEntry(uid, spk(), text, '', isFinal, true);

  ws.send(JSON.stringify({
    type: 'translate',
    uid: uid,
    text: text,
    source_lang: 'auto',
    target_lang: 'auto',
    speaker_id: spk(),
    is_final: isFinal,
  }));
}

function sendText() {
  var txt = textInput.value.trim();
  if (!txt) return;
  send(txt, true);
  textInput.value = '';
  resizeTextarea();
  textInput.focus();
}

/* ---- events ---- */

recordBtn.addEventListener('click', function() {
  if (isRecording) stopRecording();
  else startRecording();
});

myLang.addEventListener('change', function() {
  dirHint.textContent = TXT[UI].dir[myLang.value];
  if (isRecording) stopRecording();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'init', lang: myLang.value }));
  }
});

spkInput.addEventListener('input', function() {
  nickCustomized = true;
});

sendBtn.addEventListener('click', sendText);

textInput.addEventListener('input', resizeTextarea);

textInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && e.ctrlKey) {
    return;
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendText();
  }
});

function setStatus(s) { statusMsg.textContent = s; }

applyUI();
myLang.value = UI === 'ko' ? 'ko' : 'ja';
dirHint.textContent = TXT[UI].dir[myLang.value];
setStatus(TXT[UI].ready);
updateEmptyState();
requestMic();
connect();