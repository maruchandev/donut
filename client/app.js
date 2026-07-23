var roomId = '';
var WS_URL = '';
const MAX_ENTRIES = 200;
const HISTORY_PAGE = 25;
const WAITING_CLS = 'sub waiting';

let ws = null;
let recognition = null;
let isRecording = false;
let uttId = 0;
let clientId = '';
let localInterim = null;
let nickCustomized = false;
let intentionalClose = false;
let hasConnected = false;
let roomEnded = false;
let oldestMsgId = null;
let historyLoading = false;
let historyExhausted = false;
let historyLoaded = false;
let scrollTimer = null;

/*
 * Speech pipeline (final-segment / server-driven):
 * - interim → local preview only
 * - isFinal → send delta once
 * - text-idle → if recognized text stops growing for N ms (even with えー fillers
 *   keeping the mic "busy"), flush unsent interim delta (not audio silence)
 * - Server: src-first broadcast + prior-chunk context + dedupe
 */
const SPEECH_MIN_SEND_CHARS = 2;
const SPEECH_TEXT_IDLE_MS = 1800;       /* no new characters for this long → cut */
const SPEECH_TEXT_IDLE_MIN_CHARS = 4;   /* ignore tiny fragments on idle flush */
const SPEECH_DEDUP_MAX = 48;
const SPEECH_DEDUP_TTL_MS = 5 * 60 * 1000;

let speechInterim = '';
/** result keys already emitted this recognition generation: "gen:index" */
let speechEmittedKeys = {};
let speechRecGen = 0;
/** Recent sent chunks for duplicate suppression { hash, at }. */
let speechSentHashes = [];
/** Cumulative normalized text already sent this recording (for delta sends). */
let speechSentCumulativeNorm = '';
/** Last live transcript string we observed (for text-stall detection). */
let speechWatchText = '';
let speechTextIdleTimer = null;

const lobbyEl = document.getElementById('lobby');
const chatEl = document.getElementById('chat');

const roomCodeEl = document.getElementById('roomCode');
const roomDigits = Array.from(document.querySelectorAll('.room-digit'));
const joinBtn = document.getElementById('joinBtn');
const newRoomBtn = document.getElementById('newRoomBtn');
const lobbyError = document.getElementById('lobbyError');
const lobbySub = document.getElementById('lobbySub');
const lobbyDivider = document.getElementById('lobbyDivider');
const createWrap = document.getElementById('createWrap');
const createPassword = document.getElementById('createPassword');
const createPasswordLabel = document.getElementById('createPasswordLabel');

let roomCreateMode = 'open';
const roomBadge = document.getElementById('roomBadge');
const roomBadgeLabel = document.getElementById('roomBadgeLabel');
const roomBadgeNum = document.getElementById('roomBadgeNum');
const roomBadgeIcon = document.getElementById('roomBadgeIcon');
const copyToast = document.getElementById('copyToast');
const homeBtn = document.getElementById('homeBtn');
const screenLink = document.getElementById('screenLink');
const dissolveBtn = document.getElementById('dissolveBtn');
const menuBtn = document.getElementById('menuBtn');
const menuDrop = document.getElementById('menuDrop');
const qrModal = document.getElementById('qrModal');
const qrClose = document.getElementById('qrClose');
const qrTitle = document.getElementById('qrTitle');
const qrRoomNum = document.getElementById('qrRoomNum');
const qrCodeEl = document.getElementById('qrCode');
const qrHint = document.getElementById('qrHint');
const qrActions = document.getElementById('qrActions');
const qrShareBtn = document.getElementById('qrShareBtn');
const qrScreenLink = document.getElementById('qrScreenLink');
const qrCopyBtn = document.getElementById('qrCopyBtn');

