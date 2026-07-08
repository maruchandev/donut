(function () {
  var loginView = document.getElementById('loginView');
  var adminView = document.getElementById('adminView');
  var loginForm = document.getElementById('loginForm');
  var loginError = document.getElementById('loginError');
  var loginHint = document.getElementById('loginHint');
  var loginBtn = document.getElementById('loginBtn');
  var adminCertInput = document.getElementById('adminCert');
  var logoutBtn = document.getElementById('logoutBtn');
  var modeOptions = document.getElementById('modeOptions');
  var settingsStatus = document.getElementById('settingsStatus');
  var passwordSection = document.getElementById('passwordSection');
  var issueBtn = document.getElementById('issueBtn');
  var issueForm = document.getElementById('issueForm');
  var issueLabel = document.getElementById('issueLabel');
  var issueConfirmBtn = document.getElementById('issueConfirmBtn');
  var issueCancelBtn = document.getElementById('issueCancelBtn');
  var issuedOnce = document.getElementById('issuedOnce');
  var issuedPassword = document.getElementById('issuedPassword');
  var copyIssuedBtn = document.getElementById('copyIssuedBtn');
  var passwordList = document.getElementById('passwordList');
  var passwordEmpty = document.getElementById('passwordEmpty');
  var registerCertBtn = document.getElementById('registerCertBtn');
  var registerCertForm = document.getElementById('registerCertForm');
  var certLabel = document.getElementById('certLabel');
  var certFile = document.getElementById('certFile');
  var registerCertConfirmBtn = document.getElementById('registerCertConfirmBtn');
  var registerCertCancelBtn = document.getElementById('registerCertCancelBtn');
  var certList = document.getElementById('certList');
  var certEmpty = document.getElementById('certEmpty');
  var adminRoomBtn = document.getElementById('adminRoomBtn');
  var adminRoomStatus = document.getElementById('adminRoomStatus');

  var settingsSaveTimer = null;

  function showStatus(el, text, isError) {
    el.textContent = text;
    el.hidden = !text;
    el.classList.toggle('error', !!isError);
  }

  function formatTs(ts) {
    if (!ts) return '—';
    return new Date(ts * 1000).toLocaleString('ja-JP');
  }

  function shortFingerprint(fp) {
    if (!fp || fp.length < 16) return fp || '—';
    return fp.slice(0, 8) + '…' + fp.slice(-8);
  }

  function errorDetail(data) {
    var detail = data && data.detail;
    if (typeof detail === 'string') return detail;
    if (detail && detail.message) return detail.message;
    return 'Request failed';
  }

  function api(path, options) {
    var opts = Object.assign({ credentials: 'same-origin' }, options || {});
    if (opts.body && typeof opts.body === 'string') {
      opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    }
    return fetch(path, opts).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) {
          var err = new Error(errorDetail(data));
          err.status = r.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  function showLogin() {
    loginView.classList.remove('hidden');
    adminView.classList.add('hidden');
  }

  function showAdmin() {
    loginView.classList.add('hidden');
    adminView.classList.remove('hidden');
  }

  function updatePasswordSectionVisibility(mode) {
    passwordSection.hidden = mode !== 'password';
  }

  function addCell(tr, text) {
    var td = document.createElement('td');
    td.textContent = text;
    tr.appendChild(td);
    return td;
  }

  function addBadgeCell(tr, enabled) {
    var td = document.createElement('td');
    var badge = document.createElement('span');
    badge.className = 'badge ' + (enabled ? 'on' : 'off');
    badge.textContent = enabled ? '有効' : '無効';
    td.appendChild(badge);
    tr.appendChild(td);
    return td;
  }

  function renderPasswords(items) {
    passwordList.innerHTML = '';
    passwordEmpty.hidden = items.length > 0;
    items.forEach(function (item) {
      var tr = document.createElement('tr');
      addCell(tr, String(item.id));
      addCell(tr, item.label || '—');
      addBadgeCell(tr, item.enabled);
      addCell(tr, formatTs(item.created_at));
      addCell(tr, formatTs(item.last_used_at));
      var actionTd = document.createElement('td');
      var toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'btn-secondary toggle-btn';
      toggleBtn.textContent = item.enabled ? '無効化' : '有効化';
      toggleBtn.addEventListener('click', function () {
        toggleBtn.disabled = true;
        api('/api/admin/passwords/' + item.id, {
          method: 'PATCH',
          body: JSON.stringify({ enabled: !item.enabled }),
        }).then(loadPasswords).catch(function (err) {
          alert(err.message || '更新に失敗しました');
        }).finally(function () {
          toggleBtn.disabled = false;
        });
      });
      actionTd.appendChild(toggleBtn);
      tr.appendChild(actionTd);
      passwordList.appendChild(tr);
    });
  }

  function renderCertificates(items) {
    certList.innerHTML = '';
    certEmpty.hidden = items.length > 0;
    items.forEach(function (item) {
      var tr = document.createElement('tr');
      addCell(tr, String(item.id));
      addCell(tr, item.label || '—');
      addCell(tr, item.subject || '—');
      var fpTd = document.createElement('td');
      var fpCode = document.createElement('code');
      fpCode.title = item.fingerprint || '';
      fpCode.textContent = shortFingerprint(item.fingerprint);
      fpTd.appendChild(fpCode);
      tr.appendChild(fpTd);
      addBadgeCell(tr, item.enabled);
      addCell(tr, formatTs(item.last_used_at));
      var actionTd = document.createElement('td');
      var toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'btn-secondary toggle-btn';
      toggleBtn.textContent = item.enabled ? '無効化' : '有効化';
      toggleBtn.addEventListener('click', function () {
        toggleBtn.disabled = true;
        api('/api/admin/certificates/' + item.id, {
          method: 'PATCH',
          body: JSON.stringify({ enabled: !item.enabled }),
        }).then(loadCertificates).catch(function (err) {
          alert(err.message || '更新に失敗しました');
        }).finally(function () {
          toggleBtn.disabled = false;
        });
      });
      actionTd.appendChild(toggleBtn);
      tr.appendChild(actionTd);
      certList.appendChild(tr);
    });
  }

  function loadSettings() {
    return api('/api/admin/settings').then(function (data) {
      var mode = data.room_create_mode || 'open';
      var input = modeOptions.querySelector('input[value="' + mode + '"]');
      if (input) input.checked = true;
      updatePasswordSectionVisibility(mode);
    });
  }

  function loadPasswords() {
    return api('/api/admin/passwords').then(function (data) {
      renderPasswords(data.passwords || []);
    });
  }

  function loadCertificates() {
    return api('/api/admin/certificates').then(function (data) {
      renderCertificates(data.certificates || []);
    });
  }

  function loadAdminData() {
    return Promise.all([loadSettings(), loadPasswords(), loadCertificates()]);
  }

  function checkSession() {
    return api('/api/admin/session').then(function (data) {
      if (!data.configured) {
        loginHint.hidden = false;
        loginBtn.disabled = true;
        showLogin();
        return;
      }
      if (data.authenticated) {
        showAdmin();
        return loadAdminData();
      }
      showLogin();
    }).catch(function () {
      showLogin();
    });
  }

  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    loginError.hidden = true;
    var file = adminCertInput.files[0];
    if (!file) {
      loginError.textContent = '証明書ファイルを選択してください';
      loginError.hidden = false;
      return;
    }
    loginBtn.disabled = true;
    var formData = new FormData();
    formData.append('certificate', file);
    fetch('/api/admin/login', {
      method: 'POST',
      credentials: 'same-origin',
      body: formData,
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) {
          var err = new Error(errorDetail(data));
          err.status = r.status;
          throw err;
        }
        return data;
      });
    }).then(function () {
      adminCertInput.value = '';
      showAdmin();
      return loadAdminData();
    }).catch(function (err) {
      var msg = err.message || 'ログインに失敗しました';
      if (err.status === 429) msg = '試行回数が多すぎます。しばらく待ってください';
      if (err.status === 503) msg = '管理機能が有効化されていません';
      if (err.status === 401) msg = 'この証明書は許可されていません';
      loginError.textContent = msg;
      loginError.hidden = false;
    }).finally(function () {
      loginBtn.disabled = false;
    });
  });

  logoutBtn.addEventListener('click', function () {
    api('/api/admin/logout', { method: 'POST', body: '{}' })
      .catch(function () {})
      .finally(function () {
        showLogin();
      });
  });

  modeOptions.addEventListener('change', function (e) {
    var input = e.target;
    if (!input || input.name !== 'roomMode') return;
    updatePasswordSectionVisibility(input.value);
    clearTimeout(settingsSaveTimer);
    settingsSaveTimer = setTimeout(function () {
      api('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({ room_create_mode: input.value }),
      }).then(function () {
        showStatus(settingsStatus, 'ポリシーを保存しました', false);
        setTimeout(function () { showStatus(settingsStatus, '', false); }, 2000);
      }).catch(function (err) {
        showStatus(settingsStatus, err.message || '保存に失敗しました', true);
      });
    }, 250);
  });

  issueBtn.addEventListener('click', function () {
    issueForm.classList.remove('hidden');
    issueLabel.focus();
  });

  issueCancelBtn.addEventListener('click', function () {
    issueForm.classList.add('hidden');
    issueLabel.value = '';
  });

  issueConfirmBtn.addEventListener('click', function () {
    issueConfirmBtn.disabled = true;
    api('/api/admin/passwords', {
      method: 'POST',
      body: JSON.stringify({ label: issueLabel.value.trim() }),
    }).then(function (data) {
      issuedPassword.textContent = data.password;
      issuedOnce.classList.remove('hidden');
      issueForm.classList.add('hidden');
      issueLabel.value = '';
      return loadPasswords();
    }).catch(function (err) {
      alert(err.message || '発行に失敗しました');
    }).finally(function () {
      issueConfirmBtn.disabled = false;
    });
  });

  copyIssuedBtn.addEventListener('click', function () {
    var text = issuedPassword.textContent;
    if (!text) return;
    navigator.clipboard.writeText(text).then(function () {
      copyIssuedBtn.textContent = 'コピー済';
      setTimeout(function () { copyIssuedBtn.textContent = 'コピー'; }, 1500);
    });
  });

  registerCertBtn.addEventListener('click', function () {
    registerCertForm.classList.remove('hidden');
    certLabel.focus();
  });

  registerCertCancelBtn.addEventListener('click', function () {
    registerCertForm.classList.add('hidden');
    certLabel.value = '';
    certFile.value = '';
  });

  registerCertConfirmBtn.addEventListener('click', function () {
    var file = certFile.files[0];
    if (!file) {
      alert('証明書ファイルを選択してください');
      return;
    }
    registerCertConfirmBtn.disabled = true;
    var formData = new FormData();
    formData.append('certificate', file);
    formData.append('label', certLabel.value.trim());
    fetch('/api/admin/certificates', {
      method: 'POST',
      credentials: 'same-origin',
      body: formData,
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw new Error(errorDetail(data));
        return data;
      });
    }).then(function () {
      registerCertForm.classList.add('hidden');
      certLabel.value = '';
      certFile.value = '';
      return loadCertificates();
    }).catch(function (err) {
      alert(err.message || '登録に失敗しました');
    }).finally(function () {
      registerCertConfirmBtn.disabled = false;
    });
  });

  adminRoomBtn.addEventListener('click', function () {
    adminRoomBtn.disabled = true;
    api('/api/admin/room', { method: 'POST', body: '{}' })
      .then(function (data) {
        showStatus(adminRoomStatus, 'ルーム ' + data.room + ' を作成しました', false);
      })
      .catch(function (err) {
        showStatus(adminRoomStatus, err.message || '作成に失敗しました', true);
      })
      .finally(function () {
        adminRoomBtn.disabled = false;
      });
  });

  checkSession();
})();