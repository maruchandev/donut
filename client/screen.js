var roomId = '';
var WS_URL = '';
const MAX_HISTORY = 12;
const HISTORY_PAGE = 30;

let ws = null;
let intentionalClose = false;
let hasConnected = false;
let roomEnded = false;
let historyLoaded = false;
let waitTimer = null;
let waiting = false;

const lobbyEl = document.getElementById('lobby');
const displayEl = document.getElementById('display');
const roomDigits = Array.from(document.querySelectorAll('.room-digit'));
const joinBtn = document.getElementById('joinBtn');
const lobbyError = document.getElementById('lobbyError');
const roomNumEl = document.getElementById('roomNum');
const connDot = document.getElementById('connDot');
const connLabel = document.getElementById('connLabel');
const fsBtn = document.getElementById('fsBtn');
const jaCurrent = document.getElementById('jaCurrent');
const koCurrent = document.getElementById('koCurrent');
const jaHistory = document.getElementById('jaHistory');
const koHistory = document.getElementById('koHistory');

var fallbackLang = (navigator.language || 'en').slice(0, 2);
var UI = (fallbackLang === 'ko' || fallbackLang === 'ja') ? fallbackLang : 'ja';

const TXT = {
  ja: {
    lobbyTitle: '大画面表示',
    lobbySub: 'プロジェクター用の日韓同時表示画面です。先に通常画面で同じルーム番号に入室してから、ここで接続してください。ルームがまだ無い場合は自動で待機します。',
    join: '接続',
    invalidRoom: '6桁の数字を入力してください',
    roomNotFound: 'ルームが見つかりません',
    waitingRoom: 'ルーム {room} を待っています… 通常画面で同じ番号に入室してください',
    waitingCancel: '待機をやめる',
    connError: 'サーバーに接続できません。再試行しています…',
    conn: '接続済',
    disc: '切断',
    recon: '再接続中…',
    waiting: '翻訳を待っています…',
    roomExpired: 'ルームが無操作のため終了しました',
    roomDissolved: 'ルームが解散されました',
    fullscreen: '全画面',
    exitFullscreen: '全画面解除',
    pageTitle: 'どーなつ — 大画面表示',
    jaLabel: '日本語',
    koLabel: '한국어',
  },
  ko: {
    lobbyTitle: '대형 화면',
    lobbySub: '프로젝터용 일한 동시 표시 화면입니다. 먼저 일반 화면에서 같은 룸 번호로 입장한 뒤 여기서 연결하세요. 룸이 아직 없으면 자동으로 대기합니다.',
    join: '연결',
    invalidRoom: '6자리 숫자를 입력해주세요',
    roomNotFound: '룸을 찾을 수 없습니다',
    waitingRoom: '룸 {room} 대기 중… 일반 화면에서 같은 번호로 입장해주세요',
    waitingCancel: '대기 취소',
    connError: '서버에 연결할 수 없습니다. 재시도 중…',
    conn: '연결됨',
    disc: '연결 끊김',
    recon: '재연결 중…',
    waiting: '번역을 기다리는 중…',
    roomExpired: '1시간 동안 활동이 없어 룸이 종료되었습니다',
    roomDissolved: '룸이 해산되었습니다',
    fullscreen: '전체 화면',
    exitFullscreen: '전체 화면 해제',
    pageTitle: 'どーなつ — 대형 화면',
    jaLabel: '日本語',
    koLabel: '한국어',
  },
};

let currentUid = null;
let current = { ja: '', ko: '', final: false };
const pastMessages = [];

function applyUI() {
  var t = TXT[UI];
  document.documentElement.lang = UI;
  document.title = t.pageTitle;
  document.getElementById('lobbyTitle').textContent = t.lobbyTitle;
  document.getElementById('lobbySub').textContent = t.lobbySub;
  joinBtn.textContent = t.join;
  document.getElementById('jaLabel').textContent = t.jaLabel;
  document.getElementById('koLabel').textContent = t.koLabel;
  updateFsBtn();
}

function parseRoomFromUrl() {
  var room = new URLSearchParams(location.search).get('room');
  return room && /^\d{6}$/.test(room) ? room : '';
}

function checkRoomExists(id) {
  return fetch('/room/' + id).then(function(r) {
    if (!r.ok) throw new Error('check failed');
    return r.json();
  }).then(function(data) {
    return !!data.exists;
  });
}

function getRoomCode() {
  return roomDigits.map(function(el) { return el.value; }).join('');
}

function setRoomCode(code) {
  var digits = (code || '').replace(/\D/g, '').slice(0, 6);
  for (var i = 0; i < roomDigits.length; i++) {
    roomDigits[i].value = digits[i] || '';
  }
}