const logEl = document.getElementById('log');
const historyTopEl = document.getElementById('historyTop');
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
    ready: '準備完了', rec: '話す', stop: '停止',
    recOn: '聞き取り中', recOff: '準備完了', send: '送信',
    inputPh: 'テキストを入力...',
    inputHint: 'Enter で送信 · Ctrl+Enter で改行',
    empty: '「話す」ボタンまたはテキスト入力で翻訳を始めましょう',
    waiting: '翻訳中',
    errPrefix: 'エラー',
    noSpeech: '音声認識に対応していないブラウザです',
    dir: { ja: '→ 한국어', ko: '→ 日本語' },
    lobbySub: 'ルーム番号を入力するか、新しいルームを作成してください',
    join: '入室',
    newRoom: '新しいルームを作成',
    roomCopied: 'コピーしました',
    invalidRoom: '6桁の数字を入力してください',
    roomNotFound: 'ルームが見つかりません',
    roomCreateFailed: 'ルームの作成に失敗しました',
    roomCreateClosed: '現在、新しいルームは作成できません',
    roomPasswordRequired: '発行パスワードを入力してください',
    roomPasswordInvalid: '発行パスワードが正しくありません',
    createPasswordLabel: '発行パスワード',
    roomLabel: 'ルーム',
    heroBadge: '会話も講演も',
    linkCopied: 'リンクをコピーしました',
    screen: '大画面表示',
    dissolve: 'ルームを解散',
    dissolveConfirm: 'ルームを解散しますか？全員が退出し、ルームは削除されます。',
    roomDissolved: 'ルームが解散されました',
    roomExpired: 'ルームが無操作のため終了しました（1時間）',
    qrShare: 'ルームを共有',
    qrHint: 'QRコードを読み取って入室',
    qrTap: 'タップしてQRコードを表示',
    copyLink: 'リンクをコピー',
    openScreen: '大画面表示を開く',
    share: '共有',
    shareText: 'どーなつのルーム {room} に来てね',
    historyLoading: '過去の会話を読み込み中…',
    serviceName: 'どーなつ',
    heroDesc: 'カジュアルな会話から講演・会議まで。話すだけで日韓翻訳が届くリアルタイム通訳。ルーム番号を共有して、すぐに始められます。',
    footerTagline: '日韓リアルタイム通訳',
    pageTitle: 'どーなつ — 日韓リアルタイム通訳',
    backHome: 'トップへ戻る',
    edit: '修正',
    editHint: '認識された文章を直して、再翻訳します',
    editCancel: 'キャンセル',
    editSave: '再翻訳して送信',
  },
  ko: {
    lang: '내 언어', nick: '닉네임', ph: '이름',
    conn: '연결됨', disc: '연결 끊김', recon: '재연결 중...',
    ready: '준비 완료', rec: '말하기', stop: '중지',
    recOn: '듣는 중', recOff: '준비 완료', send: '보내기',
    inputPh: '텍스트 입력...',
    inputHint: 'Enter 전송 · Ctrl+Enter 줄바꿈',
    empty: '「말하기」버튼이나 텍스트 입력으로 번역을 시작하세요',
    waiting: '번역 중',
    errPrefix: '오류',
    noSpeech: '이 브라우저는 음성 인식을 지원하지 않습니다',
    dir: { ja: '→ 한국어', ko: '→ 日本語' },
    lobbySub: '룸 번호를 입력하거나 새 룸을 만들어주세요',
    join: '입장',
    newRoom: '새로운 룸 만들기',
    roomCopied: '복사했습니다',
    invalidRoom: '6자리 숫자를 입력해주세요',
    roomNotFound: '룸을 찾을 수 없습니다',
    roomCreateFailed: '룸 생성에 실패했습니다',
    roomCreateClosed: '현재 새 룸을 만들 수 없습니다',
    roomPasswordRequired: '발행 비밀번호를 입력해주세요',
    roomPasswordInvalid: '발행 비밀번호가 올바르지 않습니다',
    createPasswordLabel: '발행 비밀번호',
    roomLabel: '룸',
    heroBadge: '대화부터 강연까지',
    linkCopied: '링크를 복사했습니다',
    screen: '대형 화면',
    dissolve: '룸 해산',
    dissolveConfirm: '룸을 해산하시겠습니까? 모든 참가자가 퇴장하고 룸이 삭제됩니다.',
    roomDissolved: '룸이 해산되었습니다',
    roomExpired: '1시간 동안 활동이 없어 룸이 종료되었습니다',
    qrShare: '룸 공유',
    qrHint: 'QR 코드를 스캔하여 입장',
    qrTap: '탭하여 QR 코드 표시',
    copyLink: '링크 복사',
    openScreen: '대형 화면 열기',
    share: '공유',
    shareText: 'どーなつ 룸 {room}에 와요',
    historyLoading: '이전 대화 불러오는 중…',
    serviceName: 'どーなつ',
    heroDesc: '캐주얼 대화부터 강연·회의까지. 말하기만 하면 일한 번역이 도착하는 실시간 통역. 룸 번호를 공유해 바로 시작하세요.',
    footerTagline: '일한 실시간 통역',
    pageTitle: 'どーなつ — 일한 실시간 통역',
    backHome: '홈으로 돌아가기',
    edit: '수정',
    editHint: '인식된 문장을 고친 뒤 다시 번역합니다',
    editCancel: '취소',
    editSave: '재번역 후 전송',
  },
  en: {
    lang: 'My language', nick: 'Nickname', ph: 'name',
    conn: 'Connected', disc: 'Disconnected', recon: 'Reconnecting...',
    ready: 'Ready', rec: 'Speak', stop: 'Stop',
    recOn: 'Listening', recOff: 'Ready', send: 'Send',
    inputPh: 'Type a message...',
    inputHint: 'Enter to send · Ctrl+Enter for newline',
    empty: 'Press Speak or type a message to start translating',
    waiting: 'Translating',
    errPrefix: 'Error',
    noSpeech: 'Speech recognition is not supported in this browser',
    dir: { ja: '→ Korean', ko: '→ Japanese' },
    lobbySub: 'Enter a room number or create a new room',
    join: 'Join',
    newRoom: 'Create New Room',
    roomCopied: 'Copied',
    invalidRoom: 'Enter a 6-digit number',
    roomNotFound: 'Room not found',
    roomCreateFailed: 'Failed to create room',
    roomCreateClosed: 'New rooms cannot be created right now',
    roomPasswordRequired: 'Enter an issue password',
    roomPasswordInvalid: 'Invalid issue password',
    createPasswordLabel: 'Issue password',
    roomLabel: 'Room',
    heroBadge: 'Chat to conference',
    linkCopied: 'Link copied',
    screen: 'Large screen',
    dissolve: 'End room',
    dissolveConfirm: 'End this room? Everyone will be removed and the room will be deleted.',
    roomDissolved: 'Room has been ended',
    roomExpired: 'Room closed due to inactivity (1 hour)',
    qrShare: 'Share room',
    qrHint: 'Scan the QR code to join',
    qrTap: 'Tap to show QR code',
    copyLink: 'Copy link',
    openScreen: 'Open large screen',
    share: 'Share',
    shareText: 'Join どーなつ room {room}',
    historyLoading: 'Loading earlier messages…',
    serviceName: 'どーなつ',
    heroDesc: 'From casual chats to lectures and meetings. Speak and get JP↔KR translations instantly. Share a room code to begin.',
    footerTagline: 'JP↔KR real-time interpretation',
    pageTitle: 'どーなつ — JP↔KR Interpretation',
    backHome: 'Back to home',
    edit: 'Edit',
    editHint: 'Correct the recognized text, then re-translate',
    editCancel: 'Cancel',
    editSave: 'Re-translate',
  },
};

function canNativeShare() {
  return typeof navigator.share === 'function';
}

function isMobileView() {
  return window.matchMedia('(max-width: 600px)').matches;
}

function updateShareButton() {
  var show = isMobileView() && canNativeShare();
  qrShareBtn.classList.toggle('hidden', !show);
  qrActions.classList.toggle('has-share', show);
}

function roomShareUrl(id) {
  return location.origin + location.pathname + '?room=' + id;
}

