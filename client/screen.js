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
    lobbySub: '大画面に日本語と韓国語を同時表示します。話す人がスマホやPCでルームを開いたら、同じ6桁の番号を入力して「接続」を押してください。',
    join: '接続',
    invalidRoom: '6桁の数字を入力してください',
    roomNotFound: 'ルームが見つかりません',
    waitingRoom: 'ルーム {room} の準備中です… 話す人がルームを開くまでお待ちください',
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
    lobbySub: '대형 화면에 일본어와 한국어를 동시에 표시합니다. 발표자가 스마트폰이나 PC에서 룸을 연 뒤, 같은 6자리 번호를 입력하고 「연결」을 누르세요.',
    join: '연결',
    invalidRoom: '6자리 숫자를 입력해주세요',
    roomNotFound: '룸을 찾을 수 없습니다',
    waitingRoom: '룸 {room} 준비 중… 발표자가 룸을 열 때까지 기다려주세요',
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

var FIT_MIN = 15;

function getFitMaxPx() {
  var isFs = document.body.classList.contains('fs');
  var vh = window.innerHeight;
  var vw = window.innerWidth;
  if (isFs) {
    return Math.min(32, Math.max(18, Math.round(vh * 0.032)));
  }
  if (vw < 768) return Math.min(28, Math.round(vw * 0.038));
  return Math.min(36, Math.round(vw * 0.028));
}

function setWaiting() {
  var t = TXT[UI];
  jaCurrent.textContent = t.waiting;
  koCurrent.textContent = t.waiting;
  jaCurrent.className = 'current-text empty';
  koCurrent.className = 'current-text empty';
  jaCurrent.style.fontSize = '';
  koCurrent.style.fontSize = '';
}

function fitCurrentText(el) {
  if (!el || el.classList.contains('empty')) {
    if (el) el.style.fontSize = '';
    return;
  }
  var parent = el.parentElement;
  if (!parent) return;
  var maxH = parent.clientHeight;
  if (maxH < 24) {
    requestAnimationFrame(function() { fitCurrentText(el); });
    return;
  }

  var maxPx = getFitMaxPx();
  var targetH = maxH - 12;
  var size = maxPx;
  el.style.fontSize = size + 'px';
  el.style.lineHeight = '1.45';
  while (el.scrollHeight > targetH && size > FIT_MIN) {
    size -= 1;
    el.style.fontSize = size + 'px';
  }
  parent.style.overflowY = el.scrollHeight > targetH ? 'auto' : 'hidden';
}

function renderCurrent() {
  if (!current.ja && !current.ko) {
    if (!currentUid) setWaiting();
    return;
  }
  var cls = 'current-text' + (current.final ? '' : ' interim');
  jaCurrent.textContent = current.ja || '…';
  koCurrent.textContent = current.ko || '…';
  jaCurrent.className = cls;
  koCurrent.className = cls;
  requestAnimationFrame(function() {
    fitCurrentText(jaCurrent);
    fitCurrentText(koCurrent);
  });
}

function getPreviousHistoryItem() {
  if (!pastMessages.length || !currentUid) return null;
  for (var i = pastMessages.length - 1; i >= 0; i--) {
    if (pastMessages[i].uid === currentUid) {
      return i > 0 ? pastMessages[i - 1] : null;
    }
  }
  return pastMessages[pastMessages.length - 1];
}

function renderHistory() {
  jaHistory.innerHTML = '';
  koHistory.innerHTML = '';
  var item = getPreviousHistoryItem();
  if (!item) return;

  var jaEl = document.createElement('div');
  jaEl.className = 'hist-item';
  jaEl.textContent = item.ja;
  jaHistory.appendChild(jaEl);

  var koEl = document.createElement('div');
  koEl.className = 'hist-item';
  koEl.textContent = item.ko;
  koHistory.appendChild(koEl);
}

function pushHistory(ja, ko, uid) {
  if (!ja && !ko) return;
  pastMessages.push({ ja: ja, ko: ko, uid: uid || null });
  while (pastMessages.length > MAX_HISTORY) pastMessages.shift();
  renderHistory();
}

function removeHistoryForUid(uid) {
  for (var i = pastMessages.length - 1; i >= 0; i--) {
    if (pastMessages[i].uid === uid) {
      pastMessages.splice(i, 1);
      renderHistory();
      return;
    }
  }
}

function upsertHistoryEntry(uid, ja, ko) {
  if (!ja && !ko) return;
  for (var i = pastMessages.length - 1; i >= 0; i--) {
    if (pastMessages[i].uid === uid) {
      pastMessages[i].ja = ja;
      pastMessages[i].ko = ko;
      renderHistory();
      return;
    }
  }
  pushHistory(ja, ko, uid);
}

function updateCurrent(uid, src, tgt, srcLang, isFinal, revised) {
  if (revised) removeHistoryForUid(uid);
  if (uid !== currentUid) {
    if (currentUid !== null && !revised) {
      upsertHistoryEntry(currentUid, current.ja, current.ko);
    }
    currentUid = uid;
    current = { ja: '', ko: '', final: false };
  }

  var pair = splitBilingual(src, tgt, srcLang);
  current.ja = pair.ja;
  current.ko = pair.ko;
  current.final = isFinal;
  renderCurrent();

  if (isFinal) upsertHistoryEntry(uid, current.ja, current.ko);
  renderHistory();
}

function handleServerMsg(msg) {
  var revised = !!msg.revised;
  if (msg.type === 't_chunk') {
    updateCurrent(msg.uid, msg.src, msg.acc || '', msg.src_lang, false, revised);
    return;
  }
  if (msg.type === 't_done') {
    updateCurrent(msg.uid, msg.src, msg.full || '', msg.src_lang, true, revised);
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
      if (pair.ja || pair.ko) pastMessages.push({ ja: pair.ja, ko: pair.ko, uid: m.uid });
    });
    while (pastMessages.length > MAX_HISTORY) pastMessages.shift();
    if (msgs.length) {
      var last = msgs[msgs.length - 1];
      var pair = splitBilingual(last.src, last.full || '', last.src_lang);
      currentUid = last.uid;
      current = { ja: pair.ja, ko: pair.ko, final: true };
      renderCurrent();
    }
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

function refitCurrentText() {
  if (current.ja || current.ko) renderCurrent();
}

function updateFsBtn() {
  var t = TXT[UI];
  var isFs = !!document.fullscreenElement;
  fsBtn.textContent = isFs ? t.exitFullscreen : t.fullscreen;
  document.body.classList.toggle('fs', isFs);
  refitCurrentText();
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
window.addEventListener('resize', refitCurrentText);

setupRoomCodeInputs();
applyUI();

var urlRoom = parseRoomFromUrl();
if (urlRoom) {
  setRoomCode(urlRoom);
  joinRoom(urlRoom);
} else {
  focusRoomDigit(0);
}