function focusRoomDigit(idx) {
  if (roomDigits[idx]) roomDigits[idx].focus();
}

function setupRoomCodeInputs() {
  roomDigits.forEach(function(input, idx) {
    input.addEventListener('input', function() {
      var v = this.value.replace(/\D/g, '');
      lobbyError.textContent = '';
      if (v.length > 1) {
        for (var j = 0; j < v.length && idx + j < roomDigits.length; j++) {
          roomDigits[idx + j].value = v[j];
        }
        focusRoomDigit(Math.min(idx + v.length, roomDigits.length - 1));
        return;
      }
      this.value = v;
      if (v && idx < roomDigits.length - 1) focusRoomDigit(idx + 1);
    });

    input.addEventListener('keydown', function(e) {
      if (e.key === 'Backspace' && !this.value && idx > 0) {
        roomDigits[idx - 1].value = '';
        focusRoomDigit(idx - 1);
        e.preventDefault();
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        joinBtn.click();
      }
    });

    input.addEventListener('focus', function() { this.select(); });
  });

  document.getElementById('roomCode').addEventListener('paste', function(e) {
    e.preventDefault();
    var text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6);
    setRoomCode(text);
    lobbyError.textContent = '';
    focusRoomDigit(text.length >= 6 ? 5 : text.length);
  });
}

function splitBilingual(src, tgt, srcLang) {
  if (srcLang === 'ja') return { ja: src || '', ko: tgt || '' };
  if (srcLang === 'ko') return { ja: tgt || '', ko: src || '' };
  return { ja: src || '', ko: tgt || '' };
}

function setWaiting() {
  var t = TXT[UI];
  jaCurrent.textContent = t.waiting;
  koCurrent.textContent = t.waiting;
  jaCurrent.className = 'current-text empty';
  koCurrent.className = 'current-text empty';
}

function renderCurrent() {
  if (!current.ja && !current.ko) {
    setWaiting();
    return;
  }
  var cls = 'current-text' + (current.final ? '' : ' interim');
  jaCurrent.textContent = current.ja || '…';
  koCurrent.textContent = current.ko || '…';
  jaCurrent.className = cls;
  koCurrent.className = cls;
}

function renderHistory() {
  jaHistory.innerHTML = '';
  koHistory.innerHTML = '';
  pastMessages.forEach(function(item) {
    var jaEl = document.createElement('div');
    jaEl.className = 'hist-item';
    jaEl.textContent = item.ja;
    jaHistory.appendChild(jaEl);

    var koEl = document.createElement('div');
    koEl.className = 'hist-item';
    koEl.textContent = item.ko;
    koHistory.appendChild(koEl);
  });
}

function pushHistory(ja, ko) {
  if (!ja && !ko) return;
  pastMessages.push({ ja: ja, ko: ko });
  while (pastMessages.length > MAX_HISTORY) pastMessages.shift();
  renderHistory();
}

function finalizeCurrent() {
  if (!current.ja && !current.ko) return;
  pushHistory(current.ja, current.ko);
  current = { ja: '', ko: '', final: false };
  currentUid = null;
  setWaiting();
}

function updateCurrent(uid, src, tgt, srcLang, isFinal) {
  if (uid !== currentUid) {
    if (currentUid !== null) finalizeCurrent();
    currentUid = uid;
    current = { ja: '', ko: '', final: false };
  }

  var pair = splitBilingual(src, tgt, srcLang);
  current.ja = pair.ja;
  current.ko = pair.ko;
  current.final = isFinal;
  renderCurrent();

  if (isFinal) finalizeCurrent();
}

function handleServerMsg(msg) {
  if (msg.type === 't_chunk') {
    updateCurrent(msg.uid, msg.src, msg.acc || '', msg.src_lang, false);
    return;
  }
  if (msg.type === 't_done') {
    updateCurrent(msg.uid, msg.src, msg.full || '', msg.src_lang, true);
  }
}

function loadHistory() {
  if (!roomId || historyLoaded) return;
  historyLoaded = true;
  fetch('/room/' + roomId + '/messages?limit=' + HISTORY_PAGE).then(function(r) {
    if (!r.ok) throw new Error('history failed');
    return r.json();
  }).then(function(data) {
    var msgs = data.messages || [];
    msgs.forEach(function(m) {
      var pair = splitBilingual(m.src, m.full || '', m.src_lang);
      if (pair.ja || pair.ko) pastMessages.push(pair);
    });
    while (pastMessages.length > MAX_HISTORY) pastMessages.shift();
    renderHistory();
  }).catch(function() {});
}

