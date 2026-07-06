const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';

let ws = null;
let recognition = null;
let isRecording = false;
let uttId = 0;
let clientId = '';

const logEl = document.getElementById('log');
const statusMsg = document.getElementById('statusMsg');
const connDot = document.getElementById('connDot');
const connLabel = document.getElementById('connLabel');
const srcLang = document.getElementById('srcLang');
const tgtLang = document.getElementById('tgtLang');
const spkInput = document.getElementById('spkInput');
const recordBtn = document.getElementById('recordBtn');
const textInput = document.getElementById('textInput');
const sendBtn = document.getElementById('sendBtn');

const SR_LANG = { ja: 'ja-JP', en: 'en-US', ko: 'ko-KR' };

function connect() {
  ws = new WebSocket(WS_URL);
  ws.onopen = function() {
    connDot.className = 'dot on';
    connLabel.textContent = 'Connected';
    recordBtn.disabled = false;
    textInput.disabled = false;
    sendBtn.disabled = false;
    textInput.focus();
    clientId = Math.random().toString(36).slice(2, 6);
    setStatus('Connected');
  };
  ws.onclose = function() {
    connDot.className = 'dot off';
    connLabel.textContent = 'Disconnected';
    recordBtn.disabled = true;
    textInput.disabled = true;
    sendBtn.disabled = true;
    if (isRecording) stopRecording();
    setStatus('Reconnecting...');
    setTimeout(connect, 2000);
  };
  ws.onmessage = function(e) {
    var msg = JSON.parse(e.data);
    handleServerMsg(msg);
  };
}

var entries = {};

function handleServerMsg(msg) {
  var uid = msg.uid;
  var isFinal = msg.final;

  if (!entries[uid]) {
    if (!msg.src) return;
    var myLang = srcLang.value;
    var isMine = msg.src_lang === myLang;
    var mainText = isMine ? msg.src : (msg.acc || msg.full || '');
    var subText = isMine ? (msg.acc || msg.full || '') : msg.src;
    createEntry(uid, msg.spk || '?', mainText, subText, isFinal);
    return;
  }

  var e = entries[uid];
  var myLang = srcLang.value;
  var isMine = msg.src_lang === myLang;

  if (msg.type === 't_chunk') {
    e.main.textContent = isMine ? msg.src : msg.acc;
    e.sub.textContent = isMine ? msg.acc : msg.src;
    e.main.className = 'main ' + (isFinal ? 'final' : 'tent');
    e.sub.className = 'sub ' + (isFinal ? 'final' : 'tent');
  }

  if (msg.type === 't_done') {
    e.main.textContent = isMine ? msg.src : msg.full;
    e.sub.textContent = isMine ? msg.full : msg.src;
    e.main.className = 'main final';
    e.sub.className = 'sub final';
    if (isFinal) e.row.dataset.final = 'true';
  }
}

function createEntry(uid, spkLabel, mainText, subText, isFinal) {
  var row = document.createElement('div');
  row.className = 'entry';
  row.dataset.uid = uid;

  var spkSpan = document.createElement('div');
  spkSpan.className = 'spk';
  spkSpan.textContent = esc(spkLabel);

  var main = document.createElement('div');
  main.className = 'main ' + (isFinal ? 'final' : 'tent');
  main.textContent = mainText;

  var sub = document.createElement('div');
  sub.className = 'sub ' + (isFinal ? 'final' : 'tent');
  sub.textContent = subText;

  row.appendChild(spkSpan);
  row.appendChild(main);
  row.appendChild(sub);
  logEl.appendChild(row);
  logEl.scrollTop = logEl.scrollHeight;

  entries[uid] = { row: row, main: main, sub: sub };
}

function esc(s) { return s.replace(/[&<>]/g, function(c) { return { '&':'&amp;','<':'&lt;','>':'&gt;' }[c]; }); }

function spk() { return spkInput.value.trim() || '?'; }

/* ---- recording ---- */

function startRecording() {
  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { alert('Speech recognition not supported in this browser.'); return; }

  recognition = new SpeechRecognition();
  recognition.lang = SR_LANG[srcLang.value] || 'ja-JP';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  var localInterim = null;

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
        localInterim.className = 'entry';
        localInterim.innerHTML = '<div class="spk">' + esc(spk()) + '</div><div class="main tent"></div>';
        logEl.appendChild(localInterim);
        logEl.scrollTop = logEl.scrollHeight;
      }
      localInterim.querySelector('.main').textContent = interim;
    }

    if (finalText) {
      if (localInterim) { localInterim.remove(); localInterim = null; }
      send(finalText, true);
    }
  };

  recognition.onerror = function(event) {
    setStatus('Error: ' + event.error);
    stopRecording();
  };

  recognition.onend = function() {
    if (isRecording) {
      try { recognition.start(); } catch(e) {}
    }
  };

  recognition.start();
  isRecording = true;
  recordBtn.textContent = 'Stop';
  recordBtn.className = 'btn-record';
  setStatus('Recording (' + SR_LANG[srcLang.value] + ')');
}

function stopRecording() {
  if (recognition) {
    try { recognition.stop(); } catch(e) {}
    recognition = null;
  }
  isRecording = false;
  recordBtn.textContent = 'Record';
  recordBtn.className = 'btn-record idle';
  setStatus('Stopped');
}

/* ---- send ---- */

function send(text, isFinal) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  var uid = clientId + '-' + (++uttId);
  createEntry(uid, spk(), text, '', isFinal);

  ws.send(JSON.stringify({
    type: 'translate',
    uid: uid,
    text: text,
    source_lang: srcLang.value,
    target_lang: tgtLang.value,
    speaker_id: spk(),
    is_final: isFinal,
  }));
}

function sendText() {
  var text = textInput.value.trim();
  if (!text) return;
  send(text, true);
  textInput.value = '';
  textInput.focus();
}

/* ---- events ---- */

recordBtn.addEventListener('click', function() {
  if (isRecording) stopRecording();
  else startRecording();
});

srcLang.addEventListener('change', function() {
  if (isRecording) stopRecording();
});

sendBtn.addEventListener('click', sendText);
textInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendText();
  }
});

function setStatus(s) { statusMsg.textContent = s; }

connect();
