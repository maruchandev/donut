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

const SPEECH_FLUSH_MS = 2500;
const SENTENCE_END_RE = /[。！？.!?\n]/;

let speechCommitted = '';
let speechInterim = '';
let speechSentLen = 0;
let speechFlushTimer = null;

const lobbyEl = document.getElementById('lobby');
const chatEl = document.getElementById('chat');
const scrollStartBtn = document.getElementById('scrollStartBtn');
const heroCtaBtn = document.getElementById('heroCtaBtn');
const roomCodeEl = document.getElementById('roomCode');
const roomDigits = Array.from(document.querySelectorAll('.room-digit'));
const joinBtn = document.getElementById('joinBtn');
const newRoomBtn = document.getElementById('newRoomBtn');
const lobbyError = document.getElementById('lobbyError');
const lobbySub = document.getElementById('lobbySub');
const roomBadge = document.getElementById('roomBadge');
const roomBadgeLabel = document.getElementById('roomBadgeLabel');
const roomBadgeNum = document.getElementById('roomBadgeNum');
const roomBadgeIcon = document.getElementById('roomBadgeIcon');
const copyToast = document.getElementById('copyToast');
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
    ready: '準備完了', rec: '録音', stop: '停止',
    recOn: '録音中', recOff: '停止', send: '送信',
    inputPh: 'テキストを入力...',
    inputHint: 'Enter で送信 · Ctrl+Enter で改行',
    empty: '録音ボタンまたはテキスト入力で翻訳を始めましょう',
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
    roomLabel: 'ルーム:',
    linkCopied: 'リンクをコピーしました',
    dissolve: 'ルームを解散',
    dissolveConfirm: 'ルームを解散しますか？全員が退出し、ルームは削除されます。',
    roomDissolved: 'ルームが解散されました',
    roomExpired: 'ルームが無操作のため終了しました（1時間）',
    qrShare: 'ルームを共有',
    qrHint: 'QRコードを読み取って入室',
    qrTap: 'タップしてQRコードを表示',
    copyLink: 'リンクをコピー',
    share: '共有',
    shareText: 'どーなつのルーム {room} に来てね',
    historyLoading: '過去の会話を読み込み中…',
    serviceName: 'どーなつ',
    scrollStart: 'はじめる',
    heroTagline: '日韓の会話を、まるくつなぐ。',
    heroDesc: '話すだけで翻訳が届く、カジュアルなリアルタイム通訳サービス。6桁のルーム番号を共有するだけで、日本語と韓国語のおしゃべりがはじまります。',
    heroCta: 'ルームに入る',
    aboutLabel: 'About',
    aboutHeading: 'どーなつとは？',
    aboutText: '<strong>どーなつ</strong>は、日本と韓国の言葉の壁をやわらかく越えるための通訳サービスです。旅行の同行者、オンラインの友達、言語交換——スマホひとつで、話した内容がその場で相手の言語に変わります。インストール不要、ブラウザだけで使えます。',
    featuresLabel: 'Features',
    featuresHeading: 'できること',
    featuresLead: 'カジュアルな会話に必要な機能を、シンプルにまとめました。',
    feat1Title: '話すだけ通訳', feat1Desc: '録音ボタンを押して話すと、リアルタイムで翻訳が表示されます。',
    feat2Title: 'テキストもOK', feat2Desc: '音声だけでなく、テキスト入力にも対応しています。',
    feat3Title: 'ルーム共有', feat3Desc: '6桁の番号・URL・QRコードで、すぐに仲間を招待できます。',
    feat4Title: '会話を残す', feat4Desc: '後から入った人も、これまでの会話を読み返せます。',
    howLabel: 'How it works',
    howHeading: '使い方',
    step1Title: 'ルームを作る', step1Desc: '「新しいルームを作成」で6桁の番号が発行されます。',
    step2Title: '番号を共有', step2Desc: 'QRコードやリンクで友達を招待しましょう。',
    step3Title: '話す言語を選ぶ', step3Desc: '日本語か韓国語を選ぶと、自動で相手の言語に翻訳されます。',
    step4Title: '話して、読む', step4Desc: '録音またはテキストで送信。翻訳がみんなの画面に届きます。',
    startLabel: 'Start',
    startHeading: 'はじめる',
    footerTagline: '日韓リアルタイム通訳',
    footerNote: 'ブラウザだけで使える、インストール不要の通訳サービス',
    pageTitle: 'どーなつ — 日韓リアルタイム通訳',
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
    lobbySub: '룸 번호를 입력하거나 새 룸을 만들어주세요',
    join: '입장',
    newRoom: '새로운 룸 만들기',
    roomCopied: '복사했습니다',
    invalidRoom: '6자리 숫자를 입력해주세요',
    roomNotFound: '룸을 찾을 수 없습니다',
    roomCreateFailed: '룸 생성에 실패했습니다',
    roomLabel: '룸:',
    linkCopied: '링크를 복사했습니다',
    dissolve: '룸 해산',
    dissolveConfirm: '룸을 해산하시겠습니까? 모든 참가자가 퇴장하고 룸이 삭제됩니다.',
    roomDissolved: '룸이 해산되었습니다',
    roomExpired: '1시간 동안 활동이 없어 룸이 종료되었습니다',
    qrShare: '룸 공유',
    qrHint: 'QR 코드를 스캔하여 입장',
    qrTap: '탭하여 QR 코드 표시',
    copyLink: '링크 복사',
    share: '공유',
    shareText: 'どーなつ 룸 {room}에 와요',
    historyLoading: '이전 대화 불러오는 중…',
    serviceName: 'どーなつ',
    scrollStart: '시작하기',
    heroTagline: '일본어와 한국어 대화를, 둥글게 이어요.',
    heroDesc: '말하기만 하면 번역이 도착하는 캐주얼 실시간 통역 서비스. 6자리 룸 번호만 공유하면 일본어와 한국어 수다가 시작됩니다.',
    heroCta: '룸 입장',
    aboutLabel: 'About',
    aboutHeading: 'どーなつ(도넛)이란?',
    aboutText: '<strong>どーなつ</strong>는 일본과 한국의 언어 장벽을 부드럽게 넘기 위한 통역 서비스입니다. 여행 동행, 온라인 친구, 언어 교환——스마트폰 하나로 말한 내용이 바로 상대 언어로 바뀝니다. 설치 없이 브라우저만으로 사용할 수 있습니다.',
    featuresLabel: 'Features',
    featuresHeading: '할 수 있는 것',
    featuresLead: '캐주얼한 대화에 필요한 기능을 심플하게 모았습니다.',
    feat1Title: '말하면 바로 통역', feat1Desc: '녹음 버튼을 누르고 말하면 실시간으로 번역이 표시됩니다.',
    feat2Title: '텍스트도 OK', feat2Desc: '음성뿐 아니라 텍스트 입력도 지원합니다.',
    feat3Title: '룸 공유', feat3Desc: '6자리 번호·URL·QR 코드로 바로 초대할 수 있습니다.',
    feat4Title: '대화 기록', feat4Desc: '나중에 들어온 사람도 지금까지의 대화를 볼 수 있습니다.',
    howLabel: 'How it works',
    howHeading: '사용 방법',
    step1Title: '룸 만들기', step1Desc: '「새로운 룸 만들기」로 6자리 번호가 발급됩니다.',
    step2Title: '번호 공유', step2Desc: 'QR 코드나 링크로 친구를 초대하세요.',
    step3Title: '언어 선택', step3Desc: '일본어 또는 한국어를 선택하면 자동으로 상대 언어로 번역됩니다.',
    step4Title: '말하고, 읽기', step4Desc: '녹음 또는 텍스트로 전송. 번역이 모두의 화면에 도착합니다.',
    startLabel: 'Start',
    startHeading: '시작하기',
    footerTagline: '일한 실시간 통역',
    footerNote: '브라우저만으로 사용하는 설치 불필요 통역 서비스',
    pageTitle: 'どーなつ — 일한 실시간 통역',
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
    lobbySub: 'Enter a room number or create a new room',
    join: 'Join',
    newRoom: 'Create New Room',
    roomCopied: 'Copied',
    invalidRoom: 'Enter a 6-digit number',
    roomNotFound: 'Room not found',
    roomCreateFailed: 'Failed to create room',
    roomLabel: 'Room:',
    linkCopied: 'Link copied',
    dissolve: 'End room',
    dissolveConfirm: 'End this room? Everyone will be removed and the room will be deleted.',
    roomDissolved: 'Room has been ended',
    roomExpired: 'Room closed due to inactivity (1 hour)',
    qrShare: 'Share room',
    qrHint: 'Scan the QR code to join',
    qrTap: 'Tap to show QR code',
    copyLink: 'Copy link',
    share: 'Share',
    shareText: 'Join どーなつ room {room}',
    historyLoading: 'Loading earlier messages…',
    serviceName: 'どーなつ',
    scrollStart: 'Get started',
    heroTagline: 'Connect Japan & Korea, one chat at a time.',
    heroDesc: 'A casual real-time interpretation service — just speak and translations appear. Share a 6-digit room code to start chatting in Japanese and Korean.',
    heroCta: 'Join a room',
    aboutLabel: 'About',
    aboutHeading: 'What is どーなつ?',
    aboutText: '<strong>どーなつ</strong> (Donut) is a soft, friendly interpreter for Japanese ↔ Korean conversation. Travel companions, online friends, language exchange — your words become the other language instantly. No install, just your browser.',
    featuresLabel: 'Features',
    featuresHeading: 'What you can do',
    featuresLead: 'Everything you need for casual bilingual chat, kept simple.',
    feat1Title: 'Speak to translate', feat1Desc: 'Hit record and talk — translations stream in real time.',
    feat2Title: 'Text works too', feat2Desc: 'Type a message when speaking isn\'t convenient.',
    feat3Title: 'Share rooms', feat3Desc: 'Invite friends with a 6-digit code, link, or QR.',
    feat4Title: 'Chat history', feat4Desc: 'Late joiners can scroll back through the conversation.',
    howLabel: 'How it works',
    howHeading: 'How to use',
    step1Title: 'Create a room', step1Desc: 'Tap "Create New Room" to get a 6-digit code.',
    step2Title: 'Share the code', step2Desc: 'Send a QR code or link to invite friends.',
    step3Title: 'Pick your language', step3Desc: 'Choose Japanese or Korean — we translate to the other.',
    step4Title: 'Talk & read', step4Desc: 'Record or type. Everyone sees the translation live.',
    startLabel: 'Start',
    startHeading: 'Get started',
    footerTagline: 'JP↔KR real-time interpretation',
    footerNote: 'Browser-based · No install required',
    pageTitle: 'どーなつ — JP↔KR Interpretation',
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
  dissolveBtn.textContent = t.dissolve;
  dissolveBtn.title = t.dissolveConfirm;
  roomBadgeIcon.textContent = 'QR';
  qrTitle.textContent = t.qrShare;
  qrHint.textContent = t.qrHint;
  qrShareBtn.textContent = t.share;
  qrCopyBtn.textContent = t.copyLink;
  setText('brandName', t.serviceName);
  setText('heroTitle', t.serviceName);
  setText('chatLogoName', t.serviceName);
  setText('scrollStartBtn', t.scrollStart);
  setText('heroTagline', t.heroTagline);
  setText('heroDesc', t.heroDesc);
  setText('heroCtaBtn', t.heroCta);
  setText('aboutLabel', t.aboutLabel);
  setText('aboutHeading', t.aboutHeading);
  setText('aboutText', t.aboutText, true);
  setText('featuresLabel', t.featuresLabel);
  setText('featuresHeading', t.featuresHeading);
  setText('featuresLead', t.featuresLead);
  setText('feat1Title', t.feat1Title);
  setText('feat1Desc', t.feat1Desc);
  setText('feat2Title', t.feat2Title);
  setText('feat2Desc', t.feat2Desc);
  setText('feat3Title', t.feat3Title);
  setText('feat3Desc', t.feat3Desc);
  setText('feat4Title', t.feat4Title);
  setText('feat4Desc', t.feat4Desc);
  setText('howLabel', t.howLabel);
  setText('howHeading', t.howHeading);
  setText('step1Title', t.step1Title);
  setText('step1Desc', t.step1Desc);
  setText('step2Title', t.step2Title);
  setText('step2Desc', t.step2Desc);
  setText('step3Title', t.step3Title);
  setText('step3Desc', t.step3Desc);
  setText('step4Title', t.step4Title);
  setText('step4Desc', t.step4Desc);
  setText('startLabel', t.startLabel);
  setText('startHeading', t.startHeading);
  setText('footerTagline', t.footerTagline);
  setText('footerNote', t.footerNote);
  updateRoomBadge();
  updateShareButton();
}