function updateRoomUrl(id) {
  var url = id ? roomShareUrl(id) : location.pathname;
  history.replaceState(null, '', url);
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

function setText(id, text, html) {
  var el = document.getElementById(id);
  if (!el) return;
  if (html) el.innerHTML = text;
  else el.textContent = text;
}

function scrollToStart() {
  var el = document.getElementById('start');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function applyUI() {
  var t = TXT[UI];
  document.documentElement.lang = UI;
  document.title = t.pageTitle;
  spkInput.placeholder = t.ph;
  textInput.placeholder = t.inputPh;
  inputHint.textContent = t.inputHint;
  emptyText.textContent = t.empty;
  sendBtn.textContent = t.send;
  recordBtn.textContent = t.rec;
  lobbySub.textContent = t.lobbySub;
  joinBtn.textContent = t.join;
  newRoomBtn.textContent = t.newRoom;
  if (createPasswordLabel) createPasswordLabel.textContent = t.createPasswordLabel;
  applyRoomCreatePolicy();
  if (screenLink) screenLink.textContent = t.screen;
  dissolveBtn.textContent = t.dissolve;
  dissolveBtn.title = t.dissolveConfirm;
  roomBadgeIcon.textContent = 'QR';
  qrTitle.textContent = t.qrShare;
  qrHint.textContent = t.qrHint;
  qrShareBtn.textContent = t.share;
  qrCopyBtn.textContent = t.copyLink;
  if (qrScreenLink) qrScreenLink.textContent = t.openScreen;
  setText('brandName', t.serviceName);
  setText('heroTitle', t.serviceName);
  setText('chatLogoName', t.serviceName);
  if (homeBtn) homeBtn.title = t.backHome;
  setText('heroBadge', t.heroBadge);
  setText('heroDesc', t.heroDesc);
  setText('langLabel', t.lang);
  setText('footerTagline', t.footerTagline);
  updateRoomBadge();
  updateScreenLink();
  updateShareButton();
}

function updateRoomBadge() {
  if (!roomId) return;
  roomBadgeLabel.textContent = TXT[UI].roomLabel;
  roomBadgeNum.textContent = roomId;
  roomBadge.title = TXT[UI].qrTap;
}

function activeRoomId() {
  return roomId || parseRoomFromUrl();
}

function screenPageUrl() {
  var url = new URL('screen.html', location.href);
  var id = activeRoomId();
  if (id) url.searchParams.set('room', id);
  else url.searchParams.delete('room');
  return url.href;
}

function updateScreenLink() {
  var url = screenPageUrl();
  if (screenLink) screenLink.setAttribute('href', url);
  if (qrScreenLink) qrScreenLink.setAttribute('href', url);
}

function openScreenPage(e) {
  if (e) e.preventDefault();
  var url = screenPageUrl();
  window.open(url, '_blank', 'noopener,noreferrer');
  setTimeout(hideMenu, 0);
}

function hideMenu() {
  menuDrop.classList.add('hidden');
}

function hideQrModal() {
  qrModal.classList.add('hidden');
  qrCodeEl.innerHTML = '';
}

function shareRoom() {
  if (!roomId || !canNativeShare()) return;
  var text = TXT[UI].shareText.replace('{room}', roomId);
  navigator.share({
    title: TXT[UI].serviceName,
    text: text,
    url: roomShareUrl(roomId),
  }).catch(function(err) {
    if (err && err.name !== 'AbortError') copyRoomLink(null);
  });
}

function showQrModal() {
  hideMenu();
  if (!roomId || typeof QRCode === 'undefined') return;
  updateShareButton();
  qrRoomNum.textContent = roomId;
  qrCodeEl.innerHTML = '';
  new QRCode(qrCodeEl, {
    text: roomShareUrl(roomId),
    width: 200,
    height: 200,
    colorDark: '#000000',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M,
  });
  qrModal.classList.remove('hidden');
}

var copyToastTimer = null;

function showCopyToast() {
  copyToast.textContent = TXT[UI].linkCopied;
  copyToast.classList.add('show');
  if (copyToastTimer) clearTimeout(copyToastTimer);
  copyToastTimer = setTimeout(function() {
    copyToast.classList.remove('show');
  }, 1500);
}

function copyRoomLink(btn) {
  if (!roomId) return;
  navigator.clipboard.writeText(roomShareUrl(roomId)).then(function() {
    if (btn) {
      var orig = btn.textContent;
      btn.textContent = TXT[UI].linkCopied;
      setTimeout(function() { btn.textContent = orig; }, 1500);
    } else {
      showCopyToast();
    }
  }).catch(function() {});
}

function getRoomCode() {
  return roomDigits.map(function(el) { return el.value; }).join('');
}

function setRoomCode(code) {
  var digits = (code || '').replace(/\D/g, '').slice(0, 6);
  for (var i = 0; i < roomDigits.length; i++) {
    roomDigits[i].value = digits[i] || '';
    roomDigits[i].classList.toggle('filled', !!digits[i]);
  }
}

function clearRoomCode() {
  setRoomCode('');
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
          roomDigits[idx + j].classList.add('filled');
        }
        focusRoomDigit(Math.min(idx + v.length, roomDigits.length - 1));
        return;
      }
      this.value = v;
      this.classList.toggle('filled', !!v);
      if (v && idx < roomDigits.length - 1) focusRoomDigit(idx + 1);
    });

    input.addEventListener('keydown', function(e) {
      if (e.key === 'Backspace') {
        if (!this.value && idx > 0) {
          roomDigits[idx - 1].value = '';
          roomDigits[idx - 1].classList.remove('filled');
          focusRoomDigit(idx - 1);
          e.preventDefault();
        } else if (this.value) {
          this.classList.remove('filled');
        }
      }
      if (e.key === 'ArrowLeft' && idx > 0) {
        focusRoomDigit(idx - 1);
        e.preventDefault();
      }
      if (e.key === 'ArrowRight' && idx < roomDigits.length - 1) {
        focusRoomDigit(idx + 1);
        e.preventDefault();
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        joinBtn.click();
      }
    });

    input.addEventListener('focus', function() {
      this.select();
    });
  });

  roomCodeEl.addEventListener('paste', function(e) {
    e.preventDefault();
    var text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6);
    setRoomCode(text);
    lobbyError.textContent = '';
    focusRoomDigit(text.length >= 6 ? 5 : text.length);
  });
}

function handleRoomClosed(reason) {
  roomEnded = true;
  intentionalClose = true;
  if (ws) { ws.close(); ws = null; }
  var msg = reason === 'idle' ? TXT[UI].roomExpired : TXT[UI].roomDissolved;
  showLobby(msg);
}

function speakerColor(name) {
  var h = 0;
  for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return SPEAKER_COLORS[h % SPEAKER_COLORS.length];
}