function stopWaiting() {
  waiting = false;
  if (waitTimer) {
    clearTimeout(waitTimer);
    waitTimer = null;
  }
  joinBtn.textContent = TXT[UI].join;
}

function showDisplay(id) {
  stopWaiting();
  if (!id || !/^\d{6}$/.test(id)) return;
  hasConnected = false;
  roomEnded = false;
  historyLoaded = false;
  pastMessages.length = 0;
  currentUid = null;
  current = { ja: '', ko: '', final: false };
  renderHistory();
  setWaiting();

  roomId = id;
  WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/' + roomId;
  roomNumEl.textContent = roomId;
  window.history.replaceState(null, '', location.pathname + '?room=' + roomId);
  lobbyEl.classList.add('hidden');
  displayEl.classList.add('open');
  connect();
}

function showLobby(errMsg) {
  stopWaiting();
  if (ws) { intentionalClose = true; ws.close(); ws = null; }
  roomId = '';
  window.history.replaceState(null, '', location.pathname);
  lobbyEl.classList.remove('hidden');
  displayEl.classList.remove('open');
  setRoomCode('');
  lobbyError.textContent = errMsg || '';
  focusRoomDigit(0);
}

function handleRoomClosed(reason) {
  roomEnded = true;
  intentionalClose = true;
  if (ws) { ws.close(); ws = null; }
  var msg = reason === 'idle' ? TXT[UI].roomExpired : TXT[UI].roomDissolved;
  showLobby(msg);
}

function connect() {
  if (!roomId) return;
  intentionalClose = false;
  var gotSystem = false;
  ws = new WebSocket(WS_URL);

  ws.onopen = function() {
    connDot.className = 'dot on';
    connLabel.textContent = TXT[UI].conn;
    ws.send(JSON.stringify({ type: 'init', lang: 'ja' }));
  };

  ws.onclose = function() {
    connDot.className = 'dot off';
    connLabel.textContent = TXT[UI].disc;
    if (!intentionalClose && !hasConnected && !gotSystem) {
      showLobby(TXT[UI].roomNotFound);
      return;
    }
    if (!intentionalClose && !roomEnded && hasConnected) {
      connLabel.textContent = TXT[UI].recon;
      checkRoomExists(roomId).then(function(exists) {
        if (!exists) {
          showLobby(TXT[UI].roomNotFound);
          return;
        }
        setTimeout(connect, 2000);
      }).catch(function() {
        setTimeout(connect, 2000);
      });
    }
  };

  ws.onmessage = function(e) {
    var msg = JSON.parse(e.data);
    if (msg.type === 'room_closed') {
      handleRoomClosed(msg.reason);
      return;
    }
    if (msg.type === 'system') {
      gotSystem = true;
      hasConnected = true;
      loadHistory();
      return;
    }
    handleServerMsg(msg);
  };
}

function joinRoom(val) {
  if (!/^\d{6}$/.test(val)) {
    lobbyError.textContent = TXT[UI].invalidRoom;
    return;
  }
  stopWaiting();
  lobbyError.textContent = '';
  joinBtn.disabled = true;
  waiting = true;
  joinBtn.textContent = TXT[UI].waitingCancel;

  function attempt() {
    if (!waiting) {
      joinBtn.disabled = false;
      joinBtn.textContent = TXT[UI].join;
      return;
    }
    checkRoomExists(val).then(function(exists) {
      if (!waiting) return;
      if (exists) {
        joinBtn.disabled = false;
        showDisplay(val);
        return;
      }
      lobbyError.textContent = TXT[UI].waitingRoom.replace('{room}', val);
      waitTimer = setTimeout(attempt, 2000);
    }).catch(function() {
      if (!waiting) return;
      lobbyError.textContent = TXT[UI].connError;
      waitTimer = setTimeout(attempt, 3000);
    });
  }

  attempt();
}

function updateFsBtn() {
  var t = TXT[UI];
  var isFs = !!document.fullscreenElement;
  fsBtn.textContent = isFs ? t.exitFullscreen : t.fullscreen;
  document.body.classList.toggle('fs', isFs);
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(function() {});
  } else {
    document.documentElement.requestFullscreen().catch(function() {});
  }
}

joinBtn.addEventListener('click', function() {
  if (waiting) {
    stopWaiting();
    joinBtn.disabled = false;
    lobbyError.textContent = '';
    return;
  }
  joinRoom(getRoomCode());
});

fsBtn.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', updateFsBtn);

setupRoomCodeInputs();
applyUI();

var urlRoom = parseRoomFromUrl();
if (urlRoom) {
  setRoomCode(urlRoom);
  joinRoom(urlRoom);
} else {
  focusRoomDigit(0);
}