function updateRoomBadge() {
  if (!roomId) return;
  roomBadgeLabel.textContent = TXT[UI].roomLabel;
  roomBadgeNum.textContent = roomId;
  roomBadge.title = TXT[UI].qrTap;
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

function clearLog() {
  entries = {};
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
  var uid = 'h-' + msg.id;
  if (entries[uid]) return;
  var ml = myLang.value;
  var isMine = msg.src_lang === ml;
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
  updateRoomUrl('');
  lobbyEl.classList.remove('hidden');
  lobbyEl.scrollTop = 0;
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
  if (opts.prepend) {
    var anchor = logEl.querySelector('.entry');
    if (anchor) logEl.insertBefore(row, anchor);
    else logEl.appendChild(row);
  } else {
    logEl.appendChild(row);
    if (!opts.noScroll) logEl.scrollTop = logEl.scrollHeight;
  }

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

function getSpeechFull() {
  return speechCommitted + speechInterim;
}

function getSpeechRemainder() {
  return getSpeechFull().slice(speechSentLen);
}

function resetSpeechState() {
  speechCommitted = '';
  speechInterim = '';
  speechSentLen = 0;
  if (speechFlushTimer) {
    clearInterval(speechFlushTimer);
    speechFlushTimer = null;
  }
}

function splitAtSentenceEnds(text) {
  var complete = [];
  var lastEnd = 0;
  for (var i = 0; i < text.length; i++) {
    if (SENTENCE_END_RE.test(text[i])) {
      var sent = text.slice(lastEnd, i + 1).trim();
      if (sent) complete.push(sent);
      lastEnd = i + 1;
    }
  }
  return {
    complete: complete,
    remainder: text.slice(lastEnd),
    consumed: lastEnd,
  };
}

function updateSpeechPreview() {
  var remainder = getSpeechRemainder();
  if (!remainder.trim()) {
    clearLocalInterim();
    return;
  }
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
  localInterim.querySelector('.main').textContent = remainder;
  logEl.scrollTop = logEl.scrollHeight;
}

function clearLocalInterim() {
  if (localInterim) {
    localInterim.remove();
    localInterim = null;
  }
}

function sendSpeechSentence(text) {
  if (!text) return;
  clearLocalInterim();
  send(text, true, { fullSrc: text });
}

function flushSpeech(forceFinal) {
  var unsent = getSpeechRemainder();
  if (!unsent) {
    if (forceFinal) {
      speechCommitted = '';
      speechSentLen = 0;
    }
    return;
  }

  var split = splitAtSentenceEnds(unsent);
  for (var i = 0; i < split.complete.length; i++) {
    sendSpeechSentence(split.complete[i]);
  }

  if (split.consumed > 0) {
    speechSentLen += split.consumed;
    updateSpeechPreview();
  }

  if (forceFinal) {
    var tail = split.remainder.trim();
    if (tail) sendSpeechSentence(tail);
    speechCommitted = '';
    speechSentLen = 0;
    clearLocalInterim();
  }
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
    var interim = '';
    var hadFinal = false;
    for (var i = event.resultIndex; i < event.results.length; i++) {
      var r = event.results[i];
      if (r.isFinal) {
        speechCommitted += r[0].transcript;
        hadFinal = true;
      } else {
        interim += r[0].transcript;
      }
    }
    speechInterim = interim;
    updateSpeechPreview();
    flushSpeech(false);

    if (hadFinal) {
      flushSpeech(true);
    }
  };

  recognition.onerror = function(event) {
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    setStatus(TXT[UI].errPrefix + ': ' + event.error);
    stopRecording();
  };

  recognition.onend = function() {
    flushSpeech(false);
    if (isRecording) {
      try { recognition.start(); } catch(e) {}
    }
  };

  speechFlushTimer = setInterval(function() {
    if (isRecording) flushSpeech(false);
  }, SPEECH_FLUSH_MS);

  recognition.start();
  isRecording = true;
  recordBtn.textContent = TXT[UI].stop;
  recordBtn.className = 'btn-record recording';
  setStatus(TXT[UI].recOn);
}

function stopRecording() {
  flushSpeech(true);
  resetSpeechState();
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

function send(text, isFinal, opts) {
  opts = opts || {};
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!text) return;

  var uid = opts.uid || (clientId + '-' + (++uttId));
  var isContinuation = !!opts.continuation;
  var fullSrc = opts.fullSrc || text;

  if (!isContinuation) {
    createEntry(uid, spk(), fullSrc, '', isFinal, true);
  } else if (entries[uid]) {
    entries[uid].main.textContent = fullSrc;
    if (!entries[uid].sub.textContent || entries[uid].sub.className === WAITING_CLS) {
      entries[uid].sub.textContent = TXT[UI].waiting + '…';
      entries[uid].sub.className = WAITING_CLS;
    }
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
  newRoomBtn.disabled = true;
  newRoomBtn.textContent = '...';
  fetch('/room', { method: 'POST' }).then(function(r) {
    if (!r.ok) throw new Error(TXT[UI].roomCreateFailed);
    return r.json();
  }).then(function(data) {
    if (!data || !data.room) throw new Error(TXT[UI].roomCreateFailed);
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

if (scrollStartBtn) scrollStartBtn.addEventListener('click', scrollToStart);
if (heroCtaBtn) heroCtaBtn.addEventListener('click', scrollToStart);

dissolveBtn.addEventListener('click', function() {
  hideMenu();
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!confirm(TXT[UI].dissolveConfirm)) return;
  dissolveBtn.disabled = true;
  ws.send(JSON.stringify({ type: 'dissolve' }));
});

menuBtn.addEventListener('click', function(e) {
  e.stopPropagation();
  menuDrop.classList.toggle('hidden');
});

menuDrop.addEventListener('click', function(e) {
  e.stopPropagation();
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
  if (e.key === 'Enter' && e.ctrlKey) {
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