function updateEmptyState() {
  var hasEntries = logEl.querySelector('.entry');
  emptyState.classList.toggle('hidden', !!hasEntries);
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

function clearLog() {
  entries = {};
  ownUids = {};
  oldestMsgId = null;
  historyLoading = false;
  historyExhausted = false;
  historyLoaded = false;
  logEl.querySelectorAll('.entry').forEach(function(el) { el.remove(); });
  historyTopEl.classList.add('hidden');
  historyTopEl.textContent = '';
  updateEmptyState();
}

function loadHistory(beforeId, isInitial) {
  if (!roomId || historyLoading) return;
  if (!isInitial && historyExhausted) return;
  historyLoading = true;
  historyTopEl.textContent = TXT[UI].historyLoading;
  historyTopEl.classList.remove('hidden');

  var url = '/room/' + roomId + '/messages?limit=' + HISTORY_PAGE;
  if (beforeId) url += '&before_id=' + beforeId;

  fetch(url).then(function(r) {
    if (!r.ok) throw new Error('history failed');
    return r.json();
  }).then(function(data) {
    var msgs = data.messages || [];
    if (msgs.length) {
      oldestMsgId = msgs[0].id;
      if (isInitial) {
        msgs.forEach(function(m) { renderHistoryMessage(m, false); });
        logEl.scrollTop = logEl.scrollHeight;
      } else {
        var prevHeight = logEl.scrollHeight;
        msgs.forEach(function(m) { renderHistoryMessage(m, true); });
        logEl.scrollTop = logEl.scrollHeight - prevHeight;
      }
    }
    if (!data.has_more) historyExhausted = true;
    historyTopEl.classList.add('hidden');
    historyTopEl.textContent = '';
    updateEmptyState();
  }).catch(function() {
    historyTopEl.classList.add('hidden');
    historyTopEl.textContent = '';
  }).finally(function() {
    historyLoading = false;
  });
}

function renderHistoryMessage(msg, prepend) {
  var uid = msg.uid;
  if (!uid || entries[uid]) return;
  var ml = myLang.value;
  var isMine = msg.src_lang === ml || msg.spk === spk();
  if (isMine) ownUids[uid] = true;
  var mainText = isMine ? msg.src : (msg.full || '');
  var subText = isMine ? (msg.full || '') : msg.src;
  createEntry(uid, msg.spk || '?', mainText, subText, true, isMine, {
    prepend: prepend,
    ts: Math.round((msg.ts || 0) * 1000),
  });
}

function showChat(id, opts) {
  if (!id || !/^\d{6}$/.test(id)) return;
  opts = opts || {};
  hasConnected = false;
  roomEnded = false;
  clearLog();
  roomId = id;
  WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/' + roomId;
  updateRoomBadge();
  updateScreenLink();
  updateRoomUrl(roomId);
  lobbyEl.classList.add('hidden');
  chatEl.classList.add('open');
  dissolveBtn.disabled = false;
  connect();
  if (opts.showQr) showQrModal();
}

function showLobby(errMsg) {
  hideQrModal();
  hideMenu();
  copyToast.classList.remove('show');
  if (copyToastTimer) clearTimeout(copyToastTimer);
  if (ws) { intentionalClose = true; ws.close(); ws = null; }
  dissolveBtn.disabled = false;
  roomId = '';
  updateScreenLink();
  updateRoomUrl('');
  lobbyEl.classList.remove('hidden');
  lobbyEl.scrollTop = 0;
  fetchRoomPolicy();
  chatEl.classList.remove('open');
  clearRoomCode();
  lobbyError.textContent = errMsg || '';
  scrollToStart();
}

function connect() {
  if (!roomId) return;
  intentionalClose = false;
  var gotSystem = false;
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
  ws.onclose = function(ev) {
    connDot.className = 'dot off';
    connLabel.textContent = TXT[UI].disc;
    recordBtn.disabled = true;
    textInput.disabled = true;
    sendBtn.disabled = true;
    if (isRecording) stopRecording();
    if (!intentionalClose && !hasConnected && !gotSystem) {
      showLobby(TXT[UI].roomNotFound);
      return;
    }
    if (!intentionalClose && !roomEnded && hasConnected) {
      checkRoomExists(roomId).then(function(exists) {
        if (!exists) {
          showLobby(TXT[UI].roomNotFound);
          return;
        }
        setStatus(TXT[UI].recon);
        setTimeout(connect, 2000);
      }).catch(function() {
        setStatus(TXT[UI].recon);
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
    if (msg.type === 'system' && msg.speaker_id) {
      gotSystem = true;
      hasConnected = true;
      if (!nickCustomized) spkInput.value = msg.speaker_id;
      if (!historyLoaded) {
        historyLoaded = true;
        loadHistory(null, true);
      }
      return;
    }
    handleServerMsg(msg);
  };
}

var entries = {};
var ownUids = {};
var editingUid = null;

var EDIT_ICON_SVG =
  '<svg class="edit-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 20h9"/>' +
  '<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>' +
  '</svg>';

function createEditButton(uid) {
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-edit';
  btn.setAttribute('aria-label', TXT[UI].edit);
  btn.innerHTML = EDIT_ICON_SVG;
  btn.addEventListener('click', function(ev) {
    ev.stopPropagation();
    startEditEntry(uid);
  });
  return btn;
}

function showEditButton(e) {
  if (!e || !e.isMine || !e.editBtn) return;
  e.row.classList.add('is-final');
  e.row.classList.remove('revising');
  e.editBtn.hidden = false;
}

function hideEditButton(e) {
  if (!e || !e.editBtn) return;
  e.editBtn.hidden = true;
}

function finishEditEntry(restore) {
  if (!editingUid) return;
  var e = entries[editingUid];
  if (!e) {
    editingUid = null;
    return;
  }
  e.row.classList.remove('editing');
  e.main.style.display = '';
  e.sub.style.display = '';
  if (e.editBtn && e.row.classList.contains('is-final')) e.editBtn.hidden = false;
  if (e.editArea) { e.editArea.remove(); e.editArea = null; }
  if (e.editHint) { e.editHint.remove(); e.editHint = null; }
  if (e.editActions) { e.editActions.remove(); e.editActions = null; }
  if (restore) {
    e.main.textContent = e._editOrigMain || e.main.textContent;
    e.sub.textContent = e._editOrigSub || e.sub.textContent;
  }
  delete e._editOrigMain;
  delete e._editOrigSub;
  editingUid = null;
}

function startEditEntry(uid) {
  var e = entries[uid];
  if (!e || !e.isMine || editingUid === uid) return;
  if (editingUid) finishEditEntry(true);

  editingUid = uid;
  e._editOrigMain = e.srcText || e.main.textContent;
  e._editOrigSub = e.sub.textContent;
  e.row.classList.add('editing');
  e.main.style.display = 'none';
  e.sub.style.display = 'none';
  hideEditButton(e);

  var area = document.createElement('textarea');
  area.className = 'edit-area';
  area.value = e._editOrigMain;
  area.rows = 3;

  var hint = document.createElement('div');
  hint.className = 'edit-hint';
  hint.textContent = TXT[UI].editHint;

  var actions = document.createElement('div');
  actions.className = 'edit-actions';

  var cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-edit-cancel';
  cancelBtn.textContent = TXT[UI].editCancel;
  cancelBtn.addEventListener('click', function() { finishEditEntry(true); });

  var saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn-edit-save';
  saveBtn.textContent = TXT[UI].editSave;
  saveBtn.addEventListener('click', function() { submitRetranslate(uid); });

  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);

  e.row.insertBefore(area, e.sub);
  e.row.insertBefore(hint, e.sub);
  e.row.appendChild(actions);
  e.editArea = area;
  e.editHint = hint;
  e.editActions = actions;
  area.focus();
  area.setSelectionRange(area.value.length, area.value.length);
}

function submitRetranslate(uid) {
  var e = entries[uid];
  if (!e || !e.editArea) return;
  var text = e.editArea.value.trim();
  if (!text) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  finishEditEntry(false);
  e.awaitingRevision = true;
  e.srcText = text;
  e.row.classList.add('revising');
  e.row.classList.remove('error');
  e.main.textContent = text;
  e.main.className = 'main tent';
  e.main.style.display = '';
  e.sub.textContent = TXT[UI].waiting + '…';
  e.sub.className = WAITING_CLS;
  e.sub.style.display = '';
  hideEditButton(e);

  ws.send(JSON.stringify({
    type: 'retranslate',
    uid: uid,
    text: text,
    source_lang: 'auto',
    target_lang: 'auto',
    speaker_id: spk(),
  }));
}

function findEntryByUid(uid) {
  if (entries[uid]) return entries[uid];
  var row = logEl.querySelector('.entry[data-uid="' + uid + '"]');
  if (!row) return null;
  var e = {
    row: row,
    head: row.querySelector('.entry-head'),
    main: row.querySelector('.main'),
    sub: row.querySelector('.sub'),
    editBtn: row.querySelector('.btn-edit'),
    isMine: row.classList.contains('mine'),
  };
  entries[uid] = e;
  return e;
}

function resolveMineSrc(e, serverSrc, isFinal) {
  var local = e.srcText || e.main.textContent || '';
  if (!serverSrc) return local;
  if (!local) return serverSrc;
  if (!isFinal && serverSrc.length < local.length) return local;
  return serverSrc.length >= local.length ? serverSrc : local;
}

function applyEntryText(e, src, tgt, isFinal) {
  if (!e || !e.main || !e.sub) return;
  var isMine = e.isMine;
  if (isMine) {
    var useSrc = resolveMineSrc(e, src || '', isFinal);
    e.main.textContent = useSrc;
    e.sub.textContent = tgt || '';
    e.main.className = 'main ' + (isFinal ? 'final' : 'tent');
    e.sub.className = tgt ? ('sub ' + (isFinal ? 'final' : 'tent')) : WAITING_CLS;
    if (!tgt && e.sub.className === WAITING_CLS) {
      e.sub.textContent = TXT[UI].waiting + '…';
    }
    if (useSrc) e.srcText = useSrc;
  } else {
    // Source may arrive before translation (server-driven src-first broadcast).
    if (tgt) {
      e.main.textContent = tgt;
      e.sub.textContent = src || '';
      e.main.className = 'main ' + (isFinal ? 'final' : 'tent');
      e.sub.className = 'sub final';
    } else {
      e.main.textContent = src || '';
      e.main.className = 'main tent';
      e.sub.textContent = TXT[UI].waiting + '…';
      e.sub.className = WAITING_CLS;
    }
  }
  if (isFinal) {
    e.row.classList.remove('interim', 'revising');
    e.row.classList.add('is-final');
    e.row.dataset.final = 'true';
    if (isMine) showEditButton(e);
  }
}

function handleServerMsg(msg) {
  if (msg.type === 'error') {
    showError(msg.message || TXT[UI].errPrefix, msg.uid);
    return;
  }

  // Server rejected a duplicate segment — drop the optimistic local bubble.
  if (msg.type === 't_skip') {
    var skipUid = msg.uid;
    if (skipUid && entries[skipUid]) {
      var skipE = entries[skipUid];
      if (skipE.row && skipE.row.parentNode) skipE.row.remove();
      delete entries[skipUid];
      updateEmptyState();
    }
    return;
  }

  var uid = msg.uid;
  var isFinal = msg.final;
  var revised = !!msg.revised;

  if (revised) {
    var revEntry = findEntryByUid(uid);
    if (!revEntry) return;
    if (editingUid === uid) finishEditEntry(false);
    revEntry.awaitingRevision = false;
    if (msg.type === 't_chunk') {
      applyEntryText(revEntry, msg.src, msg.acc || '', false);
      return;
    }
    if (msg.type === 't_done') {
      applyEntryText(revEntry, msg.src, msg.full || '', true);
      return;
    }
    return;
  }

  var e = findEntryByUid(uid);
  if (e && e.awaitingRevision) return;

  if (!e) {
    if (!msg.src && !(msg.acc || msg.full)) return;
    var ml = myLang.value;
    var isMine = !!ownUids[uid] || msg.src_lang === ml;
    var tgt0 = msg.acc || msg.full || '';
    var mainText;
    var subText;
    if (isMine) {
      mainText = msg.src || '';
      subText = tgt0;
    } else if (tgt0) {
      mainText = tgt0;
      subText = msg.src || '';
    } else {
      // Peer source arrived before translation — show source as provisional main.
      mainText = msg.src || '';
      subText = '';
    }
    createEntry(uid, msg.spk || '?', mainText, subText, isFinal, isMine);
    return;
  }

  var isMine = e.isMine;

  if (msg.type === 't_chunk') {
    if (editingUid === uid) finishEditEntry(false);
    if (isMine) e.row.classList.remove('revising');
    applyEntryText(e, msg.src, msg.acc || '', isFinal);
  }

  if (msg.type === 't_done') {
    if (editingUid === uid) finishEditEntry(false);
    applyEntryText(e, msg.src, msg.full || '', true);
  }

  if (msg.type === 't_chunk' && isFinal && isMine) {
    showEditButton(e);
  }
}

function createEntry(uid, spkLabel, mainText, subText, isFinal, isMine, opts) {
  opts = opts || {};
  var row = document.createElement('div');
  row.className = 'entry ' + (isMine ? 'mine' : 'other');
  row.dataset.uid = uid;
  row.dataset.ts = opts.ts || Date.now();

  var color = speakerColor(spkLabel);
  var spkSpan = document.createElement('div');
  spkSpan.className = 'spk';
  spkSpan.style.color = color;
  var dot = document.createElement('span');
  dot.className = 'spk-dot';
  dot.style.background = color;
  spkSpan.appendChild(dot);
  spkSpan.appendChild(document.createTextNode(esc(spkLabel)));

  var head = document.createElement('div');
  head.className = 'entry-head';
  head.appendChild(spkSpan);

  var main = document.createElement('div');
  main.className = 'main ' + (isFinal ? 'final' : 'tent');
  main.textContent = mainText;

  var sub = document.createElement('div');
  if (!subText) {
    sub.className = WAITING_CLS;
    sub.textContent = TXT[UI].waiting + '…';
  } else {
    sub.className = 'sub ' + (isFinal ? 'final' : 'tent');
    sub.textContent = subText;
  }

  row.appendChild(head);
  row.appendChild(main);
  row.appendChild(sub);

  var editBtn = null;
  if (isMine) {
    editBtn = createEditButton(uid);
    editBtn.hidden = true;
    head.appendChild(editBtn);
    if (isFinal) row.classList.add('is-final');
  }

  if (opts.prepend) {
    var anchor = logEl.querySelector('.entry');
    if (anchor) logEl.insertBefore(row, anchor);
    else logEl.appendChild(row);
  } else {
    logEl.appendChild(row);
    if (!opts.noScroll) logEl.scrollTop = logEl.scrollHeight;
  }

  entries[uid] = {
    row: row, head: head, main: main, sub: sub, editBtn: editBtn,
    isMine: !!isMine, srcText: mainText,
  };
  if (isMine && isFinal) showEditButton(entries[uid]);
  updateEmptyState();
  trimEntries();
}

function showError(message, uid) {
  if (uid && entries[uid]) {
    var e = entries[uid];
    e.awaitingRevision = false;
    e.row.classList.remove('revising');
    e.sub.textContent = TXT[UI].errPrefix + ': ' + message;
    e.sub.className = 'sub tent';
    e.row.classList.add('error');
    if (e.isMine && e.row.classList.contains('is-final')) showEditButton(e);
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

function insertNewlineAtCursor(el) {
  var start = el.selectionStart;
  var end = el.selectionEnd;
  var value = el.value;
  el.value = value.slice(0, start) + '\n' + value.slice(end);
  var pos = start + 1;
  el.selectionStart = pos;
  el.selectionEnd = pos;
}

/* ---- recording (final-segment / text-idle / server-driven) ---- */

function normalizeSpeechText(s) {
  return String(s || '').replace(/\s+/g, '').toLowerCase();
}

function pruneSpeechDedupLedger() {
  var now = Date.now();
  speechSentHashes = speechSentHashes.filter(function(e) {
    return now - e.at < SPEECH_DEDUP_TTL_MS;
  });
  if (speechSentHashes.length > SPEECH_DEDUP_MAX) {
    speechSentHashes = speechSentHashes.slice(-SPEECH_DEDUP_MAX);
  }
}

function rememberSpeechSent(text) {
  var h = normalizeSpeechText(text);
  if (!h) return;
  pruneSpeechDedupLedger();
  speechSentHashes.push({ hash: h, at: Date.now() });
  if (speechSentHashes.length > SPEECH_DEDUP_MAX) {
    speechSentHashes = speechSentHashes.slice(-SPEECH_DEDUP_MAX);
  }
}

function isDuplicateSpeech(text) {
  var h = normalizeSpeechText(text);
  if (!h) return true;
  if (h.length < SPEECH_MIN_SEND_CHARS) return true;
  pruneSpeechDedupLedger();
  var i;
  for (i = 0; i < speechSentHashes.length; i++) {
    var prev = speechSentHashes[i].hash;
    if (prev === h) return true;
    if (h.length >= 6 && prev.length >= 6) {
      if (prev.indexOf(h) !== -1 && h.length / prev.length >= 0.85) return true;
      if (h.indexOf(prev) !== -1 && prev.length / h.length >= 0.85) return true;
    }
  }
  return false;
}

/** Shortest raw suffix of `raw` whose normalized form equals `restNorm`. */
function rawTailMatchingNorm(raw, restNorm) {
  if (!restNorm) return '';
  var i;
  for (i = 0; i < raw.length; i++) {
    if (normalizeSpeechText(raw.slice(i)) === restNorm) {
      return raw.slice(i).trim();
    }
  }
  return restNorm;
}

/**
 * If `text` extends already-sent cumulative content, return only the new tail.
 * Otherwise return the full trimmed text (new segment).
 */
function speechDeltaFrom(text) {
  text = (text || '').trim();
  if (!text) return '';
  var h = normalizeSpeechText(text);
  if (!h) return '';
  if (speechSentCumulativeNorm) {
    if (h === speechSentCumulativeNorm || speechSentCumulativeNorm.indexOf(h) === 0) {
      return '';
    }
    if (h.indexOf(speechSentCumulativeNorm) === 0) {
      var restNorm = h.slice(speechSentCumulativeNorm.length);
      if (!restNorm) return '';
      return rawTailMatchingNorm(text, restNorm);
    }
  }
  return text;
}

function clearSpeechTextIdleTimer() {
  if (speechTextIdleTimer) {
    clearTimeout(speechTextIdleTimer);
    speechTextIdleTimer = null;
  }
}

function resetSpeechState() {
  speechInterim = '';
  speechEmittedKeys = {};
  speechRecGen = 0;
  speechSentHashes = [];
  speechSentCumulativeNorm = '';
  speechWatchText = '';
  clearSpeechTextIdleTimer();
}

function clearLocalInterim() {
  if (localInterim) {
    localInterim.remove();
    localInterim = null;
  }
}

function updateSpeechPreview(interimText) {
  speechInterim = interimText || '';
  var t = speechInterim.trim();
  if (!t) {
    clearLocalInterim();
    return;
  }
  if (!localInterim) {
    localInterim = document.createElement('div');
    localInterim.className = 'entry mine interim';
    var color = speakerColor(spk());
    localInterim.innerHTML =
      '<div class="entry-head">' +
      '<div class="spk" style="color:' + color + '">' +
      '<span class="spk-dot" style="background:' + color + '"></span>' +
      esc(spk()) + '</div></div>' +
      '<div class="main tent"></div>';
    logEl.appendChild(localInterim);
    updateEmptyState();
  }
  localInterim.querySelector('.main').textContent = t;
  logEl.scrollTop = logEl.scrollHeight;
}

/**
 * Send one bubble for the unsent delta of `text`.
 * Used for ASR finals and text-idle interim flushes.
 */
function emitSpeechDelta(text) {
  var delta = speechDeltaFrom(text);
  delta = (delta || '').trim();
  if (delta.length < SPEECH_MIN_SEND_CHARS) return false;
  if (isDuplicateSpeech(delta)) return false;
  rememberSpeechSent(delta);
  speechSentCumulativeNorm += normalizeSpeechText(delta);
  send(delta, true);
  return true;
}

/**
 * Arm / re-arm text-stall flush. Cuts when recognized characters stop growing,
 * even if the user fills silence with えー / 음… (audio silence never comes).
 */
function noteSpeechTextActivity(liveText) {
  var t = (liveText || '').trim();
  var norm = normalizeSpeechText(t);
  var prevNorm = normalizeSpeechText(speechWatchText);
  if (norm !== prevNorm) {
    // Characters changed → restart the stall clock.
    speechWatchText = t;
    scheduleTextIdleFlush();
    return;
  }
  // Same text: do NOT reset the timer (otherwise repeated interim events never flush).
  if (t && !speechTextIdleTimer && speechDeltaFrom(t)) {
    scheduleTextIdleFlush();
  }
}

function scheduleTextIdleFlush() {
  clearSpeechTextIdleTimer();
  if (!isRecording) return;
  var live = (speechInterim || speechWatchText || '').trim();
  if (normalizeSpeechText(live).length < SPEECH_TEXT_IDLE_MIN_CHARS) return;
  // Only worth waiting if there is an unsent delta.
  if (!speechDeltaFrom(live)) return;

  speechTextIdleTimer = setTimeout(function() {
    speechTextIdleTimer = null;
    if (!isRecording) return;
    var t = (speechInterim || speechWatchText || '').trim();
    if (!t) return;
    if (normalizeSpeechText(t).length < SPEECH_TEXT_IDLE_MIN_CHARS) return;
    emitSpeechDelta(t);
    // If text is still the same, no re-arm; new onresult will re-arm.
  }, SPEECH_TEXT_IDLE_MS);
}

function processSpeechResults(results, resultIndex) {
  var i;
  for (i = resultIndex; i < results.length; i++) {
    if (!results[i].isFinal) continue;
    var key = speechRecGen + ':' + i;
    if (speechEmittedKeys[key]) continue;
    speechEmittedKeys[key] = true;
    var piece = (results[i][0] && results[i][0].transcript) || '';
    emitSpeechDelta(piece);
  }

  var interim = '';
  for (i = results.length - 1; i >= 0; i--) {
    if (!results[i].isFinal) {
      interim = (results[i][0] && results[i][0].transcript) || '';
      break;
    }
  }
  updateSpeechPreview(interim);
  // Watch interim (or last final piece) for character-stall segmentation.
  noteSpeechTextActivity(interim || speechWatchText);
}

function flushInterimOnStop() {
  clearSpeechTextIdleTimer();
  var t = (speechInterim || speechWatchText || '').trim();
  speechInterim = '';
  clearLocalInterim();
  if (t) emitSpeechDelta(t);
}

function startRecording() {
  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { alert(TXT[UI].noSpeech); return; }

  resetSpeechState();
  clearLocalInterim();

  recognition = new SpeechRecognition();
  recognition.lang = SR_LANG[myLang.value] || 'ja-JP';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = function(event) {
    processSpeechResults(event.results, event.resultIndex);
  };

  recognition.onerror = function(event) {
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    setStatus(TXT[UI].errPrefix + ': ' + event.error);
    stopRecording();
  };

  recognition.onend = function() {
    if (!isRecording) return;
    // New recognition generation: result indices reset; do NOT re-send past finals.
    speechRecGen += 1;
    try { recognition.start(); } catch (e) {}
  };

  recognition.start();
  isRecording = true;
  recordBtn.textContent = TXT[UI].stop;
  recordBtn.className = 'btn-record recording';
  setStatus(TXT[UI].recOn);
}

function stopRecording() {
  isRecording = false;
  flushInterimOnStop();
  resetSpeechState();
  if (recognition) {
    try { recognition.stop(); } catch (e) {}
    recognition = null;
  }
  recordBtn.textContent = TXT[UI].rec;
  recordBtn.className = 'btn-record idle';
  setStatus(TXT[UI].recOff);
}

/* ---- send ---- */

function send(text, isFinal, opts) {
  opts = opts || {};
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!text) return;

  var uid = opts.uid || (clientId + '-' + (++uttId));
  ownUids[uid] = true;
  var isContinuation = !!opts.continuation;
  var fullSrc = opts.fullSrc || text;

  if (!isContinuation || !entries[uid]) {
    createEntry(uid, spk(), fullSrc, '', isFinal, true);
  } else {
    entries[uid].main.textContent = fullSrc;
    entries[uid].srcText = fullSrc;
    if (!entries[uid].sub.textContent || entries[uid].sub.className === WAITING_CLS) {
      entries[uid].sub.textContent = TXT[UI].waiting + '…';
      entries[uid].sub.className = WAITING_CLS;
    }
  }
  if (entries[uid]) {
    logEl.scrollTop = logEl.scrollHeight;
  }

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

/* ---- room create policy ---- */

function applyRoomCreatePolicy() {
  if (!createWrap || !lobbyDivider) return;
  if (roomCreateMode === 'closed') {
    createWrap.classList.add('hidden');
    lobbyDivider.classList.add('hidden');
    return;
  }
  createWrap.classList.remove('hidden');
  lobbyDivider.classList.remove('hidden');
  var needsPassword = roomCreateMode === 'password';
  if (createPassword) {
    createPassword.classList.toggle('hidden', !needsPassword);
    if (!needsPassword) createPassword.value = '';
  }
  if (createPasswordLabel) {
    createPasswordLabel.classList.toggle('hidden', !needsPassword);
  }
}

function fetchRoomPolicy() {
  return fetch('/api/room-policy').then(function(r) {
    if (!r.ok) return { mode: 'open' };
    return r.json();
  }).then(function(data) {
    roomCreateMode = data.mode || 'open';
    applyRoomCreatePolicy();
  }).catch(function() {
    roomCreateMode = 'open';
    applyRoomCreatePolicy();
  });
}

function roomCreateErrorMessage(data) {
  var detail = data && data.detail;
  var code = detail && detail.code;
  var t = TXT[UI];
  if (code === 'room_creation_closed') return t.roomCreateClosed;
  if (code === 'room_password_required') return t.roomPasswordRequired;
  if (code === 'room_password_invalid') return t.roomPasswordInvalid;
  if (detail && detail.message) return detail.message;
  if (typeof detail === 'string') return detail;
  return t.roomCreateFailed;
}

function parseRoomCreateResponse(r) {
  return r.json().then(function(data) {
    if (!r.ok) {
      var err = new Error(roomCreateErrorMessage(data));
      err.data = data;
      throw err;
    }
    return data;
  });
}

/* ---- lobby events ---- */

function joinRoom(val) {
  if (!/^\d{6}$/.test(val)) {
    lobbyError.textContent = TXT[UI].invalidRoom;
    return;
  }
  lobbyError.textContent = '';
  joinBtn.disabled = true;
  checkRoomExists(val).then(function(exists) {
    if (!exists) {
      lobbyError.textContent = TXT[UI].roomNotFound;
      return;
    }
    showChat(val);
  }).catch(function() {
    lobbyError.textContent = TXT[UI].errPrefix + ': ' + TXT[UI].roomNotFound;
  }).finally(function() {
    joinBtn.disabled = false;
  });
}

newRoomBtn.addEventListener('click', function() {
  lobbyError.textContent = '';
  if (roomCreateMode === 'password') {
    if (!createPassword || !createPassword.value.trim()) {
      lobbyError.textContent = TXT[UI].roomPasswordRequired;
      return;
    }
  }
  newRoomBtn.disabled = true;
  newRoomBtn.textContent = '...';
  var body = null;
  if (roomCreateMode === 'password' && createPassword) {
    body = JSON.stringify({ password: createPassword.value.trim() });
  }
  fetch('/room', {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body,
  }).then(parseRoomCreateResponse).then(function(data) {
    if (!data || !data.room) throw new Error(TXT[UI].roomCreateFailed);
    if (createPassword) createPassword.value = '';
    showChat(data.room, { showQr: true });
  }).catch(function(err) {
    lobbyError.textContent = TXT[UI].errPrefix + ': ' + (err.message || TXT[UI].roomCreateFailed);
  }).finally(function() {
    newRoomBtn.disabled = false;
    newRoomBtn.textContent = TXT[UI].newRoom;
  });
});

joinBtn.addEventListener('click', function() {
  joinRoom(getRoomCode());
});

if (homeBtn) {
  homeBtn.addEventListener('click', function() {
    if (isRecording) stopRecording();
    showLobby();
  });
}

dissolveBtn.addEventListener('click', function() {
  hideMenu();
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!confirm(TXT[UI].dissolveConfirm)) return;
  dissolveBtn.disabled = true;
  ws.send(JSON.stringify({ type: 'dissolve' }));
});

menuBtn.addEventListener('click', function(e) {
  e.stopPropagation();
  updateScreenLink();
  menuDrop.classList.toggle('hidden');
});

if (screenLink) {
  screenLink.addEventListener('click', openScreenPage);
}
if (qrScreenLink) {
  qrScreenLink.addEventListener('click', openScreenPage);
}

menuDrop.addEventListener('click', function(e) {
  e.stopPropagation();
  if (e.target.closest('a')) {
    setTimeout(hideMenu, 0);
  }
});

document.addEventListener('click', hideMenu);

qrClose.addEventListener('click', hideQrModal);

qrModal.addEventListener('click', function(e) {
  if (e.target === qrModal) hideQrModal();
});

qrShareBtn.addEventListener('click', shareRoom);

qrCopyBtn.addEventListener('click', function() {
  copyRoomLink(qrCopyBtn);
});

window.addEventListener('resize', updateShareButton);

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && !qrModal.classList.contains('hidden')) hideQrModal();
});

roomBadge.addEventListener('click', function() {
  showQrModal();
});

/* ---- chat events ---- */

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
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    insertNewlineAtCursor(this);
    resizeTextarea();
    return;
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendText();
  }
});

function setStatus(s) { statusMsg.textContent = s; }

setupRoomCodeInputs();
logEl.addEventListener('scroll', function() {
  if (scrollTimer) clearTimeout(scrollTimer);
  scrollTimer = setTimeout(function() {
    scrollTimer = null;
    if (logEl.scrollTop < 60 && oldestMsgId && !historyExhausted && !historyLoading) {
      loadHistory(oldestMsgId, false);
    }
  }, 120);
});

applyUI();
fetchRoomPolicy();
myLang.value = UI === 'ko' ? 'ko' : 'ja';
dirHint.textContent = TXT[UI].dir[myLang.value];
setStatus(TXT[UI].ready);
updateEmptyState();

var urlRoom = parseRoomFromUrl();
if (urlRoom) {
  setRoomCode(urlRoom);
  joinRoom(urlRoom);
} else {
  focusRoomDigit(0);
}
