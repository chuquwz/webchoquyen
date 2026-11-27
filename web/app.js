// Quyền Anh - Ultra-fast, minimal Vanilla JS App
// Styled 100% like the Sage Green Clean Mockup Interface - Thuần Tiếng Việt
(function () {
  'use strict';

  if (window.__QUYENANH_APP_BOOTED__) return;
  window.__QUYENANH_APP_BOOTED__ = true;

  // State cục bộ của ứng dụng
  let state = {
    currentUser: localStorage.getItem('qh_user') || 'quyen',
    today: new Date().toISOString().split('T')[0],
    settings: {},
    targetKcal: 1800,
    waterTotal: 0,
    waterEntries: [],
    medTaken: false,
    medTakenCount: 0,
    medTargetCount: 3,
    medTimes: ['08:00', '12:30', '20:00'],
    medDosesTaken: [false, false, false],
    currentWeight: 97.0,
    todayWeight: null,
    todayMeals: [],
    mealsTarget: 3,
    mealDayRows: [],
    weights: [],
    activeTab: 'work'
  };

  // Utility Toast (hỗ trợ nút Hoàn tác & tạm dừng đếm ngược khi người dùng đang chạm/focus)
  window.showToast = function (msg, isErrOrOpts = false) {
    const container = document.getElementById('toast-container');
    if (!container) return null;
    const opts = (typeof isErrOrOpts === 'object' && isErrOrOpts !== null)
      ? isErrOrOpts
      : { isErr: Boolean(isErrOrOpts) };
    const isErr = Boolean(opts.isErr);
    const actionLabel = opts.actionLabel ? String(opts.actionLabel) : '';
    const stayMs = typeof opts.duration === 'number'
      ? opts.duration
      : (isErr ? 4500 : (actionLabel ? 6500 : 3400));

    const toast = document.createElement('div');
    toast.className = isErr ? 'toast toast-error' : 'toast';
    toast.setAttribute('role', isErr ? 'alert' : 'status');
    const iconSvg = isErr
      ? '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12.5"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
      : '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
    const actionHtml = actionLabel
      ? `<button type="button" class="toast-action-btn">${escapeHtml(actionLabel)}</button>`
      : '';
    toast.innerHTML = `
      <span class="toast-icon-badge" aria-hidden="true">${iconSvg}</span>
      <span class="toast-msg">${escapeHtml(String(msg == null ? '' : msg))}</span>
      ${actionHtml}
      <button type="button" class="toast-close-btn" aria-label="Đóng thông báo">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;
    container.appendChild(toast);

    let closed = false;
    let timerId = null;
    let remainingMs = stayMs;
    let startedAt = Date.now();

    function clearTimer() {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
    }

    function dismiss(reason = 'close') {
      if (closed) return;
      closed = true;
      clearTimer();
      toast.classList.add('is-leaving');
      setTimeout(() => toast.remove(), 180);
      if (typeof opts.onDismiss === 'function') {
        try { opts.onDismiss(reason); } catch (_) { }
      }
    }

    function startTimer(ms) {
      clearTimer();
      if (!(ms > 0)) return;
      startedAt = Date.now();
      remainingMs = ms;
      timerId = setTimeout(() => dismiss('timeout'), ms);
    }

    function pauseTimer() {
      if (closed || timerId === null) return;
      clearTimer();
      remainingMs = Math.max(2000, remainingMs - (Date.now() - startedAt));
    }

    function resumeTimer() {
      if (closed || timerId !== null) return;
      const hovered = typeof toast.matches === 'function' && toast.matches(':hover');
      const focused = toast.contains(document.activeElement);
      if (!hovered && !focused) {
        startTimer(Math.max(2000, remainingMs));
      }
    }

    const closeBtn = toast.querySelector('.toast-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => dismiss('close'));
    }
    const actionBtn = toast.querySelector('.toast-action-btn');
    if (actionBtn) {
      actionBtn.addEventListener('click', () => {
        if (closed) return;
        dismiss('action');
        if (typeof opts.onAction === 'function') {
          try { opts.onAction(); } catch (_) { }
        }
      });
      toast.addEventListener('pointerenter', pauseTimer);
      toast.addEventListener('pointerleave', resumeTimer);
      toast.addEventListener('focusin', pauseTimer);
      toast.addEventListener('focusout', () => setTimeout(resumeTimer, 0));
    }

    startTimer(stayMs);
    return { el: toast, dismiss };
  };

  // =========================================================================
  // GIAO DIỆN SÁNG / TỐI (Hệ thống / Theo giờ / Sáng / Tối)
  // =========================================================================
  const THEME_PREF_KEY = 'qh_theme_pref_v1';
  const THEME_DEFAULT_START = '18:30';
  const THEME_DEFAULT_END = '06:00';
  let themeWatchTimer = null;
  let themeListenersBound = false;

  function parseHMToMinutes(hm, fallbackMins) {
    const m = /^(\d{2}):(\d{2})$/.exec(String(hm || '').trim());
    if (!m) return fallbackMins;
    const h = Number(m[1]);
    const mn = Number(m[2]);
    if (h < 0 || h > 23 || mn < 0 || mn > 59) return fallbackMins;
    return h * 60 + mn;
  }

  function sanitizeHM(hm, fallback) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(hm || '').trim()) ? String(hm).trim() : fallback;
  }

  function isNowInDarkSchedule(startHM, endHM, nowDate) {
    const start = parseHMToMinutes(startHM, 18 * 60 + 30);
    const end = parseHMToMinutes(endHM, 6 * 60);
    if (start === end) return false;
    const d = (nowDate && typeof nowDate.getHours === 'function') ? nowDate : new Date();
    const cur = d.getHours() * 60 + d.getMinutes();
    return start < end ? (cur >= start && cur < end) : (cur >= start || cur < end);
  }

  function readThemePref() {
    try {
      const raw = localStorage.getItem(THEME_PREF_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const mode = ['system', 'schedule', 'light', 'dark'].includes(parsed && parsed.mode)
        ? parsed.mode
        : 'system';
      return {
        mode,
        darkStart: sanitizeHM(parsed && parsed.darkStart, THEME_DEFAULT_START),
        darkEnd: sanitizeHM(parsed && parsed.darkEnd, THEME_DEFAULT_END)
      };
    } catch (_) {
      return { mode: 'system', darkStart: THEME_DEFAULT_START, darkEnd: THEME_DEFAULT_END };
    }
  }

  function writeThemePref(pref) {
    try {
      localStorage.setItem(THEME_PREF_KEY, JSON.stringify(pref));
    } catch (_) { }
  }

  function resolveThemeFromPref(pref, nowDate) {
    if (pref.mode === 'dark') return 'dark';
    if (pref.mode === 'light') return 'light';
    if (pref.mode === 'schedule') {
      return isNowInDarkSchedule(pref.darkStart, pref.darkEnd, nowDate) ? 'dark' : 'light';
    }
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }

  function applyResolvedTheme(resolved, opts = {}) {
    const root = document.documentElement;
    const current = root.getAttribute('data-theme');
    const shouldSuppress = Boolean(opts.suppressTransitions) && current !== resolved;
    let overrideStyle = null;
    if (shouldSuppress && document.head) {
      overrideStyle = document.createElement('style');
      overrideStyle.appendChild(document.createTextNode('*,*::before,*::after{transition:none !important}'));
      document.head.appendChild(overrideStyle);
    }

    root.setAttribute('data-theme', resolved);
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', resolved === 'dark' ? '#0A110C' : '#E7F1E6');
    const metaApple = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (metaApple) metaApple.setAttribute('content', resolved === 'dark' ? 'black-translucent' : 'default');

    if (overrideStyle) {
      void root.offsetHeight;
      const cleanup = () => overrideStyle.remove();
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => window.requestAnimationFrame(cleanup));
      } else {
        setTimeout(cleanup, 32);
      }
    }
  }

  function syncThemeSettingsUI(pref, resolved) {
    document.querySelectorAll('.theme-mode-btn').forEach(btn => {
      const active = btn.getAttribute('data-theme-mode') === pref.mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    const schedRow = document.getElementById('theme-schedule-row');
    if (schedRow) schedRow.hidden = pref.mode !== 'schedule';

    const startInput = document.getElementById('theme-dark-start');
    if (startInput && startInput.value !== pref.darkStart) startInput.value = pref.darkStart;
    const endInput = document.getElementById('theme-dark-end');
    if (endInput && endInput.value !== pref.darkEnd) endInput.value = pref.darkEnd;

    const descEl = document.getElementById('theme-status-desc');
    if (descEl) {
      const stateText = resolved === 'dark' ? 'Đang dùng giao diện tối' : 'Đang dùng giao diện sáng';
      if (pref.mode === 'system') {
        descEl.textContent = `${stateText} • Tự động theo hệ thống`;
      } else if (pref.mode === 'schedule') {
        descEl.textContent = `${stateText} • Bật tối từ ${pref.darkStart} đến ${pref.darkEnd}`;
      } else if (pref.mode === 'dark') {
        descEl.textContent = 'Luôn dùng giao diện tối dịu mắt';
      } else {
        descEl.textContent = 'Luôn dùng giao diện sáng';
      }
    }
  }

  function evaluateAndApplyTheme(opts = {}) {
    const pref = readThemePref();
    const resolved = resolveThemeFromPref(pref);
    applyResolvedTheme(resolved, opts);
    syncThemeSettingsUI(pref, resolved);
  }

  window.setThemeMode = function (mode) {
    if (!['system', 'schedule', 'light', 'dark'].includes(mode)) return;
    const pref = readThemePref();
    pref.mode = mode;
    writeThemePref(pref);
    evaluateAndApplyTheme({ suppressTransitions: true });
  };

  window.onThemeScheduleChange = function () {
    const startEl = document.getElementById('theme-dark-start');
    const endEl = document.getElementById('theme-dark-end');
    const pref = readThemePref();
    pref.darkStart = sanitizeHM(startEl ? startEl.value : '', pref.darkStart);
    pref.darkEnd = sanitizeHM(endEl ? endEl.value : '', pref.darkEnd);
    writeThemePref(pref);
    evaluateAndApplyTheme({ suppressTransitions: true });
  };

  function initThemeController() {
    evaluateAndApplyTheme({ suppressTransitions: false });
    if (themeListenersBound) return;
    themeListenersBound = true;

    const mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    if (mql) {
      const onSystemThemeChange = () => {
        if (readThemePref().mode === 'system') {
          evaluateAndApplyTheme({ suppressTransitions: true });
        }
      };
      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', onSystemThemeChange);
      } else if (typeof mql.addListener === 'function') {
        mql.addListener(onSystemThemeChange);
      }
    }

    const onScheduleTick = () => {
      if (readThemePref().mode === 'schedule') {
        evaluateAndApplyTheme({ suppressTransitions: true });
      }
    };
    if (!themeWatchTimer) {
      themeWatchTimer = setInterval(onScheduleTick, 30000);
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') onScheduleTick();
    });
    window.addEventListener('focus', onScheduleTick);
  }

  // Đồng bộ đa thiết bị & Hàng đợi offline (Outbox Queue)
  const SYNC_QUEUE_KEY = 'qh_sync_queue_v1';
  const SYNC_POLL_MS = 8000;
  const syncState = {
    healthRev: 0,
    workRev: 0,
    dbId: '',
    today: '',
    authenticated: false,
    checking: false,
    flushing: false,
    pollTimer: null,
    listenersBound: false,
    lastCheckAt: 0
  };

  function genClientUID(prefix) {
    return (prefix || 'uid') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function isQueueableSyncError(err) {
    if (!err) return false;
    if (err.message === 'Chưa đăng nhập') return false;
    if (typeof err.status === 'number' && err.status >= 400 && err.status < 500) return false;
    return true;
  }

  function computeWorkJobSig(j) {
    if (!j) return '';
    const d = String(j.date || '');
    const c = String(j.customer || '').trim().toLowerCase();
    const ch = j.channel === 'FB' ? 'FB' : 'ZL';
    const s = String(j.service || '').trim().toLowerCase();
    const p = Math.max(0, Math.round(Number(j.price) || 0));
    const ts = Number(j.ts) || 0;
    if (!d || !c || !s || !p || !ts) return '';
    return `${d}|${c}|${ch}|${s}|${p}|${ts}`;
  }

  function computeWorkLedgerSig(l) {
    if (!l) return '';
    const d = String(l.date || '');
    const cat = String(l.category || '');
    const amt = Math.max(0, Math.round(Number(l.amount) || 0));
    const note = String(l.note || '').trim().toLowerCase();
    const ts = Number(l.ts) || 0;
    if (!d || !cat || !amt || !ts) return '';
    return `${d}|${cat}|${amt}|${note}|${ts}`;
  }

  function computeInstallmentSig(it) {
    if (!it) return '';
    const d = String(it.date || '');
    const amt = Math.max(0, Math.round(Number(it.amount) || 0));
    const note = String(it.note || '').trim().toLowerCase();
    const ts = Number(it.ts) || 0;
    if (!d || !amt) return '';
    return `${d}|${amt}|${note}|${ts}`;
  }

  function readSyncQueueSync() {
    try {
      const raw = localStorage.getItem(SYNC_QUEUE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function writeSyncQueueSync(queue) {
    const clean = Array.isArray(queue) ? queue : [];
    try {
      localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(clean));
    } catch (_) { }
    if (typeof idbSet === 'function') {
      idbSet('sync_queue', clean);
    }
    if (typeof renderFinanceVaultStatus === 'function') {
      renderFinanceVaultStatus();
    }
    return clean;
  }

  async function hydrateSyncQueueFromIDB() {
    if (typeof idbGet !== 'function') return readSyncQueueSync();
    const localQ = readSyncQueueSync();
    const idbQ = await idbGet('sync_queue');
    if (Array.isArray(idbQ) && idbQ.length > 0 && localQ.length === 0) {
      try {
        localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(idbQ));
      } catch (_) { }
      return idbQ;
    }
    return localQ;
  }

  function enqueueSyncOp(opItem) {
    let queue = readSyncQueueSync();
    const item = Object.assign({
      qid: genClientUID('q'),
      created_at: Date.now()
    }, opItem || {});

    if (item.op === 'med_put' && item.payload && item.payload.date) {
      queue = queue.filter(q => !(q.op === 'med_put' && q.payload && q.payload.date === item.payload.date));
    } else if (item.op === 'weight_post' && item.payload && item.payload.date) {
      queue = queue.filter(q => !(q.op === 'weight_post' && q.payload && q.payload.date === item.payload.date));
    } else if (item.op === 'meal_check' && item.payload && item.payload.date && item.payload.slot) {
      queue = queue.filter(q => !(q.op === 'meal_check' && q.payload && q.payload.date === item.payload.date && q.payload.slot === item.payload.slot));
    } else if (item.op === 'work_job_del' && item.target_uid) {
      queue = queue.filter(q => !(
        (q.op === 'work_job_add' && q.payload && q.payload.uid === item.target_uid) ||
        (q.op === 'work_job_put' && q.target_uid === item.target_uid) ||
        (q.op === 'work_job_pay' && q.job_uid === item.target_uid)
      ));
    } else if (item.op === 'work_ledger_del' && item.target_uid) {
      queue = queue.filter(q => !(
        (q.op === 'work_ledger_add' && q.payload && q.payload.uid === item.target_uid) ||
        (q.op === 'work_repay_add' && q.ledger_uid === item.target_uid)
      ));
    } else if (item.op === 'work_job_pay_del' && item.target_uid) {
      queue = queue.filter(q => !(q.op === 'work_job_pay' && q.payload && q.payload.uid === item.target_uid));
    } else if (item.op === 'work_repay_del' && item.target_uid) {
      queue = queue.filter(q => !(q.op === 'work_repay_add' && q.payload && q.payload.uid === item.target_uid));
    }

    queue.push(item);
    writeSyncQueueSync(queue);
    return item;
  }

  function removePendingWaterFromQueue(cid) {
    if (!cid) return false;
    const prev = readSyncQueueSync();
    const next = prev.filter(q => !(q.op === 'water_add' && q.payload && q.payload.cid === cid));
    if (next.length !== prev.length) {
      writeSyncQueueSync(next);
      return true;
    }
    return false;
  }

  function clearPendingSyncQueue(domainOpt) {
    if (!domainOpt) {
      writeSyncQueueSync([]);
      return;
    }
    const next = readSyncQueueSync().filter(q => q.domain !== domainOpt);
    writeSyncQueueSync(next);
  }

  async function dispatchQueuedSyncOp(qItem) {
    switch (qItem.op) {
      case 'water_add':
        return await api('/api/water', { method: 'POST', body: JSON.stringify(qItem.payload || {}), silent: true });
      case 'med_put':
        return await api('/api/med', { method: 'PUT', body: JSON.stringify(qItem.payload || {}), silent: true });
      case 'weight_post':
        return await api('/api/weight', { method: 'POST', body: JSON.stringify(qItem.payload || {}), silent: true });
      case 'meal_check':
        return await api('/api/meals/check', { method: 'POST', body: JSON.stringify(qItem.payload || {}), silent: true });
      case 'work_job_add':
        return await api('/api/work/job', { method: 'POST', body: JSON.stringify(qItem.payload || {}), silent: true });
      case 'work_job_put':
        return await api(`/api/work/job/${Number(qItem.target_id) || 0}?uid=${encodeURIComponent(qItem.target_uid || '')}`, {
          method: 'PUT',
          body: JSON.stringify(qItem.payload || {}),
          silent: true
        });
      case 'work_job_del':
        return await api(`/api/work/job/${Number(qItem.target_id) || 0}?uid=${encodeURIComponent(qItem.target_uid || '')}&sig=${encodeURIComponent(qItem.sig || '')}`, {
          method: 'DELETE',
          silent: true
        });
      case 'work_pay_customer':
        return await api('/api/work/job/pay-customer', { method: 'POST', body: JSON.stringify(qItem.payload || {}), silent: true });
      case 'work_job_pay':
        return await api(`/api/work/job/${Number(qItem.job_id) || 0}/pay?job_uid=${encodeURIComponent(qItem.job_uid || '')}`, {
          method: 'POST',
          body: JSON.stringify(qItem.payload || {}),
          silent: true
        });
      case 'work_job_pay_del':
        return await api(`/api/work/job-payment/${Number(qItem.target_id) || 0}?uid=${encodeURIComponent(qItem.target_uid || '')}&sig=${encodeURIComponent(qItem.sig || '')}`, {
          method: 'DELETE',
          silent: true
        });
      case 'work_ledger_add':
        return await api('/api/work/ledger', { method: 'POST', body: JSON.stringify(qItem.payload || {}), silent: true });
      case 'work_ledger_del':
        return await api(`/api/work/ledger/${Number(qItem.target_id) || 0}?uid=${encodeURIComponent(qItem.target_uid || '')}&sig=${encodeURIComponent(qItem.sig || '')}`, {
          method: 'DELETE',
          silent: true
        });
      case 'work_repay_add':
        return await api(`/api/work/ledger/${Number(qItem.ledger_id) || 0}/repay?ledger_uid=${encodeURIComponent(qItem.ledger_uid || '')}`, {
          method: 'POST',
          body: JSON.stringify(qItem.payload || {}),
          silent: true
        });
      case 'work_repay_del':
        return await api(`/api/work/repayment/${Number(qItem.target_id) || 0}?uid=${encodeURIComponent(qItem.target_uid || '')}&sig=${encodeURIComponent(qItem.sig || '')}`, {
          method: 'DELETE',
          silent: true
        });
      case 'work_fund_upsert':
        return await api('/api/work/vault', {
          method: 'POST',
          body: JSON.stringify({ mode: 'merge', jobs: [], ledger: qItem.payload ? [qItem.payload] : [], tombstones: [] }),
          silent: true
        });
      default:
        return { ok: true };
    }
  }

  async function flushPendingSyncQueues(opts = {}) {
    if (syncState.flushing || !syncState.authenticated) {
      return { flushedHealth: 0, flushedWork: 0, remaining: readSyncQueueSync().length };
    }
    const snapshot = readSyncQueueSync();
    if (snapshot.length === 0) {
      return { flushedHealth: 0, flushedWork: 0, remaining: 0 };
    }
    syncState.flushing = true;
    let flushedHealth = 0;
    let flushedWork = 0;
    try {
      for (const qItem of snapshot) {
        try {
          const res = await dispatchQueuedSyncOp(qItem);
          const nextQ = readSyncQueueSync().filter(x => x.qid !== qItem.qid);
          writeSyncQueueSync(nextQ);
          if (res && typeof res.health_rev === 'number') {
            syncState.healthRev = Math.max(syncState.healthRev, res.health_rev);
          }
          if (res && typeof res.work_rev === 'number') {
            syncState.workRev = Math.max(syncState.workRev, res.work_rev);
          }
          if (qItem.domain === 'health') flushedHealth++;
          else flushedWork++;
        } catch (err) {
          if (err && err.message === 'Chưa đăng nhập') break;
          if (err && typeof err.status === 'number' && err.status >= 400 && err.status < 500) {
            const nextQ = readSyncQueueSync().filter(x => x.qid !== qItem.qid);
            writeSyncQueueSync(nextQ);
            continue;
          }
          break;
        }
      }
    } finally {
      syncState.flushing = false;
    }

    const totalFlushed = flushedHealth + flushedWork;
    if (!opts.silent && totalFlushed > 0) {
      showToast(`Đã đồng bộ ${totalFlushed} thay đổi chờ lên máy chủ`);
    }
    return { flushedHealth, flushedWork, remaining: readSyncQueueSync().length };
  }

  function applyPendingHealthOpsToState() {
    const queue = readSyncQueueSync().filter(q => q && q.domain === 'health');
    if (queue.length === 0) return;
    const todayStr = state.today || '';
    for (const q of queue) {
      const p = q.payload || {};
      if (q.op === 'water_add' && (!p.date || p.date === todayStr)) {
        const ml = Number(p.ml) || 0;
        const cid = p.cid || '';
        const exists = cid && (state.waterEntries || []).some(e => e && e.cid === cid);
        if (ml > 0 && !exists) {
          state.waterTotal = (state.waterTotal || 0) + ml;
          state.waterEntries = (state.waterEntries || []).concat([{
            id: -Math.abs(Number(q.created_at) || Date.now()),
            cid,
            ml,
            ts: Number(p.ts) || Math.floor(Date.now() / 1000)
          }]);
        }
      } else if (q.op === 'med_put' && (!p.date || p.date === todayStr)) {
        const target = Math.max(1, (state.medTimes && state.medTimes.length) || state.medTargetCount || 3);
        if (Array.isArray(p.doses)) {
          state.medDosesTaken = Array.from({ length: target }, (_, i) => Boolean(p.doses[i]));
          state.medTakenCount = state.medDosesTaken.filter(Boolean).length;
          state.medTaken = state.medTakenCount >= target;
          if (typeof persistMedDosesTaken === 'function') persistMedDosesTaken();
        }
      } else if (q.op === 'weight_post' && (!p.date || p.date === todayStr)) {
        const kg = Number(p.kg);
        if (kg >= 40 && kg <= 200) {
          state.todayWeight = kg;
          state.currentWeight = kg;
        }
      } else if (q.op === 'meal_check' && (!p.date || p.date === todayStr) && p.slot) {
        const meal = (state.todayMeals || []).find(m => m && m.slot === p.slot);
        if (meal) {
          meal.status = p.status || 'done';
          meal.note = p.note || '';
        }
      }
    }
  }

  function isElementFocusedInside(containerSelector) {
    const active = document.activeElement;
    if (!active || active === document.body) return false;
    return Boolean(active.closest && active.closest(containerSelector));
  }

  async function refreshWorkVaultSnapshotSilently() {
    try {
      const srv = await api('/api/work/vault', { silent: true });
      if (srv && srv.ok) {
        saveFinanceVaultToDevice({
          db_id: srv.db_id || '',
          dirty: false,
          jobs: Array.isArray(srv.jobs) ? srv.jobs : [],
          ledger: Array.isArray(srv.ledger) ? srv.ledger : [],
          tombstones: Array.isArray(srv.tombstones) ? srv.tombstones : []
        });
        if (typeof srv.work_rev === 'number') {
          syncState.workRev = Math.max(syncState.workRev, srv.work_rev);
        }
      }
    } catch (_) { }
  }

  async function checkRemoteSyncState(opts = {}) {
    if (!syncState.authenticated || syncState.checking) return;
    if (!opts.force && (Date.now() - syncState.lastCheckAt) < 2500) return;
    syncState.checking = true;
    syncState.lastCheckAt = Date.now();
    try {
      const flushed = await flushPendingSyncQueues({ silent: Boolean(opts.silent) });
      const st = await api('/api/sync/state', { silent: true });
      if (!st || !st.ok) return;

      const dbChanged = Boolean(st.db_id && syncState.dbId && st.db_id !== syncState.dbId);
      const dayChanged = Boolean(st.today && state.today && st.today !== state.today);
      const healthChanged = dbChanged || dayChanged || Boolean(opts.forceHealth) ||
        (typeof st.health_rev === 'number' && st.health_rev > syncState.healthRev) ||
        flushed.flushedHealth > 0;
      const workChanged = dbChanged || Boolean(opts.forceWork) ||
        (typeof st.work_rev === 'number' && st.work_rev > syncState.workRev) ||
        flushed.flushedWork > 0;

      syncState.dbId = st.db_id || syncState.dbId;
      syncState.today = st.today || syncState.today;

      const localVault = typeof readFinanceVaultSync === 'function' ? readFinanceVaultSync() : null;
      const vaultDbMismatch = Boolean(localVault && localVault.db_id && st.db_id && localVault.db_id !== st.db_id);

      if (vaultDbMismatch) {
        await syncFinanceVaultOnBoot({ silent: true });
        if (state.activeTab === 'work' || state.activeTab === 'ledger' || state.activeTab === 'funds') {
          await loadWorkData(workState.date, { silent: true });
        }
      } else if (workChanged) {
        if (state.activeTab === 'work' || state.activeTab === 'ledger' || state.activeTab === 'funds') {
          await loadWorkData(workState.date, { silent: true });
        } else {
          await refreshWorkVaultSnapshotSilently();
        }
      }

      if (healthChanged) {
        const typingWeight = document.getElementById('modal-weight')?.classList.contains('open') &&
          isElementFocusedInside('#modal-weight');
        if (!typingWeight) {
          await loadToday({ silent: true });
        }
        if (state.activeTab === 'settings' && !isElementFocusedInside('#tab-settings form')) {
          loadSettingsData({ silent: true });
        }
      }
    } catch (_) {
    } finally {
      syncState.checking = false;
    }
  }

  function startSyncWatcher() {
    stopSyncWatcher();
    if (!syncState.authenticated) return;
    syncState.pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && syncState.authenticated) {
        checkRemoteSyncState({ silent: true });
      }
    }, SYNC_POLL_MS);
  }

  function stopSyncWatcher() {
    if (syncState.pollTimer) {
      clearInterval(syncState.pollTimer);
      syncState.pollTimer = null;
    }
  }

  function bindSyncLifecycleListeners() {
    if (syncState.listenersBound) return;
    syncState.listenersBound = true;
    const onWake = () => {
      if (!syncState.authenticated) return;
      if (document.visibilityState === 'hidden') return;
      checkRemoteSyncState({ silent: true, force: true });
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') onWake();
    });
    window.addEventListener('focus', onWake);
    window.addEventListener('pageshow', onWake);
    window.addEventListener('online', () => {
      if (!syncState.authenticated) return;
      checkRemoteSyncState({ silent: false, force: true });
    });
  }

  // API wrapper
  async function api(path, opts = {}) {
    const silent = Boolean(opts.silent);
    const deferQueueToast = Boolean(opts.deferQueueToast);
    const fetchOpts = Object.assign({}, opts);
    delete fetchOpts.silent;
    delete fetchOpts.deferQueueToast;
    fetchOpts.cache = fetchOpts.cache || 'no-store';
    fetchOpts.headers = Object.assign({
      'Content-Type': 'application/json'
    }, opts.headers || {});
    try {
      const resp = await fetch(path, fetchOpts);
      if (resp.status === 401) {
        syncState.authenticated = false;
        stopSyncWatcher();
        showLoginView();
        throw new Error('Chưa đăng nhập');
      }
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const err = new Error(data.error || 'Có lỗi xảy ra');
        err.status = resp.status;
        throw err;
      }
      return data;
    } catch (err) {
      if (!silent && err.message !== 'Chưa đăng nhập' && (!deferQueueToast || !isQueueableSyncError(err))) {
        showToast(err.message, true);
      }
      throw err;
    }
  }

  async function onAuthenticatedBoot() {
    syncState.authenticated = true;
    await hydrateSyncQueueFromIDB();
    if (typeof hydrateVaultFromIDB === 'function') {
      await hydrateVaultFromIDB();
      if ((state.activeTab === 'work' || state.activeTab === 'ledger' || state.activeTab === 'funds')
        && typeof computeWorkFromLocalVault === 'function') {
        computeWorkFromLocalVault(workState.date || state.today);
      }
    }
    bindSyncLifecycleListeners();
    startSyncWatcher();
    await flushPendingSyncQueues({ silent: true });
    await loadToday({ silent: true });
    await syncFinanceVaultOnBoot();
    if (state.activeTab === 'work' || state.activeTab === 'ledger' || state.activeTab === 'funds') {
      lastWorkSyncAt = Date.now();
      await loadWorkData(workState.date || state.today, { silent: true });
    }
    await checkRemoteSyncState({ silent: true, force: true });
  }

  // Khởi tạo & Kiểm tra đăng nhập
  async function init() {
    initThemeController();
    registerServiceWorker();
    setupHeroGreetingWatcher();
    renderDynamicGreeting();
    setupRouting();
    setupTabSwipeGesture();
    setupNavScrollMinimize();
    setupLiquidGlassRefraction();
    setupLiquidGlassLight();
    setupModalSheetGestures();
    setupWorkJobSwipeGestures();
    bindPendingDeleteFlushListeners();
    schedulePrewarmBankQr();
    try {
      const me = await api('/api/me');
      if (me && me.ok) {
        if (me.user) {
          state.currentUser = me.user;
          localStorage.setItem('qh_user', me.user);
        }
        showAppView();
        initMotivationSection();
        await onAuthenticatedBoot();
      } else {
        showLoginView();
      }
    } catch (e) {
      showLoginView();
    }
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js').then((reg) => {
      reg.update().catch(() => { });

      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }

      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (worker) {
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              window.location.reload();
            }
          });
        }
      });

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          reg.update().catch(() => { });
        }
      });

      setInterval(() => {
        reg.update().catch(() => { });
      }, 30000);
    }).catch(() => { });

    let isRefreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!isRefreshing) {
        isRefreshing = true;
        window.location.reload();
      }
    });

    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'FORCE_RELOAD') {
        if (!isRefreshing) {
          isRefreshing = true;
          window.location.reload();
        }
      }
      if (event.data && event.data.type === 'PUSH_RECEIVED') {
        playChimeSound();
        showToast(`${event.data.title || 'Thông báo'}: ${event.data.body || ''}`);
      }
    });
  }

  window.forceCheckUpdate = async function () {
    showToast('Đang kiểm tra và tải phiên bản mới nhất...');
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (let r of regs) {
          await r.unregister();
        }
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        for (let k of keys) {
          await caches.delete(k);
        }
      }
    } catch (e) { }
    window.location.reload();
  };

  function showLoginView() {
    document.body.classList.remove('is-logged-in');
    const loginEl = document.getElementById('login-view');
    const appEl = document.getElementById('app-view');
    const navEl = document.getElementById('app-bottom-nav');
    if (loginEl) loginEl.style.display = 'flex';
    if (appEl) appEl.style.display = 'none';
    if (navEl) navEl.style.display = 'none';
  }

  function showAppView() {
    document.body.classList.add('is-logged-in');
    const loginEl = document.getElementById('login-view');
    const appEl = document.getElementById('app-view');
    const navEl = document.getElementById('app-bottom-nav');
    if (loginEl) loginEl.style.display = 'none';
    if (appEl) appEl.style.display = 'block';
    if (navEl) navEl.style.display = 'flex';
    positionNavLens();
  }

  // Xử lý Form đăng nhập
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pin = document.getElementById('pin-input').value.trim();
      if (!pin) return;
      try {
        const res = await api('/api/login', {
          method: 'POST',
          body: JSON.stringify({ pin })
        });
        if (res.ok) {
          state.currentUser = res.user || (pin === '1401' ? 'dev' : 'quyen');
          localStorage.setItem('qh_user', state.currentUser);
          showAppView();
          initMotivationSection();
          await onAuthenticatedBoot();
          if (state.currentUser === 'dev') {
            showToast('Chào mừng Developer! Bạn đang ở chế độ Dev');
          } else {
            showToast('Chào Quyền! Chúc một ngày nhiều sức khoẻ');
          }
        }
      } catch (err) { }
    });
  }

  window.logout = async function () {
    if (!confirm('Bạn có chắc muốn đăng xuất khỏi thiết bị này?')) return;
    try {
      await api('/api/logout', { method: 'POST', silent: true });
    } catch (e) { }
    syncState.authenticated = false;
    syncState.healthRev = 0;
    syncState.workRev = 0;
    stopSyncWatcher();
    localStorage.removeItem('qh_user');
    state.currentUser = 'quyen';
    applyActiveTabUI('work');
    showLoginView();
  };

  // Quản lý Tab: hôm nay, công việc, thu chi, quỹ, cài đặt
  const MAIN_TAB_ORDER = ['today', 'work', 'ledger', 'funds', 'settings'];
  const MAIN_TAB_LABELS = {
    today: 'Hôm nay',
    work: 'Công việc',
    ledger: 'Thu chi',
    funds: 'Quỹ',
    settings: 'Cài đặt'
  };
  let lastWorkSyncAt = 0;
  let lastSettingsSyncAt = 0;
  let tabSyncTimer = null;
  let cancelSwipeSessionFn = null;

  function clearPaneSwipeStyles(pane) {
    if (!pane) return;
    pane.classList.remove('is-swipe-preview', 'is-swipe-dragging', 'is-swipe-settling');
    pane.style.transform = '';
    pane.style.removeProperty('--swipe-scroll-y');
  }

  function prefersReducedMotion() {
    return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function positionNavLens() {
    const nav = document.getElementById('app-bottom-nav');
    if (!nav) return;
    const lens = nav.querySelector('.nav-glass-lens');
    const active = nav.querySelector('.nav-pill-btn.active');
    if (!lens || !active || active.offsetWidth === 0) return;
    if (!lens.dataset.squishBound) {
      lens.dataset.squishBound = '1';
      lens.addEventListener('animationend', () => lens.classList.remove('is-squish'));
    }
    const prevX = lens.dataset.x;
    const nextX = String(active.offsetLeft);
    lens.dataset.x = nextX;
    nav.style.setProperty('--lens-x', nextX + 'px');
    nav.style.setProperty('--lens-w', active.offsetWidth + 'px');
    if (!nav.classList.contains('has-lens')) {
      nav.classList.add('has-lens');
      requestAnimationFrame(() => requestAnimationFrame(() => nav.classList.add('lens-ready')));
    } else if (nav.classList.contains('lens-ready') && prevX !== undefined && prevX !== nextX) {
      lens.classList.remove('is-squish');
      void lens.offsetWidth;
      lens.classList.add('is-squish');
    }
  }

  function setupNavScrollMinimize() {
    const nav = document.getElementById('app-bottom-nav');
    if (!nav || nav.dataset.minimizeBound) return;
    nav.dataset.minimizeBound = '1';
    const reduceMotion = prefersReducedMotion();
    let lastY = window.scrollY || 0;
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const y = window.scrollY || 0;
        if (!reduceMotion) {
          document.documentElement.style.setProperty('--lg-rim-angle', (135 + Math.sin(y / 180) * 32).toFixed(1) + 'deg');
        }
        const dy = y - lastY;
        if (Math.abs(dy) < 8) return;
        nav.classList.toggle('is-compact', dy > 0 && y > 120);
        lastY = y;
      });
    }, { passive: true });
  }

  function setupLiquidGlassRefraction() {
    const reduceTrans = window.matchMedia && window.matchMedia('(prefers-reduced-transparency: reduce)').matches;
    if (prefersReducedMotion() || reduceTrans) return;
    const ua = navigator.userAgent || '';
    const isIOS = /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isBlink = !isIOS && /Chrome|Chromium|Edg\//.test(ua) && !/Firefox/.test(ua);
    if (!isBlink) return;

    function buildRefractionMap(w, h, radius, bezel, ior) {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      const img = ctx.createImageData(w, h);
      const data = img.data;
      const hx = w / 2;
      const hy = h / 2;
      const ir = Math.min(radius, hx, hy);
      const bx = hx - ir;
      const by = hy - ir;
      const sdf = (px, py) => {
        const qx = Math.abs(px) - bx;
        const qy = Math.abs(py) - by;
        return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - ir;
      };
      const total = w * h;
      const vxArr = new Float32Array(total);
      const vyArr = new Float32Array(total);
      const activeArr = new Uint8Array(total);
      const eps = 0.5;
      let maxMag = 0;

      for (let y = 0; y < h; y++) {
        const py = y + 0.5 - hy;
        for (let x = 0; x < w; x++) {
          const px = x + 0.5 - hx;
          const idx = y * w + x;
          const dist = -sdf(px, py);
          if (dist <= 0 || dist >= bezel) continue;

          const nx = -(sdf(px + eps, py) - sdf(px - eps, py));
          const ny = -(sdf(px, py + eps) - sdf(px, py - eps));
          const len = Math.hypot(nx, ny) || 1;
          const t = Math.max(0.04, dist / bezel);
          const u = 1 - t;
          const u4 = Math.pow(u, 4);
          const oneMinusU4 = Math.max(1e-4, 1 - u4);
          const height = Math.pow(oneMinusU4, 0.25);
          const slope = Math.pow(u, 3) / Math.pow(oneMinusU4, 0.75);
          const inc = Math.atan(slope);
          const sinR = Math.sin(inc) / ior;
          const ref = Math.asin(Math.min(0.99, Math.max(-0.99, sinR)));
          const mag = Math.tan(inc - ref) * height;

          const vx = (nx / len) * mag;
          const vy = (ny / len) * mag;
          vxArr[idx] = vx;
          vyArr[idx] = vy;
          activeArr[idx] = 1;
          const a = Math.hypot(vx, vy);
          if (a > maxMag) maxMag = a;
        }
      }

      const norm = maxMag > 1e-6 ? maxMag : 1;
      for (let i = 0; i < total; i++) {
        const p = i * 4;
        if (!activeArr[i]) {
          data[p] = 128;
          data[p + 1] = 128;
          data[p + 2] = 128;
          data[p + 3] = 255;
        } else {
          data[p] = Math.max(0, Math.min(255, Math.round(128 + (vxArr[i] / norm) * 127)));
          data[p + 1] = Math.max(0, Math.min(255, Math.round(128 + (vyArr[i] / norm) * 127)));
          data[p + 2] = 128;
          data[p + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return canvas.toDataURL('image/png');
    }

    const specs = [
      ['lg-map-pill', 240, 48, 24, 18, 1.52],
      ['lg-map-orb', 64, 64, 32, 22, 1.54],
      ['lg-map-card', 240, 150, 26, 22, 1.50]
    ];
    let applied = 0;
    for (let i = 0; i < specs.length; i++) {
      const [id, w, h, r, bezel, ior] = specs[i];
      const feImg = document.getElementById(id);
      if (!feImg) continue;
      const url = buildRefractionMap(w, h, r, bezel, ior);
      if (!url) continue;
      feImg.setAttribute('href', url);
      feImg.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', url);
      applied++;
    }
    if (applied === specs.length) {
      document.documentElement.classList.add('lg-refract-ok');
    }
  }

  function setupLiquidGlassLight() {
    if (prefersReducedMotion()) return;
    const nav = document.getElementById('app-bottom-nav');
    if (!nav || nav.dataset.glareBound) return;
    nav.dataset.glareBound = '1';
    let glareRaf = 0;
    let pendingPct = 30;
    const updateGlare = (e) => {
      const rect = nav.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      const clientX = typeof e.clientX === 'number' ? e.clientX : (rect.left + rect.width * 0.3);
      pendingPct = Math.max(8, Math.min(92, ((clientX - rect.left) / rect.width) * 100));
      if (glareRaf) return;
      glareRaf = requestAnimationFrame(() => {
        glareRaf = 0;
        nav.style.setProperty('--lg-glare-x', pendingPct.toFixed(1) + '%');
      });
    };
    nav.addEventListener('pointerdown', updateGlare, { passive: true });
    nav.addEventListener('pointermove', updateGlare, { passive: true });
  }

  function updateNavPillSelection(tabId, focusNavBtn = false) {
    document.querySelectorAll('.nav-pill-btn').forEach(el => {
      el.classList.remove('active');
      el.setAttribute('aria-selected', 'false');
      el.setAttribute('tabindex', '-1');
    });
    const navBtn = document.getElementById('nav-btn-' + tabId);
    if (navBtn) {
      navBtn.classList.add('active');
      navBtn.setAttribute('aria-selected', 'true');
      navBtn.setAttribute('tabindex', '0');
      if (focusNavBtn) {
        navBtn.focus();
      }
    }
    const navEl = document.getElementById('app-bottom-nav');
    if (navEl) navEl.classList.remove('is-compact');
    positionNavLens();
  }

  function applyActiveTabUI(tabId, opts = {}) {
    state.activeTab = tabId;
    document.querySelectorAll('.tab-pane').forEach(el => {
      clearPaneSwipeStyles(el);
      el.classList.remove('active');
      el.removeAttribute('data-slide-dir');
    });

    const targetPane = document.getElementById('tab-' + tabId);
    if (targetPane) {
      clearPaneSwipeStyles(targetPane);
      if (opts.direction) targetPane.setAttribute('data-slide-dir', opts.direction);
      targetPane.classList.add('active');
    }

    updateNavPillSelection(tabId, Boolean(opts.focusNavBtn));
  }

  window.switchTab = function (tabId, opts = {}) {
    if (tabId === 'records' || tabId === 'meals') tabId = 'today';
    if (tabId === 'overview' || !document.getElementById('tab-' + tabId)) {
      tabId = 'work';
    }

    if (typeof cancelSwipeSessionFn === 'function' && !(opts && opts.fromSwipeFlush)) {
      cancelSwipeSessionFn();
    }
    if (typeof window.closeFundsFabMenu === 'function') {
      window.closeFundsFabMenu();
    }

    const prevTab = state.activeTab;
    const prevIdx = MAIN_TAB_ORDER.indexOf(prevTab);
    const nextIdx = MAIN_TAB_ORDER.indexOf(tabId);
    const isTabChanged = prevTab !== tabId;
    const viaSwipeSettled = Boolean(opts && opts.viaSwipeSettled);
    const dir = viaSwipeSettled
      ? ''
      : ((opts && opts.direction) ||
        (prevIdx !== -1 && nextIdx !== -1 && nextIdx !== prevIdx ? (nextIdx > prevIdx ? 'next' : 'prev') : ''));

    applyActiveTabUI(tabId, {
      direction: dir,
      focusNavBtn: Boolean(opts && opts.focusNavBtn)
    });

    const scrollContainer = document.querySelector('.app-content-area');
    if (isTabChanged) {
      window.scrollTo(0, 0);
      if (scrollContainer) {
        if (typeof scrollContainer.scrollTo === 'function') {
          scrollContainer.scrollTo(0, 0);
        } else {
          scrollContainer.scrollTop = 0;
        }
      }
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (scrollContainer && typeof scrollContainer.scrollTo === 'function') {
        scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }

    if (tabSyncTimer) {
      clearTimeout(tabSyncTimer);
      tabSyncTimer = null;
    }

    if (tabId === 'work' || tabId === 'ledger' || tabId === 'funds') {
      if (!workState.date && typeof computeWorkFromLocalVault === 'function') {
        computeWorkFromLocalVault(workState.date || state.today);
      } else if (tabId === 'funds' && typeof renderFundsScreen === 'function') {
        renderFundsScreen();
      }
    } else if (tabId === 'today') {
      renderDynamicGreeting();
    } else if (tabId === 'settings') {
      renderFinanceVaultStatus();
    }

    const scheduleBgSync = (fn) => {
      if (viaSwipeSettled || !isTabChanged || prefersReducedMotion()) {
        fn();
      } else {
        tabSyncTimer = setTimeout(() => {
          tabSyncTimer = null;
          if (state.activeTab === tabId) fn();
        }, 240);
      }
    };

    const now = Date.now();
    if (tabId === 'today' && syncState.authenticated) {
      scheduleBgSync(() => checkRemoteSyncState({ silent: true, force: true }));
    } else if ((tabId === 'work' || tabId === 'ledger' || tabId === 'funds') && (now - lastWorkSyncAt >= 3000 || !workState.date)) {
      scheduleBgSync(() => {
        lastWorkSyncAt = Date.now();
        loadWorkData(undefined, { silent: true });
      });
    } else if (tabId === 'settings' && (now - lastSettingsSyncAt >= 3000)) {
      scheduleBgSync(() => {
        lastSettingsSyncAt = Date.now();
        loadSettingsData({ silent: true });
      });
    }
  };

  function setupRouting() {
    const hash = window.location.hash.replace('#', '');
    if (['today', 'work', 'ledger', 'funds', 'settings'].includes(hash)) {
      switchTab(hash);
    }
  }

  function setupTabSwipeGesture() {
    const bottomNav = document.getElementById('app-bottom-nav');
    if (bottomNav && !bottomNav.dataset.keyboardBound) {
      bottomNav.dataset.keyboardBound = '1';
      bottomNav.addEventListener('keydown', (e) => {
        const key = e.key;
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
        const btn = e.target && e.target.closest ? e.target.closest('.nav-pill-btn') : null;
        if (!btn) return;
        const btnId = btn.id || '';
        const currentFromBtn = btnId.startsWith('nav-btn-') ? btnId.slice('nav-btn-'.length) : state.activeTab;
        const curIdx = MAIN_TAB_ORDER.indexOf(currentFromBtn);
        if (curIdx === -1) return;

        let targetIdx = curIdx;
        if (key === 'ArrowRight') {
          targetIdx = (curIdx + 1) % MAIN_TAB_ORDER.length;
        } else if (key === 'ArrowLeft') {
          targetIdx = (curIdx - 1 + MAIN_TAB_ORDER.length) % MAIN_TAB_ORDER.length;
        } else if (key === 'Home') {
          targetIdx = 0;
        } else if (key === 'End') {
          targetIdx = MAIN_TAB_ORDER.length - 1;
        }

        e.preventDefault();
        const targetTab = MAIN_TAB_ORDER[targetIdx];
        if (targetTab) {
          switchTab(targetTab, { focusNavBtn: true });
        }
      });
      positionNavLens();
      if (window.ResizeObserver) new ResizeObserver(positionNavLens).observe(bottomNav);
      window.addEventListener('resize', positionNavLens);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(positionNavLens);
    }

    const appView = document.getElementById('app-view');
    if (!appView || appView.dataset.swipeBound) return;
    appView.dataset.swipeBound = '1';

    // Pager kiểu Instagram:
    // - Trang bám 1:1 theo ngón tay, trang kế bên trượt vào sát cạnh.
    // - Ở tab đầu/cuối kéo có lực cản "cao su" thay vì dừng cứng.
    // - Thả tay: quyết định theo vận tốc 100ms cuối + vị trí dự phóng (quá nửa trang là sang).
    // - Về vị trí bằng lò xo vật lý mang theo vận tốc thả tay; chạm vào giữa chừng để "chụp" lại trang.
    // - Thanh điều hướng đổi tab ngay khi trang kéo qua một nửa.
    const EDGE_ZONE_PX = 36;
    const VELOCITY_WINDOW_MS = 100;
    const FLING_MIN_VELOCITY = 0.42; // px/ms
    const MIN_FLING_DISTANCE = 28; // px
    const COMMIT_DISTANCE_RATIO = 0.4;
    const MAX_RELEASE_VELOCITY = 6; // px/ms
    const PROJECTION_MS = 200;
    const SPRING_STIFFNESS = 420;
    const SPRING_DAMPING_RATIO = 1.0;
    const SPRING_MAX_MS = 450;
    const RUBBER_COEFF = 0.55;
    const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"]';
    const HORIZ_IGNORE_SELECTOR = '.motivation-thumbs-strip, .work-chips-scroll, .calendar-days-strip, .btn-fab-plus, .funds-fab-menu, .funds-fab-backdrop, [data-no-tab-swipe]';

    const scheduleFrame = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (fn) => setTimeout(fn, 16);
    const cancelFrame = typeof window.cancelAnimationFrame === 'function'
      ? window.cancelAnimationFrame.bind(window)
      : clearTimeout;
    const nowMs = () => (window.performance && typeof window.performance.now === 'function')
      ? window.performance.now()
      : Date.now();

    let gesture = null;
    let dragRaf = 0;
    let pendingOffset = null;
    let settle = null;
    let navHintTab = '';

    function getActivePane() {
      const pane = document.getElementById('tab-' + state.activeTab);
      if (pane && pane.classList.contains('active')) return pane;
      const domActive = document.querySelector('.tab-pane.active');
      if (domActive && domActive.id && domActive.id.startsWith('tab-')) {
        const syncedId = domActive.id.slice(4);
        if (MAIN_TAB_ORDER.includes(syncedId)) {
          state.activeTab = syncedId;
          return domActive;
        }
      }
      return pane;
    }

    function getStride() {
      return Math.max(240, appView.clientWidth || window.innerWidth || 390);
    }

    // side: 1 = tab kế tiếp (vuốt sang trái), -1 = tab trước (vuốt sang phải)
    function getNeighborTab(side) {
      const curIdx = MAIN_TAB_ORDER.indexOf(state.activeTab);
      if (curIdx === -1 || !side) return '';
      return MAIN_TAB_ORDER[curIdx + side] || '';
    }

    function rubberBand(distance, dimension) {
      return (1 - 1 / ((distance * RUBBER_COEFF / dimension) + 1)) * dimension;
    }

    function inverseRubberBand(offset, dimension) {
      const ratio = Math.min(0.95, Math.abs(offset) / dimension);
      return (dimension / RUBBER_COEFF) * (1 / (1 - ratio) - 1);
    }

    function ensureWorkDataFor(tab) {
      if ((tab === 'work' || tab === 'ledger' || tab === 'funds') && !workState.date && typeof computeWorkFromLocalVault === 'function') {
        computeWorkFromLocalVault(workState.date || state.today);
      } else if (tab === 'funds' && typeof renderFundsScreen === 'function') {
        renderFundsScreen();
      }
    }

    function setNavHint(tab) {
      if (!tab || navHintTab === tab) return;
      navHintTab = tab;
      updateNavPillSelection(tab);
    }

    function clearCtx(ctx) {
      if (!ctx) return;
      clearPaneSwipeStyles(ctx.activePane);
      if (ctx.previewPane) clearPaneSwipeStyles(ctx.previewPane);
    }

    function paint(ctx) {
      if (ctx.activePane) {
        ctx.activePane.classList.add('is-swipe-dragging');
        ctx.activePane.style.transform = `translate3d(${ctx.x.toFixed(2)}px, 0, 0)`;
      }
      if (ctx.previewPane) {
        const px = ctx.x + ctx.previewSide * ctx.stride;
        ctx.previewPane.style.transform = `translate3d(${px.toFixed(2)}px, 0, 0)`;
      }
      setNavHint(ctx.previewTab && Math.abs(ctx.x) > ctx.stride / 2 ? ctx.previewTab : state.activeTab);
    }

    // Đặt 2 trang theo độ dịch thô của ngón tay (rawOffset), gồm chọn trang xem trước và lực cản ở mép.
    function renderPager(ctx, rawOffset) {
      if (!ctx || ctx.activePane !== getActivePane()) return;
      const side = rawOffset < 0 ? 1 : (rawOffset > 0 ? -1 : 0);
      const tab = getNeighborTab(side);
      const pane = tab ? document.getElementById('tab-' + tab) : null;

      if (ctx.previewPane && ctx.previewPane !== pane) {
        clearPaneSwipeStyles(ctx.previewPane);
        ctx.previewPane = null;
        ctx.previewTab = '';
        ctx.previewSide = 0;
      }

      if (pane) {
        if (!ctx.previewPane) {
          ensureWorkDataFor(tab);
          pane.style.setProperty('--swipe-scroll-y', `${ctx.scrollY}px`);
          pane.classList.add('is-swipe-preview', 'is-swipe-dragging');
          ctx.previewPane = pane;
          ctx.previewTab = tab;
          ctx.previewSide = side;
        }
        ctx.x = Math.max(-ctx.stride, Math.min(ctx.stride, rawOffset));
      } else {
        ctx.x = rawOffset === 0 ? 0 : Math.sign(rawOffset) * rubberBand(Math.abs(rawOffset), ctx.stride);
      }
      paint(ctx);
    }

    function finishSettle(ctx, commitTab) {
      navHintTab = '';
      if (commitTab) {
        switchTab(commitTab, { viaSwipeSettled: true, fromSwipeFlush: true });
      } else {
        clearCtx(ctx);
        updateNavPillSelection(state.activeTab);
      }
    }

    // Lò xo giảm chấn tới hạn (semi-implicit Euler, bước 1/240s) — không vượt quá vị trí 0 hoặc ±stride.
    function startSettle(ctx, targetX, velocityPxPerMs, commitTab) {
      if (prefersReducedMotion() || !ctx.activePane) {
        finishSettle(ctx, commitTab);
        return;
      }
      const omega = Math.sqrt(SPRING_STIFFNESS);
      const damping = 2 * SPRING_DAMPING_RATIO * omega;
      const startT = nowMs();
      const initialSign = Math.sign(ctx.x);
      const s = {
        ctx,
        targetX,
        commitTab,
        v: Math.max(-MAX_RELEASE_VELOCITY, Math.min(MAX_RELEASE_VELOCITY, velocityPxPerMs || 0)) * 1000,
        lastT: startT,
        startT,
        rafId: 0
      };
      settle = s;

      const step = () => {
        if (settle !== s) return;
        const t = nowMs();
        let dt = Math.min(0.064, Math.max(0, (t - s.lastT) / 1000));
        s.lastT = t;
        while (dt > 0) {
          const h = Math.min(dt, 1 / 240);
          const accel = -SPRING_STIFFNESS * (s.ctx.x - s.targetX) - damping * s.v;
          s.v += accel * h;
          s.ctx.x += s.v * h;
          dt -= h;
          if (s.targetX === 0 && initialSign !== 0 && Math.sign(s.ctx.x) === -initialSign) {
            s.ctx.x = 0;
            s.v = 0;
            break;
          }
          // Không cho trang vượt quá một bề rộng (tránh hở khoảng trắng khi lò xo nảy).
          if (s.ctx.previewPane && Math.abs(s.ctx.x) > s.ctx.stride) {
            s.ctx.x = Math.sign(s.ctx.x) * s.ctx.stride;
            s.v = 0;
          }
        }
        const atRest = Math.abs(s.ctx.x - s.targetX) < 1.2 && Math.abs(s.v) < 55;
        if (atRest || (t - s.startT) > SPRING_MAX_MS) {
          s.ctx.x = s.targetX;
          paint(s.ctx);
          settle = null;
          finishSettle(s.ctx, s.commitTab);
          return;
        }
        paint(s.ctx);
        s.rafId = scheduleFrame(step);
      };
      s.rafId = scheduleFrame(step);
    }

    function cancelDragFrame() {
      if (dragRaf) {
        cancelFrame(dragRaf);
        dragRaf = 0;
      }
      pendingOffset = null;
    }

    function releaseGestureToRest(g) {
      if (g && g.ctx) startSettle(g.ctx, 0, 0, '');
    }

    cancelSwipeSessionFn = function () {
      cancelDragFrame();
      if (settle) {
        cancelFrame(settle.rafId);
        clearCtx(settle.ctx);
        settle = null;
      }
      if (gesture && gesture.ctx) clearCtx(gesture.ctx);
      gesture = null;
      navHintTab = '';
    };

    function hasHorizontalScrollableAncestor(target) {
      let el = target && target.nodeType === 1 ? target : (target && target.parentElement);
      while (el && el !== appView) {
        if (el.scrollWidth > el.clientWidth + 2) {
          const overflowX = window.getComputedStyle(el).overflowX;
          if (/(auto|scroll)/.test(overflowX)) {
            return true;
          }
        }
        el = el.parentElement;
      }
      return false;
    }

    function pushSample(g, x) {
      const t = nowMs();
      g.samples.push({ x, t });
      while (g.samples.length > 2 && t - g.samples[0].t > VELOCITY_WINDOW_MS) {
        g.samples.shift();
      }
    }

    function computeVelocity(samples) {
      if (!samples || samples.length < 2) return 0;
      const last = samples[samples.length - 1];
      let first = null;
      for (let i = 0; i < samples.length; i++) {
        if (last.t - samples[i].t <= VELOCITY_WINDOW_MS) {
          first = samples[i];
          break;
        }
      }
      if (!first || first === last) return 0;
      const dt = last.t - first.t;
      return dt >= 12 ? (last.x - first.x) / dt : 0;
    }

    function isSwipeAllowed() {
      return document.body.classList.contains('is-logged-in')
        && !document.querySelector('.modal-overlay.open')
        && !document.querySelector('.funds-fab-menu.open');
    }

    appView.addEventListener('touchstart', (e) => {
      cancelDragFrame();
      if (gesture) {
        const stale = gesture;
        gesture = null;
        releaseGestureToRest(stale);
      }

      const singleTouch = Boolean(e.touches && e.touches.length === 1);
      const touch = singleTouch ? e.touches[0] : null;
      const targetEl = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement);

      // Khi trang đang trượt sang tab mới hoặc gần về đích: kết thúc dứt điểm để nhận vuốt/chạm kế tiếp mượt.
      if (settle) {
        const s = settle;
        cancelFrame(s.rafId);
        settle = null;
        const nearRest = Math.abs(s.ctx.x - s.targetX) < Math.max(24, s.ctx.stride * 0.25);
        const targetIgnored = Boolean(
          targetEl && targetEl.closest && (targetEl.closest(EDITABLE_SELECTOR) || targetEl.closest(HORIZ_IGNORE_SELECTOR))
        );
        if (!s.commitTab && !nearRest && !targetIgnored && touch && isSwipeAllowed()) {
          const ctx = s.ctx;
          const baseOffset = ctx.previewPane ? ctx.x : Math.sign(ctx.x) * inverseRubberBand(ctx.x, ctx.stride);
          gesture = {
            originX: touch.clientX,
            startY: touch.clientY,
            lastX: touch.clientX,
            scrollY: ctx.scrollY || ((window.scrollY || window.pageYOffset || 0) + (appView.scrollTop || 0)),
            isEdgeSwipe: false,
            axis: 'x',
            baseOffset,
            samples: [{ x: touch.clientX, t: nowMs() }],
            ctx
          };
          return;
        }
        s.ctx.x = s.targetX;
        finishSettle(s.ctx, s.commitTab);
      }

      if (!touch || !isSwipeAllowed()) return;

      const rect = typeof appView.getBoundingClientRect === 'function'
        ? appView.getBoundingClientRect()
        : { left: 0, right: window.innerWidth || 390 };
      const leftBoundary = Math.max(0, rect.left || 0);
      const rightBoundary = rect.right && rect.right > 0 ? rect.right : (window.innerWidth || 390);
      const viewportWidth = window.innerWidth || rightBoundary;
      const isEdgeSwipe = touch.clientX - leftBoundary <= EDGE_ZONE_PX || rightBoundary - touch.clientX <= EDGE_ZONE_PX ||
        touch.clientX <= EDGE_ZONE_PX || touch.clientX >= viewportWidth - EDGE_ZONE_PX;

      if (targetEl && targetEl.closest && (targetEl.closest(EDITABLE_SELECTOR) || targetEl.closest('.btn-fab-plus, .funds-fab-menu, .funds-fab-backdrop'))) return;
      if (!isEdgeSwipe) {
        if (targetEl && targetEl.closest && targetEl.closest(HORIZ_IGNORE_SELECTOR)) return;
        if (hasHorizontalScrollableAncestor(targetEl)) return;
      }

      gesture = {
        startX: touch.clientX,
        startY: touch.clientY,
        originX: touch.clientX,
        lastX: touch.clientX,
        scrollY: (window.scrollY || window.pageYOffset || 0) + (appView.scrollTop || 0),
        isEdgeSwipe,
        axis: null,
        baseOffset: 0,
        samples: [{ x: touch.clientX, t: nowMs() }],
        ctx: null
      };
    }, { passive: true });

    appView.addEventListener('touchmove', (e) => {
      if (!gesture) return;
      if (!e.touches || e.touches.length !== 1) {
        const g = gesture;
        gesture = null;
        cancelDragFrame();
        releaseGestureToRest(g);
        return;
      }

      const touch = e.touches[0];
      gesture.lastX = touch.clientX;

      if (gesture.axis === null) {
        const dx = touch.clientX - gesture.startX;
        const dy = touch.clientY - gesture.startY;
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);
        const slop = gesture.isEdgeSwipe ? 8 : 10;
        const lockRatio = gesture.isEdgeSwipe ? 1.15 : 1.35;
        if (absX < slop && absY < slop) return;

        if (absX >= absY * lockRatio) {
          const activePane = getActivePane();
          if (!activePane) {
            gesture = null;
            return;
          }
          clearPaneSwipeStyles(activePane);
          activePane.removeAttribute('data-slide-dir');
          gesture.axis = 'x';
          // Bắt đầu tính từ điểm khoá trục để trang không bị "giật" một đoạn bằng touch slop.
          gesture.originX = touch.clientX;
          gesture.samples = [{ x: touch.clientX, t: nowMs() }];
          gesture.ctx = {
            activePane,
            previewPane: null,
            previewTab: '',
            previewSide: 0,
            scrollY: gesture.scrollY,
            stride: getStride(),
            x: 0
          };
        } else if (absY >= absX * 0.85) {
          gesture = null;
          return;
        } else {
          return;
        }
      }

      if (e.cancelable && typeof e.preventDefault === 'function') {
        e.preventDefault();
      }

      pushSample(gesture, touch.clientX);
      const offset = gesture.baseOffset + (touch.clientX - gesture.originX);
      if (prefersReducedMotion()) {
        gesture.ctx.x = offset;
        return;
      }

      pendingOffset = offset;
      if (!dragRaf) {
        dragRaf = scheduleFrame(() => {
          dragRaf = 0;
          if (pendingOffset === null || !gesture || !gesture.ctx) return;
          const value = pendingOffset;
          pendingOffset = null;
          renderPager(gesture.ctx, value);
        });
      }
    }, { passive: false });

    appView.addEventListener('touchend', (e) => {
      if (!gesture) return;
      const g = gesture;
      gesture = null;
      cancelDragFrame();
      if (g.axis !== 'x' || !g.ctx) return;

      const touch = (e.changedTouches && e.changedTouches[0]) || null;
      const endX = touch ? touch.clientX : g.lastX;
      const lastSample = g.samples[g.samples.length - 1];
      if (!lastSample || (nowMs() - lastSample.t) >= 12 || Math.abs(endX - lastSample.x) >= 4) {
        pushSample(g, endX);
      }
      const ctx = g.ctx;
      const offset = g.baseOffset + (endX - g.originX);
      if (prefersReducedMotion()) {
        ctx.x = offset;
      } else {
        renderPager(ctx, offset);
      }

      const velocity = computeVelocity(g.samples);
      if (!isSwipeAllowed()) {
        startSettle(ctx, 0, velocity, '');
        return;
      }

      const dirSign = Math.sign(ctx.x);
      const absX = Math.abs(ctx.x);
      const side = dirSign < 0 ? 1 : (dirSign > 0 ? -1 : 0);
      const targetTab = getNeighborTab(side);
      let commit = false;
      if (targetTab) {
        const isFling = Math.abs(velocity) >= FLING_MIN_VELOCITY && absX >= MIN_FLING_DISTANCE;
        const flingSame = isFling && Math.sign(velocity) === dirSign;
        const flingOpposite = Math.abs(velocity) >= FLING_MIN_VELOCITY && Math.sign(velocity) === -dirSign;
        const projected = ctx.x + velocity * PROJECTION_MS;
        const pastDistance = absX >= ctx.stride * COMMIT_DISTANCE_RATIO;
        const pastHalfProjected = absX >= MIN_FLING_DISTANCE && Math.sign(projected) === dirSign && Math.abs(projected) >= ctx.stride * 0.5;
        commit = !flingOpposite && (flingSame || pastDistance || pastHalfProjected);
      }

      if (commit) {
        setNavHint(targetTab);
        startSettle(ctx, -side * ctx.stride, velocity, targetTab);
      } else {
        startSettle(ctx, 0, velocity, '');
      }
    }, { passive: true });

    appView.addEventListener('touchcancel', () => {
      const g = gesture;
      gesture = null;
      cancelDragFrame();
      releaseGestureToRest(g);
    }, { passive: true });

    function flushInterruptedSwipe() {
      cancelDragFrame();
      gesture = null;
      if (settle) {
        const s = settle;
        cancelFrame(s.rafId);
        settle = null;
        s.ctx.x = s.targetX;
        finishSettle(s.ctx, s.commitTab);
      } else {
        const activePane = getActivePane();
        if (activePane) clearPaneSwipeStyles(activePane);
      }
    }

    window.addEventListener('blur', flushInterruptedSwipe);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) flushInterruptedSwipe();
    });
  }

    // Format ngày tiếng Việt
    function formatVNDate(dStr) {
      if (!dStr) return '';
      const parts = dStr.split('-');
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }

    function formatDayMonth(dStr) {
      if (!dStr) return '';
      const parts = String(dStr).split('-');
      if (parts.length < 3) return dStr;
      return `${parts[2]}/${parts[1]}`;
    }

    function formatTimeHM(tsSec) {
      const d = tsSec ? new Date(Number(tsSec) * 1000) : new Date();
      if (Number.isNaN(d.getTime())) return '';
      return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });
    }

    function formatDayMonthTime(dStr, tsSec) {
      const dm = formatDayMonth(dStr);
      const hm = tsSec ? formatTimeHM(tsSec) : '';
      if (dm && hm) return `${dm} • ${hm}`;
      return dm ? `Ngày ${dm}` : hm;
    }

    function getMedDoseStorageKey(dateStr) {
      return 'qh_med_doses_' + (dateStr || state.today || 'today');
    }

    function pruneOldMedDoseStorage(activeDate) {
      const keepKey = getMedDoseStorageKey(activeDate || state.today);
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && k.startsWith('qh_med_doses_') && k !== keepKey) {
            localStorage.removeItem(k);
          }
        }
      } catch (_) { }
    }

    function persistMedDosesTaken() {
      try {
        if (state.today) {
          pruneOldMedDoseStorage(state.today);
          localStorage.setItem(getMedDoseStorageKey(state.today), JSON.stringify(state.medDosesTaken));
        }
      } catch (_) { }
    }

    function reconcileMedDosesTaken(target, serverCount, serverDoses) {
      pruneOldMedDoseStorage(state.today);
      const count = Math.min(target, Math.max(0, serverCount || 0));
      let doses = null;
      if (Array.isArray(serverDoses) && serverDoses.length > 0) {
        doses = Array.from({ length: target }, (_, i) => Boolean(serverDoses[i]));
        state.medDosesTaken = doses;
        persistMedDosesTaken();
        return;
      }
      if (state.today) {
        try {
          const raw = localStorage.getItem(getMedDoseStorageKey(state.today));
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              doses = Array.from({ length: target }, (_, i) => Boolean(parsed[i]));
            }
          }
        } catch (_) { }
      }
      if (!doses || doses.filter(Boolean).length !== count) {
        doses = Array.from({ length: target }, (_, i) => i < count);
        state.medDosesTaken = doses;
        persistMedDosesTaken();
      } else {
        state.medDosesTaken = doses;
      }
    }

    function syncMedScheduleFromSettings(settingsObj, apiMedObj) {
      const s = settingsObj || state.settings || {};
      // Tự động đảm bảo mặc định uống thuốc 3 lần/ngày ("08:00,12:30,20:00") cho Quyền
      if (!localStorage.getItem('qh_med_default_3x_v2')) {
        if (s.remind_med_times === '08:00,12:00' || !s.remind_med_times) {
          s.remind_med_times = '08:00,12:30,20:00';
          api('/api/settings', {
            method: 'PUT',
            body: JSON.stringify({ remind_med_times: '08:00,12:30,20:00', t_med: '08:00', t_med2: '12:30' }),
            silent: true
          }).catch(() => { });
        }
        localStorage.setItem('qh_med_default_3x_v2', '1');
        localStorage.setItem('qh_med_3x_migrated', '1');
      }

      let times = [];
      if (s.remind_med_times !== undefined) {
        times = s.remind_med_times
          ? s.remind_med_times.split(',').map(t => t.trim()).filter(Boolean)
          : [];
      } else if (apiMedObj && Array.isArray(apiMedObj.times)) {
        times = apiMedObj.times.slice();
      }
      if (times.length === 0) {
        times = ['08:00', '12:30', '20:00'];
      }
      times.sort();
      state.medTimes = times;
      // Quy tắc cốt lõi: Số lần đặt lịch nhắc = Số lần Quyền phải uống thuốc trong ngày
      state.medTargetCount = Math.max(1, times.length);
      if (typeof reminderState !== 'undefined' && reminderState) {
        reminderState.med = times.slice();
      }
      if (apiMedObj && typeof apiMedObj.taken_count === 'number') {
        state.medTakenCount = Math.max(0, apiMedObj.taken_count);
      } else if (apiMedObj && typeof apiMedObj.taken === 'boolean' && state.medTakenCount === 0) {
        state.medTakenCount = apiMedObj.taken ? state.medTargetCount : 0;
      }
      const serverDoses = apiMedObj && Array.isArray(apiMedObj.doses) ? apiMedObj.doses : null;
      reconcileMedDosesTaken(state.medTargetCount, state.medTakenCount, serverDoses);
      state.medTakenCount = state.medDosesTaken.filter(Boolean).length;
      state.medTaken = state.medTakenCount >= state.medTargetCount;
    }

    // ================= 1. HÔM NAY =================
    async function loadToday(opts = {}) {
      try {
        const data = await api('/api/today', { silent: Boolean(opts.silent) });
        if (typeof data.health_rev === 'number') {
          syncState.healthRev = Math.max(syncState.healthRev, data.health_rev);
        }
        if (data.user) {
          state.currentUser = data.user;
          localStorage.setItem('qh_user', data.user);
        }
        state.today = data.date;
        syncState.today = data.date || syncState.today;
        state.settings = data.settings || {};
        state.targetKcal = data.target_kcal || 1800;
        state.waterTotal = data.water ? data.water.total : 0;
        state.waterEntries = (data.water && data.water.entries) || [];
        syncMedScheduleFromSettings(state.settings, data.med);

        if (data.weight) {
          state.todayWeight = data.weight.today;
          state.weights = Array.isArray(data.weight.rows) ? data.weight.rows : [];
          if (data.weight.last) {
            state.currentWeight = data.weight.last.kg;
          } else if (state.settings.start_weight) {
            state.currentWeight = parseFloat(state.settings.start_weight);
          }
        } else {
          state.weights = [];
        }

        state.todayMeals = data.meals || [];
        state.mealsTarget = data.meals_target || (state.todayMeals.length > 0 ? state.todayMeals.length : 3);
        applyPendingHealthOpsToState();

        renderTodayHeader();
        renderWaterWidget();
        renderMedWidget();
        renderWeightStepper();
        renderMealsWidget();
        renderDailyHealthScore();
        initMotivationSection();
      } catch (e) { }
    }

    function updateProfileDisplay() {
      const isDev = state.currentUser === 'dev';
      const profileNameEl = document.getElementById('profile-display-name');
      const profileSubEl = document.getElementById('profile-display-sub');
      const avatarBox = document.getElementById('profile-avatar-box');
      const topAvatar = document.querySelector('.user-avatar-circle');

      if (profileNameEl) {
        if (isDev) {
          profileNameEl.innerHTML = 'Tài khoản Dev <span class="badge-dev-tag">DEVELOPER</span>';
        } else {
          profileNameEl.textContent = 'Phùng Văn Quyền';
        }
      }

      if (profileSubEl) {
        if (isDev) {
          profileSubEl.textContent = 'Chế độ thử nghiệm & phát triển hệ thống';
        } else {
          profileSubEl.innerHTML = 'Hành trình: 97.0 kg &rarr; Mục tiêu 70.0 kg';
        }
      }

      if (avatarBox) {
        avatarBox.innerHTML = `<img src="/icons/icon-192.png?v=31" alt="Phùng Văn Quyền" class="app-face-logo">`;
      }

      if (topAvatar) {
        topAvatar.innerHTML = `<img src="/icons/icon-192.png?v=31" alt="Phùng Văn Quyền" class="app-face-logo">`;
      }
    }

    const HERO_GREETING_STORAGE_KEY = 'qh_hero_greeting_v1';
    const HERO_GREETING_SLOTS = {
      early_morning: {
        id: 'early_morning',
        chipLabel: 'Sáng sớm',
        topSub: 'Chào sáng sớm,',
        iconSvg: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v3"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/></svg>',
        items: [
          {
            headline: 'Sáng nay bạn thấy trong người thế nào?',
            sub: 'Bắt đầu ngày mới với một ly nước ấm và bước lên cân nhé.'
          },
          {
            headline: 'Ngày mới tinh khôi, khởi động nhẹ nhàng nào!',
            sub: 'Từng thói quen nhỏ buổi sáng sẽ tạo nên khác biệt lớn.'
          },
          {
            headline: 'Chào bình minh! Hôm nay năng lượng thế nào?',
            sub: 'Đừng quên bữa sáng đủ chất và cữ thuốc đầu ngày nhé.'
          },
          {
            headline: 'Một buổi sáng an lành đang chờ phía trước!',
            sub: 'Hít thở sâu, uống ngụm nước mát và giữ nhịp độ thật êm.'
          },
          {
            headline: 'Thức dậy sớm thật tuyệt, sẵn sàng chưa nào?',
            sub: 'Cân sáng, uống nước và chăm sóc bản thân thật chu đáo nhé.'
          },
          {
            headline: 'Mong bạn có một khởi đầu thật nhẹ nhàng!',
            sub: 'Hôm nay cứ đi từng bước vững vàng cho mục tiêu sức khoẻ.'
          }
        ]
      },
      morning: {
        id: 'morning',
        chipLabel: 'Buổi sáng',
        topSub: 'Chào buổi sáng,',
        iconSvg: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>',
        items: [
          {
            headline: 'Buổi sáng của bạn đang trôi qua thế nào?',
            sub: 'Nhấp thêm ngụm nước lọc để giữ đầu óc luôn tỉnh táo nhé.'
          },
          {
            headline: 'Giữ nhịp tập trung thật tốt cho sáng nay nhé!',
            sub: 'Làm việc hiệu quả nhưng nhớ vươn vai thư giãn vài phút.'
          },
          {
            headline: 'Chúc bạn một buổi sáng nhiều năng lượng tích cực!',
            sub: 'Mọi đơn việc và mục tiêu hôm nay đều đang chờ bạn chinh phục.'
          },
          {
            headline: 'Nửa buổi sáng rồi, sức khoẻ hôm nay ổn chứ?',
            sub: 'Uống đều nước lọc từ sáng sẽ giúp cơ thể nhẹ nhõm cả ngày.'
          },
          {
            headline: 'Hôm nay bạn cảm thấy tinh thần ra sao?',
            sub: 'Cứ giữ sự bền bỉ mỗi ngày, kết quả tốt sẽ tự tìm đến.'
          },
          {
            headline: 'Chào ngày làm việc suôn sẻ và nhiều niềm vui!',
            sub: 'Một ly nước đầy bên cạnh sẽ giúp buổi sáng thêm sảng khoái.'
          }
        ]
      },
      noon: {
        id: 'noon',
        chipLabel: 'Buổi trưa',
        topSub: 'Chào buổi trưa,',
        iconSvg: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 1v2"/><path d="M12 21v2"/><path d="M4.22 4.22l1.42 1.42"/><path d="M18.36 18.36l1.42 1.42"/><path d="M1 12h2"/><path d="M21 12h2"/><path d="M4.22 19.78l1.42-1.42"/><path d="M18.36 5.64l1.42-1.42"/></svg>',
        items: [
          {
            headline: 'Đến giờ nghỉ trưa rồi, bạn thấy thế nào?',
            sub: 'Ăn trưa đủ chất và tranh thủ chợp mắt một chút cho lại sức.'
          },
          {
            headline: 'Tạm gác công việc để nạp năng lượng trưa nhé!',
            sub: 'Nhớ kiểm tra cữ thuốc buổi trưa và uống thêm nước lọc.'
          },
          {
            headline: 'Chúc bạn một bữa trưa thật ngon miệng!',
            sub: 'Ăn chậm, chọn món thanh đạm để buổi chiều luôn nhẹ nhàng.'
          },
          {
            headline: 'Nửa ngày đã qua, cơ thể bạn thấy ổn chứ?',
            sub: 'Nghỉ ngơi đúng giờ trưa giúp chiều làm việc tỉnh táo hơn nhiều.'
          },
          {
            headline: 'Trưa nay hãy chiều chuộng bản thân bằng sự thư thái!',
            sub: 'Thả lỏng vai gáy, uống ngụm nước và ăn bữa trưa lành mạnh.'
          },
          {
            headline: 'Chào buổi trưa an nhiên, nạp lại pin nào!',
            sub: 'Đừng bỏ bữa trưa dù bận rộn, sức khoẻ luôn là ưu tiên số một.'
          }
        ]
      },
      afternoon: {
        id: 'afternoon',
        chipLabel: 'Buổi chiều',
        topSub: 'Chào buổi chiều,',
        iconSvg: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 10V2"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m16 6-4 4-4-4"/><path d="M16 18a4 4 0 0 0-8 0"/></svg>',
        items: [
          {
            headline: 'Chiều nay năng lượng của bạn thế nào?',
            sub: 'Bổ sung thêm nước lọc để vượt qua cơn uể oải đầu giờ chiều.'
          },
          {
            headline: 'Giữ vững phong độ cho chặng cuối ngày nhé!',
            sub: 'Chăm chỉ một chút nữa thôi, mọi việc sẽ sớm gọn gàng.'
          },
          {
            headline: 'Chiều nay bạn cảm thấy trong người ra sao?',
            sub: 'Nhìn lại tiến độ nước uống và bữa ăn để giữ điểm sức khoẻ cao.'
          },
          {
            headline: 'Một buổi chiều trôi chảy và thật nhiều suôn sẻ!',
            sub: 'Đứng dậy đi lại vài bước nếu đã ngồi làm việc quá lâu nhé.'
          },
          {
            headline: 'Sắp hết ngày làm việc rồi, cố thêm chút nữa!',
            sub: 'Cân bằng giữa công việc và nghỉ ngơi giúp bạn bền bỉ dài lâu.'
          },
          {
            headline: 'Chiều dịu nắng rồi, nhớ tiếp nước đầy đủ nhé!',
            sub: 'Mỗi cữ nước đúng giờ là một điểm cộng cho cơ thể khoẻ mạnh.'
          }
        ]
      },
      evening: {
        id: 'evening',
        chipLabel: 'Buổi tối',
        topSub: 'Chào buổi tối,',
        iconSvg: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
        items: [
          {
            headline: 'Một ngày đã qua, tối nay bạn thấy thế nào?',
            sub: 'Thư giãn tinh thần, ăn tối vừa đủ và nhớ cữ thuốc buổi tối nhé.'
          },
          {
            headline: 'Chúc bạn một buổi tối thật ấm áp và nhẹ lòng!',
            sub: 'Hôm nay bạn đã nỗ lực rất nhiều rồi, giờ là lúc nghỉ ngơi.'
          },
          {
            headline: 'Tối rồi, hãy dành thời gian lắng nghe cơ thể mình!',
            sub: 'Ghi lại bữa tối, rà soát sổ công việc và thả lỏng đầu óc nhé.'
          },
          {
            headline: 'Buổi tối bình yên nhé, hôm nay ổn cả chứ?',
            sub: 'Hoàn thành nốt mục tiêu nước lọc và chuẩn bị cho giấc ngủ ngon.'
          },
          {
            headline: 'Gác lại âu lo, tận hưởng buổi tối thư thái nào!',
            sub: 'Chăm sóc bản thân từ những điều nhỏ bé trước khi ngày khép lại.'
          },
          {
            headline: 'Hôm nay dù bận thế nào bạn cũng đã rất cố gắng!',
            sub: 'Ngồi nghỉ một chút, uống thuốc đủ cữ và mỉm cười thật nhẹ.'
          }
        ]
      },
      night: {
        id: 'night',
        chipLabel: 'Đêm khuya',
        topSub: 'Khuya rồi nhé,',
        iconSvg: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/><path d="M19 3v4"/><path d="M21 5h-4"/></svg>',
        items: [
          {
            headline: 'Đêm đã muộn rồi, bạn thấy buồn ngủ chưa?',
            sub: 'Sắp xếp công việc lại và lên giường sớm để cơ thể phục hồi nhé.'
          },
          {
            headline: 'Chúc bạn một đêm ngon giấc và thật bình yên!',
            sub: 'Giấc ngủ sâu giúp kiểm soát cân nặng và gan khoẻ hơn mỗi ngày.'
          },
          {
            headline: 'Thả lỏng cơ thể, sẵn sàng chìm vào giấc ngủ nào!',
            sub: 'Đặt điện thoại xuống sớm hơn một chút sẽ giúp bạn dễ ngủ hơn.'
          },
          {
            headline: 'Khuya rồi đấy, giữ sức đừng thức quá muộn nhé!',
            sub: 'Nhấp một ngụm nước nhỏ rồi nghỉ ngơi cho ngày mai thật tỉnh táo.'
          },
          {
            headline: 'Khép lại ngày hôm nay thật nhẹ nhàng nhé!',
            sub: 'Mọi chuyện còn lại cứ để sáng mai giải quyết, ngủ thật ngon nào.'
          },
          {
            headline: 'Bầu trời đã về khuya, chúc bạn ngủ thật say!',
            sub: 'Nghỉ ngơi đủ giấc là món quà tốt nhất cho sức khoẻ lúc này.'
          }
        ]
      }
    };

    const heroGreetingState = {
      slotId: null,
      index: -1,
      intervalId: null,
      switchTimerId: null,
      watcherBound: false
    };

    function getGreetingTimeSlot(dateObj) {
      const d = (dateObj instanceof Date && !isNaN(dateObj.getTime())) ? dateObj : new Date();
      const h = d.getHours();
      if (h >= 5 && h < 9) return HERO_GREETING_SLOTS.early_morning;
      if (h >= 9 && h < 11) return HERO_GREETING_SLOTS.morning;
      if (h >= 11 && h < 14) return HERO_GREETING_SLOTS.noon;
      if (h >= 14 && h < 18) return HERO_GREETING_SLOTS.afternoon;
      if (h >= 18 && h < 22) return HERO_GREETING_SLOTS.evening;
      return HERO_GREETING_SLOTS.night;
    }

    function readStoredGreetingIndices() {
      try {
        const raw = localStorage.getItem(HERO_GREETING_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === 'object') ? parsed : {};
      } catch (e) {
        return {};
      }
    }

    function writeStoredGreetingIndex(slotId, idx) {
      try {
        const map = readStoredGreetingIndices();
        map[slotId] = idx;
        localStorage.setItem(HERO_GREETING_STORAGE_KEY, JSON.stringify(map));
      } catch (e) { }
    }

    function pickGreetingIndex(slot, opts) {
      const count = slot.items.length;
      if (opts && typeof opts.index === 'number' && !isNaN(opts.index)) {
        return ((Math.floor(opts.index) % count) + count) % count;
      }
      if (opts && opts.rotate && heroGreetingState.slotId === slot.id && heroGreetingState.index >= 0) {
        return (heroGreetingState.index + 1) % count;
      }
      if (!opts?.forceFresh && heroGreetingState.slotId === slot.id && heroGreetingState.index >= 0) {
        return heroGreetingState.index % count;
      }
      const stored = readStoredGreetingIndices();
      const prevIdx = typeof stored[slot.id] === 'number' ? stored[slot.id] : -1;
      let nextIdx = Math.floor(Math.random() * count);
      if (count > 1 && nextIdx === prevIdx) {
        nextIdx = (nextIdx + 1) % count;
      }
      return nextIdx;
    }

    function applyGreetingDom(slot, item) {
      const topSubEl = document.getElementById('hero-greeting-sub');
      const chipEl = document.getElementById('hero-time-chip');
      const iconEl = document.getElementById('hero-time-icon');
      const labelEl = document.getElementById('hero-time-label');
      const titleEl = document.getElementById('hero-feeling-title');
      const subEl = document.getElementById('hero-feeling-sub');

      if (topSubEl) topSubEl.textContent = slot.topSub;
      if (chipEl) {
        chipEl.className = `hero-time-chip hero-slot-${slot.id}`;
        chipEl.setAttribute('aria-label', `${slot.chipLabel} • Bấm để đổi câu chào khác`);
      }
      if (iconEl) iconEl.innerHTML = slot.iconSvg;
      if (labelEl) labelEl.textContent = slot.chipLabel;
      if (titleEl) titleEl.textContent = item.headline;
      if (subEl) subEl.textContent = item.sub;
    }

    function renderDynamicGreeting(opts = {}) {
      const slot = getGreetingTimeSlot(opts.now);
      const nextIdx = pickGreetingIndex(slot, opts);
      heroGreetingState.slotId = slot.id;
      heroGreetingState.index = nextIdx;
      writeStoredGreetingIndex(slot.id, nextIdx);

      const item = slot.items[nextIdx] || slot.items[0];
      const blockEl = document.getElementById('hero-greeting-block');
      const reducedMotion = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (opts.animate && blockEl && !reducedMotion) {
        if (heroGreetingState.switchTimerId) {
          clearTimeout(heroGreetingState.switchTimerId);
        }
        blockEl.classList.add('is-switching');
        heroGreetingState.switchTimerId = setTimeout(() => {
          applyGreetingDom(slot, item);
          blockEl.classList.remove('is-switching');
          heroGreetingState.switchTimerId = null;
        }, 120);
      } else {
        if (blockEl) blockEl.classList.remove('is-switching');
        applyGreetingDom(slot, item);
      }

      return { slotId: slot.id, chipLabel: slot.chipLabel, topSub: slot.topSub, index: nextIdx, item };
    }

    window.cycleHeroGreeting = function () {
      return renderDynamicGreeting({ rotate: true, animate: true });
    };

    function setupHeroGreetingWatcher() {
      if (heroGreetingState.watcherBound) return;
      heroGreetingState.watcherBound = true;
      heroGreetingState.intervalId = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        const currentSlot = getGreetingTimeSlot();
        if (currentSlot.id !== heroGreetingState.slotId) {
          renderDynamicGreeting({ forceFresh: true });
        }
      }, 60000);
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) {
            const currentSlot = getGreetingTimeSlot();
            if (currentSlot.id !== heroGreetingState.slotId) {
              renderDynamicGreeting({ forceFresh: true });
            }
          }
        });
      }
    }

    function renderTodayHeader() {
      renderDynamicGreeting();
      const nameEl = document.getElementById('user-display-name');
      if (nameEl) {
        if (state.currentUser === 'dev') {
          nameEl.innerHTML = 'Dev! <span class="badge-dev-tag">DEV</span>';
        } else {
          const uName = (state.settings && state.settings.name) || 'Quyền';
          nameEl.textContent = `${uName}!`;
        }
      }
      updateProfileDisplay();
    }

    // Tính & Vẽ Vòng Tròn Điểm Sức Khoẻ Hàng Ngày (Daily Health Score Gauge)
    function renderDailyHealthScore() {
      let score = 0; // Bắt đầu từ 0 điểm cho ngày mới

      // 1. Uống nước: tối đa 40 điểm (chuẩn theo mức nước tối thiểu, mặc định 2.500ml)
      const minWater = parseInt((state.settings && state.settings.water_min) || 2500);
      const curWater = state.waterTotal || 0;
      const waterRatio = Math.min(1, curWater / minWater);
      const waterPts = Math.round(waterRatio * 40);
      score += waterPts;

      // 2. Thuốc men (bổ gan): tối đa 30 điểm (tính theo tỷ lệ số cữ đã uống / số mốc lịch nhắc)
      const medTarget = Math.max(1, state.medTargetCount || (state.medTimes && state.medTimes.length) || 3);
      const medCount = Math.min(medTarget, Math.max(0, state.medTakenCount || 0));
      const medRatio = medCount / medTarget;
      const medPts = Math.round(medRatio * 30);
      score += medPts;

      // 3. Đo cân sáng: 15 điểm
      const hasWeight = state.todayWeight !== null && state.todayWeight !== undefined;
      const weightPts = hasWeight ? 15 : 0;
      score += weightPts;

      // 4. Bữa ăn Healthy: tối đa 15 điểm (5 điểm mỗi bữa: sáng, trưa, tối)
      const meals = state.todayMeals || [];
      const mainMeals = meals.filter(m => ['breakfast', 'lunch', 'dinner'].includes(m.slot));
      let mealPts = 0;
      let doneMealsCount = 0;
      if (mainMeals.length > 0) {
        doneMealsCount = mainMeals.filter(m => m.status === 'done').length;
        mealPts = Math.min(15, doneMealsCount * 5);
      }
      score += mealPts;

      score = Math.min(100, Math.max(0, score));

      const scoreValEl = document.getElementById('daily-score-val');
      if (scoreValEl) {
        scoreValEl.textContent = `${score}/100`;
      }

      const badgeEl = document.getElementById('daily-score-badge');
      const statusRowEl = document.getElementById('score-status-row');
      const statusDotEl = document.getElementById('score-status-dot');

      if (badgeEl) {
        let badgeText = 'Mới bắt đầu';
        let tier = 'start';

        if (score >= 90) {
          badgeText = 'Xuất sắc';
          tier = 'excellent';
        } else if (score >= 70) {
          badgeText = 'Tốt';
          tier = 'good';
        } else if (score >= 40) {
          badgeText = 'Khá';
          tier = 'fair';
        } else if (score > 0) {
          badgeText = 'Đang cải thiện';
          tier = 'improving';
        }

        badgeEl.textContent = badgeText;
        if (statusRowEl) {
          statusRowEl.style.color = '';
          statusRowEl.setAttribute('data-score-tier', tier);
        }
        if (statusDotEl) {
          statusDotEl.style.backgroundColor = '';
        }
      }

      const scoreCardEl = document.getElementById('daily-score-card');
      if (scoreCardEl) {
        scoreCardEl.classList.toggle('is-score-complete', score >= 90);
      }
      const scoreWaveEl = document.getElementById('summary-score-theme-level');
      if (scoreWaveEl) {
        const scorePct = Math.round(28 + (score / 100) * 62);
        scoreWaveEl.style.setProperty('--score-level', `${scorePct}%`);
      }

      // Vẽ vòng Gauge SVG (Chu vi r=40 là 251.2)
      const ringCircle = document.getElementById('score-ring-circle');
      if (ringCircle) {
        const circum = 251.2;
        const offset = circum - (circum * (score / 100));
        ringCircle.style.strokeDashoffset = offset;
      }

      // Cập nhật các thẻ tóm tắt ở mục Hôm Nay
      const waterSummary = document.getElementById('summary-water-display');
      if (waterSummary) {
        waterSummary.textContent = (curWater / 1000).toFixed(1);
      }
      const waterWaveEl = document.getElementById('summary-water-wave-level');
      if (waterWaveEl) {
        const wavePct = Math.round(28 + waterRatio * 64); // 28% khi 0L -> 92% khi đạt 100%
        waterWaveEl.style.setProperty('--water-level', `${wavePct}%`);
      }
      const weightSummary = document.getElementById('summary-weight-display');
      if (weightSummary) {
        const curW = state.todayWeight !== null && state.todayWeight !== undefined ? state.todayWeight : state.currentWeight;
        weightSummary.textContent = curW ? curW.toFixed(1) : '--';
      }
      const weightWaveEl = document.getElementById('summary-weight-theme-level');
      if (weightWaveEl) {
        weightWaveEl.style.setProperty('--weight-level', hasWeight ? '58%' : '36%');
      }
      const medSummary = document.getElementById('summary-med-display');
      if (medSummary) {
        medSummary.style.color = '';
        if (medCount >= medTarget) {
          medSummary.textContent = `Đủ ${medTarget}/${medTarget} lần`;
          medSummary.setAttribute('data-status', 'done');
        } else if (medCount > 0) {
          medSummary.textContent = `${medCount}/${medTarget} lần`;
          medSummary.setAttribute('data-status', 'partial');
        } else {
          medSummary.textContent = `0/${medTarget} lần`;
          medSummary.setAttribute('data-status', 'empty');
        }
      }
      const medWaveEl = document.getElementById('summary-med-theme-level');
      if (medWaveEl) {
        const medPct = Math.round(30 + Math.min(1, medCount / medTarget) * 58);
        medWaveEl.style.setProperty('--med-level', `${medPct}%`);
      }
      const mealsSummary = document.getElementById('summary-meals-display');
      const mealsTarget = MEAL_SLOT_ORDER.length;
      if (mealsSummary) {
        mealsSummary.style.color = '';
        if (doneMealsCount >= mealsTarget) {
          mealsSummary.textContent = `Đủ ${mealsTarget}/${mealsTarget} bữa`;
          mealsSummary.setAttribute('data-status', 'done');
        } else if (doneMealsCount > 0) {
          mealsSummary.textContent = `${doneMealsCount}/${mealsTarget} bữa`;
          mealsSummary.setAttribute('data-status', 'partial');
        } else {
          mealsSummary.textContent = `0/${mealsTarget} bữa`;
          mealsSummary.setAttribute('data-status', 'empty');
        }
      }
      const mealsWaveEl = document.getElementById('summary-meals-theme-level');
      if (mealsWaveEl) {
        const mealsPct = Math.round(30 + Math.min(1, doneMealsCount / mealsTarget) * 58);
        mealsWaveEl.style.setProperty('--meals-level', `${mealsPct}%`);
      }
    }

    // Mở modal giải thích chi tiết điểm tuân thủ hôm nay
    window.openScoreBreakdownModal = function () {
      const minWater = parseInt((state.settings && state.settings.water_min) || 2500);
      const curWater = state.waterTotal || 0;
      const waterRatio = Math.min(1, curWater / minWater);
      const waterPts = Math.round(waterRatio * 40);

      const medTarget = Math.max(1, state.medTargetCount || (state.medTimes && state.medTimes.length) || 3);
      const medCount = Math.min(medTarget, Math.max(0, state.medTakenCount || 0));
      const medPts = Math.round((medCount / medTarget) * 30);

      const hasWeight = state.todayWeight !== null && state.todayWeight !== undefined;
      const weightPts = hasWeight ? 15 : 0;

      const meals = state.todayMeals || [];
      const mainMeals = meals.filter(m => ['breakfast', 'lunch', 'dinner'].includes(m.slot));
      const doneMeals = mainMeals.filter(m => m.status === 'done').length;
      const mealPts = Math.min(15, doneMeals * 5);

      const totalScore = Math.min(100, waterPts + medPts + weightPts + mealPts);

      const container = document.getElementById('score-breakdown-content');
      if (container) {
        container.innerHTML = `
        <div style="text-align: center; margin-bottom: 18px; padding-bottom: 14px; border-bottom: 1px solid var(--border-card);">
          <div style="font-size: 38px; font-weight: 800; color: var(--color-score-ring); line-height: 1.1;" class="font-tabular">${totalScore}<span style="font-size: 18px; color: var(--text-muted); font-weight: 600;">/100</span></div>
          <div style="font-size: 13px; font-weight: 600; color: var(--text-sub); margin-top: 4px;">Điểm tuân thủ bảo vệ sức khoẻ gan & cân nặng</div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px;">
          <div class="score-breakdown-item">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="font-weight: 700; font-size: 13.5px; color: var(--text-main); display: inline-flex; align-items: center; gap: 6px;">
                <svg class="ui-inline-svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--blue-accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>
                <span>Uống nước lọc</span>
              </span>
              <span style="font-weight: 800; color: ${waterPts > 0 ? 'var(--color-score-ring)' : 'var(--text-muted)'};" class="font-tabular">${waterPts}/40 đ</span>
            </div>
            <div style="font-size: 12.5px; color: var(--text-sub);">
              Đã uống <strong class="font-tabular">${curWater.toLocaleString('vi-VN')}</strong> / ${minWater.toLocaleString('vi-VN')} ml (${Math.min(100, Math.round(waterRatio * 100))}%)
            </div>
          </div>

          <div class="score-breakdown-item">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="font-weight: 700; font-size: 13.5px; color: var(--text-main); display: inline-flex; align-items: center; gap: 6px;">
                <svg class="ui-inline-svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--color-score-ring)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/></svg>
                <span>Thuốc bổ gan</span>
              </span>
              <span style="font-weight: 800; color: ${medPts ? 'var(--color-score-ring)' : 'var(--text-muted)'};" class="font-tabular">${medPts}/30 đ</span>
            </div>
            <div style="font-size: 12.5px;">
              ${medCount >= medTarget
            ? `<span class="text-status-ok" style="font-weight: 600;">Đã uống đủ ${medCount}/${medTarget} lần theo lịch nhắc hôm nay</span>`
            : `<span class="text-status-warn">Đã uống <strong class="font-tabular">${medCount}/${medTarget}</strong> lần (bấm ô Thuốc bổ gan để đánh dấu)</span>`}
            </div>
          </div>

          <div class="score-breakdown-item">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="font-weight: 700; font-size: 13.5px; color: var(--text-main); display: inline-flex; align-items: center; gap: 6px;">
                <svg class="ui-inline-svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--pink-accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                <span>Cân sáng sớm</span>
              </span>
              <span style="font-weight: 800; color: ${weightPts ? 'var(--color-score-ring)' : 'var(--text-muted)'};" class="font-tabular">${weightPts}/15 đ</span>
            </div>
            <div style="font-size: 12.5px;">
              ${hasWeight ? `<span class="text-status-ok" style="font-weight: 600;">Đã ghi nhận: ${state.todayWeight.toFixed(1)} kg</span>` : '<span class="text-status-warn">Chưa cân sáng nay (bấm ô Cân nặng để nhập)</span>'}
            </div>
          </div>

          <div class="score-breakdown-item">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="font-weight: 700; font-size: 13.5px; color: var(--text-main); display: inline-flex; align-items: center; gap: 6px;">
                <svg class="ui-inline-svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--color-score-ring)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                <span>Bữa ăn Healthy (3 bữa)</span>
              </span>
              <span style="font-weight: 800; color: ${mealPts ? 'var(--color-score-ring)' : 'var(--text-muted)'};" class="font-tabular">${mealPts}/15 đ</span>
            </div>
            <div style="font-size: 12.5px; color: var(--text-sub);">
              Đã ăn <strong class="font-tabular">${doneMeals}/3</strong> bữa Healthy hôm nay (5 điểm mỗi bữa)
            </div>
          </div>
        </div>

        <button class="btn-green-pill" style="width: 100%;" onclick="closeModal('modal-score-breakdown')">Đã hiểu</button>
      `;
      }
      openModal('modal-score-breakdown');
    };

    // --- UỐNG NƯỚC ---
    function renderWaterWidget() {
      const min = parseInt(state.settings.water_min || 2500);
      const max = parseInt(state.settings.water_max || 3000);
      const cur = state.waterTotal;

      const curEl = document.getElementById('water-cur');
      if (curEl) curEl.textContent = cur.toLocaleString('vi-VN');

      const minEl = document.getElementById('water-min-text');
      if (minEl) minEl.textContent = min.toLocaleString('vi-VN') + ' ml';

      const maxEl = document.getElementById('water-max-text');
      if (maxEl) maxEl.textContent = max.toLocaleString('vi-VN') + ' ml';

      const pct = Math.min(100, Math.round((cur / min) * 100));
      const pctEl = document.getElementById('water-percent-text');
      if (pctEl) pctEl.textContent = pct + '%';

      const fillEl = document.getElementById('water-fill');
      if (fillEl) fillEl.style.width = `${pct}%`;

      const badge = document.getElementById('water-badge');
      const undoBtn = document.getElementById('btn-undo-water');
      const entriesCount = document.getElementById('water-entries-count');

      if (badge) {
        if (cur >= min && cur <= max) {
          badge.textContent = 'Đạt mục tiêu';
          badge.className = 'badge-status-pill badge-normal';
        } else if (cur > max) {
          badge.textContent = 'Đã đủ 3L';
          badge.className = 'badge-status-pill badge-normal';
        } else {
          const remain = min - cur;
          badge.textContent = `Thiếu ${remain.toLocaleString('vi-VN')}ml`;
          badge.className = 'badge-status-pill badge-low';
        }
      }

      if (undoBtn) {
        undoBtn.style.display = state.waterEntries.length > 0 ? 'inline-block' : 'none';
      }
      if (entriesCount) {
        if (state.waterEntries.length > 0) {
          const last = state.waterEntries[state.waterEntries.length - 1];
          const timeStr = formatTimeHM(last.ts);
          entriesCount.textContent = `Gần nhất: +${last.ml}ml • ${formatDayMonth(state.today)} lúc ${timeStr}`;
        } else {
          entriesCount.textContent = '';
        }
      }

      renderDailyHealthScore();
    }

    window.addWater = async function (ml) {
      const cid = 'w_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
      const ts = Math.floor(Date.now() / 1000);
      const targetDate = state.today;
      state.waterTotal += ml;
      renderWaterWidget();

      try {
        const res = await api('/api/water', {
          method: 'POST',
          deferQueueToast: true,
          body: JSON.stringify({ date: targetDate, ml, cid, ts })
        });
        if (res && typeof res.health_rev === 'number') {
          syncState.healthRev = Math.max(syncState.healthRev, res.health_rev);
        }
        state.waterTotal = res.total;
        state.waterEntries = res.entries || [];
        renderWaterWidget();
        showToast(`+${ml}ml nước lọc`);
      } catch (e) {
        if (isQueueableSyncError(e)) {
          state.waterEntries = (state.waterEntries || []).concat([{
            id: -Date.now(),
            cid,
            ml,
            ts
          }]);
          enqueueSyncOp({
            domain: 'health',
            op: 'water_add',
            payload: { date: targetDate, ml, cid, ts }
          });
          renderWaterWidget();
          showToast(`+${ml}ml nước (đang chờ đồng bộ)`);
          return;
        }
        state.waterTotal -= ml;
        renderWaterWidget();
      }
    };

    window.undoLastWater = async function () {
      if (state.waterEntries.length === 0) return;
      const last = state.waterEntries[state.waterEntries.length - 1];
      if (Number(last.id) < 0 && last.cid) {
        removePendingWaterFromQueue(last.cid);
        state.waterEntries = state.waterEntries.slice(0, -1);
        state.waterTotal = Math.max(0, (state.waterTotal || 0) - (Number(last.ml) || 0));
        renderWaterWidget();
        showToast('Đã hoàn tác lần uống nước vừa rồi');
        return;
      }
      try {
        const res = await api('/api/water/' + last.id, { method: 'DELETE' });
        if (res && typeof res.health_rev === 'number') {
          syncState.healthRev = Math.max(syncState.healthRev, res.health_rev);
        }
        state.waterTotal = res.total;
        state.waterEntries = res.entries || [];
        renderWaterWidget();
        showToast('Đã hoàn tác lần uống nước vừa rồi');
      } catch (e) { }
    };

    window.openWaterModal = function () {
      renderWaterWidget();
      const inp = document.getElementById('custom-water-ml');
      if (inp) inp.value = '';
      openModal('modal-water');
    };

    window.openCustomWaterModal = window.openWaterModal;

    window.submitCustomWater = async function (e) {
      e.preventDefault();
      const inp = document.getElementById('custom-water-ml');
      const ml = parseInt(inp ? inp.value : '');
      if (!ml || ml < 1 || ml > 2000) {
        showToast('Số ml phải từ 1 đến 2.000 ml', true);
        return;
      }
      if (inp) inp.value = '';
      await addWater(ml);
    };

    // --- CHECKLIST THUỐC THEO SỐ LẦN ĐẶT LỊCH NHẮC (MẶC ĐỊNH 3 LẦN/NGÀY) ---
    window.openMedModal = function () {
      renderMedWidget();
      openModal('modal-med');
    };

    function getMedPeriodName(index, target, hm) {
      if (target === 3) {
        return ['Buổi sáng', 'Buổi trưa', 'Buổi tối'][index] || '';
      }
      const hour = parseInt(String(hm || '').split(':')[0], 10);
      if (!isNaN(hour)) {
        if (hour < 11) return 'Buổi sáng';
        if (hour < 14) return 'Buổi trưa';
        if (hour < 18) return 'Buổi chiều';
        return 'Buổi tối';
      }
      return '';
    }

    function renderMedWidget() {
      const times = (state.medTimes && state.medTimes.length > 0) ? state.medTimes : ['08:00', '12:30', '20:00'];
      const target = Math.max(1, times.length || state.medTargetCount || 3);
      state.medTargetCount = target;

      if (!Array.isArray(state.medDosesTaken) || state.medDosesTaken.length !== target) {
        reconcileMedDosesTaken(target, state.medTakenCount);
      }

      const takenCount = Math.min(target, state.medDosesTaken.filter(Boolean).length);
      state.medTakenCount = takenCount;
      state.medTaken = takenCount >= target;
      const pct = Math.min(100, Math.round((takenCount / target) * 100));

      const curEl = document.getElementById('med-cur-count');
      if (curEl) curEl.textContent = String(takenCount);

      const targetEl = document.getElementById('med-target-count');
      if (targetEl) targetEl.textContent = `${target} lần`;

      const pctEl = document.getElementById('med-percent-badge');
      if (pctEl) pctEl.textContent = `${pct}%`;

      const fillEl = document.getElementById('med-progress-fill');
      if (fillEl) fillEl.style.width = `${pct}%`;

      const schedTxt = document.getElementById('med-schedule-count-txt');
      if (schedTxt) {
        schedTxt.textContent = times.length > 0 ? `${times.length} lần/ngày` : '3 lần/ngày';
      }

      const grid = document.getElementById('med-dose-pills-grid');
      if (grid) {
        const firstUntakenIdx = state.medDosesTaken.findIndex(v => !v);
        let html = '';
        for (let i = 0; i < target; i++) {
          const doseNum = i + 1;
          const hm = times[i] || `Cữ ${doseNum}`;
          const period = getMedPeriodName(i, target, hm);
          const titleLabel = period ? `Lần ${doseNum} • ${period}` : `Lần ${doseNum}`;
          const isDone = Boolean(state.medDosesTaken[i]);
          const isNext = !isDone && i === firstUntakenIdx;
          const stateCls = isDone ? 'done' : (isNext ? 'next-dose' : '');
          const statusIcon = isDone
            ? `<svg class="ui-inline-svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>`
            : (isNext
              ? `<svg class="ui-inline-svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`
              : `<svg class="ui-inline-svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg>`);
          const statusLabel = isDone
            ? 'Đã uống'
            : (isNext ? 'Chưa uống • Bấm để đánh dấu' : 'Chưa uống');

          html += `
          <button type="button" class="btn-med-dose-pill ${stateCls} font-tabular" onclick="setMedDose(${doseNum})" aria-pressed="${isDone}">
            <div class="med-dose-top">
              <span class="med-dose-title">${escapeHtml(titleLabel)}</span>
              <span class="med-dose-time">${escapeHtml(hm)}</span>
            </div>
            <span class="med-dose-status">${statusIcon}<span>${statusLabel}</span></span>
          </button>`;
        }
        grid.innerHTML = html;
      }

      renderDailyHealthScore();
    }

    async function saveMedCountToServer(nextCount, prevDoses, customToast) {
      const prevCount = state.medTakenCount || 0;
      const backupDoses = Array.isArray(prevDoses) ? prevDoses : (state.medDosesTaken || []).slice();
      const target = Math.max(1, (state.medTimes && state.medTimes.length) || state.medTargetCount || 3);
      const dosesPayload = Array.from({ length: target }, (_, i) => Boolean(state.medDosesTaken && state.medDosesTaken[i]));
      const clamped = Math.min(target, Math.max(0, nextCount));
      state.medTakenCount = clamped;
      state.medTaken = clamped >= target;
      renderMedWidget();
      const bodyPayload = { date: state.today, taken_count: clamped, taken: clamped >= target, doses: dosesPayload };
      try {
        const res = await api('/api/med', {
          method: 'PUT',
          deferQueueToast: true,
          body: JSON.stringify(bodyPayload)
        });
        if (res && typeof res.health_rev === 'number') {
          syncState.healthRev = Math.max(syncState.healthRev, res.health_rev);
        }
        if (res && typeof res.taken_count === 'number') {
          state.medTakenCount = res.taken_count;
        }
        if (res && typeof res.target_count === 'number') {
          state.medTargetCount = res.target_count;
        }
        if (res && Array.isArray(res.doses)) {
          reconcileMedDosesTaken(state.medTargetCount, state.medTakenCount, res.doses);
        } else if (state.medDosesTaken.filter(Boolean).length !== state.medTakenCount) {
          reconcileMedDosesTaken(state.medTargetCount, state.medTakenCount);
        }
        state.medTaken = state.medTakenCount >= state.medTargetCount;
        renderMedWidget();
        if (customToast) {
          showToast(customToast);
        } else if (clamped >= target) {
          showToast(`Đã uống đủ ${clamped}/${target} cữ thuốc hôm nay!`);
        } else if (clamped > 0) {
          showToast(`Đã ghi nhận uống thuốc (${clamped}/${target} lần)`);
        } else {
          showToast('Đã đặt lại trạng thái thuốc hôm nay (0/' + target + ')');
        }
      } catch (e) {
        if (isQueueableSyncError(e)) {
          persistMedDosesTaken();
          enqueueSyncOp({
            domain: 'health',
            op: 'med_put',
            payload: bodyPayload
          });
          showToast((customToast || `Đã lưu thuốc (${clamped}/${target})`) + ' • chờ đồng bộ');
          return;
        }
        state.medTakenCount = prevCount;
        state.medDosesTaken = backupDoses;
        persistMedDosesTaken();
        state.medTaken = prevCount >= target;
        renderMedWidget();
      }
    }

    window.setMedDose = async function (doseNum) {
      const times = (state.medTimes && state.medTimes.length > 0) ? state.medTimes : ['08:00', '12:30', '20:00'];
      const target = Math.max(1, times.length || state.medTargetCount || 3);
      if (!Array.isArray(state.medDosesTaken) || state.medDosesTaken.length !== target) {
        reconcileMedDosesTaken(target, state.medTakenCount);
      }
      const idx = doseNum - 1;
      if (idx < 0 || idx >= target) return;

      const prevDoses = state.medDosesTaken.slice();
      const nextVal = !state.medDosesTaken[idx];
      state.medDosesTaken[idx] = nextVal;
      persistMedDosesTaken();

      const nextCount = state.medDosesTaken.filter(Boolean).length;
      const period = getMedPeriodName(idx, target, times[idx]);
      const doseLabel = period ? `lần ${doseNum} (${period.toLowerCase()})` : `lần ${doseNum}`;
      const msg = nextVal
        ? (nextCount >= target
          ? `Đã uống đủ ${nextCount}/${target} lần thuốc hôm nay!`
          : `Đã đánh dấu uống thuốc ${doseLabel} (${nextCount}/${target})`)
        : `Đã bỏ đánh dấu uống thuốc ${doseLabel} (${nextCount}/${target})`;

      await saveMedCountToServer(nextCount, prevDoses, msg);
    };

    window.toggleMed = async function () {
      const target = Math.max(1, (state.medTimes && state.medTimes.length) || state.medTargetCount || 3);
      if (!Array.isArray(state.medDosesTaken) || state.medDosesTaken.length !== target) {
        reconcileMedDosesTaken(target, state.medTakenCount);
      }
      const prevDoses = state.medDosesTaken.slice();
      const nextIdx = state.medDosesTaken.findIndex(v => !v);
      if (nextIdx >= 0) {
        state.medDosesTaken[nextIdx] = true;
      } else {
        state.medDosesTaken = Array.from({ length: target }, () => false);
      }
      persistMedDosesTaken();
      const nextCount = state.medDosesTaken.filter(Boolean).length;
      await saveMedCountToServer(nextCount, prevDoses);
    };

    window.jumpToMedScheduleSettings = function () {
      switchTab('settings');
      setTimeout(() => {
        const el = document.getElementById('remind-med-chips');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 120);
    };

    // --- CÂN NẶNG HÔM NAY (POPUP & STEPPER) ---
    window.openWeightModal = function () {
      renderWeightStepper();
      openModal('modal-weight');
    };

    function renderWeightStepper() {
      let dispKg = state.todayWeight !== null ? state.todayWeight : state.currentWeight;
      const valEl = document.getElementById('weight-val');
      if (valEl) valEl.textContent = dispKg.toFixed(1);

      const directInp = document.getElementById('weight-direct-input');
      if (directInp && document.activeElement !== directInp) {
        directInp.value = dispKg.toFixed(1);
      }

      const btnSave = document.getElementById('btn-save-weight');
      const sub = document.getElementById('weight-status-sub');
      if (btnSave) {
        if (state.todayWeight !== null) {
          btnSave.textContent = 'Cập nhật cân nặng (' + state.todayWeight.toFixed(1) + ' kg)';
        } else {
          btnSave.textContent = 'Lưu cân nặng';
        }
        btnSave.className = 'btn-green-pill';
      }
      if (sub) {
        if (state.todayWeight !== null) {
          sub.textContent = `Hôm nay đã ghi nhận ${state.todayWeight.toFixed(1)} kg. Điều chỉnh nếu cần sửa lại.`;
        } else {
          sub.textContent = 'Cân vào sáng sớm sau khi vệ sinh cá nhân, trước khi ăn sáng.';
        }
      }
      renderWeightModalHistory();
      renderDailyHealthScore();
    }

    function renderWeightModalHistory() {
      const listEl = document.getElementById('weight-modal-history-list');
      const countEl = document.getElementById('weight-modal-history-count');
      if (!listEl) return;

      const list = Array.isArray(state.weights)
        ? state.weights.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))
        : [];
      if (countEl) {
        countEl.textContent = `${list.length} lần đo`;
      }
      if (list.length === 0) {
        listEl.innerHTML = '<div style="font-size: 12.5px; color: var(--text-muted); padding: 6px 0;">Chưa có lịch sử cân nặng nào được lưu.</div>';
        return;
      }

      let html = '';
      for (let i = list.length - 1; i >= 0; i--) {
        const item = list[i];
        let diffHtml = '<span style="color: var(--text-muted); font-size: 12px;">Mốc đầu</span>';
        if (i > 0) {
          const prev = list[i - 1];
          const diff = Math.round((item.kg - prev.kg) * 10) / 10;
          if (diff > 0) {
            diffHtml = `<span class="text-status-danger" style="font-weight: 700; font-size: 12px;">+${diff.toFixed(1)} kg</span>`;
          } else if (diff < 0) {
            diffHtml = `<span class="text-status-ok" style="font-weight: 700; font-size: 12px;">${diff.toFixed(1)} kg</span>`;
          } else {
            diffHtml = '<span style="color: var(--text-sub); font-size: 12px;">0.0 kg</span>';
          }
        }
        const dm = formatDayMonth(item.date);
        const hm = item.ts ? formatTimeHM(item.ts) : '';
        const baseDate = item.date === state.today ? `Hôm nay (${dm})` : `Ngày ${dm}`;
        const dateLabel = hm ? `${baseDate} • ${hm}` : baseDate;
        html += `
        <div class="weight-hist-row${item.date === state.today ? ' is-today' : ''}">
          <span class="font-tabular" style="font-size: 12.5px; color: var(--text-sub); font-weight: ${item.date === state.today ? '700' : '500'};">${escapeHtml(dateLabel)}</span>
          <div style="display: flex; align-items: center; gap: 10px;">
            ${diffHtml}
            <strong style="font-size: 13.5px; color: var(--text-main);">${Number(item.kg).toFixed(1)} kg</strong>
          </div>
        </div>`;
      }
      listEl.innerHTML = html;
    }

    window.adjustWeight = function (delta) {
      const valEl = document.getElementById('weight-val');
      if (!valEl) return;
      let cur = parseFloat(valEl.textContent);
      if (isNaN(cur)) cur = state.todayWeight !== null ? state.todayWeight : state.currentWeight;
      cur = Math.round((cur + delta) * 10) / 10;
      if (cur < 40) cur = 40;
      if (cur > 200) cur = 200;
      valEl.textContent = cur.toFixed(1);
      const directInp = document.getElementById('weight-direct-input');
      if (directInp) directInp.value = cur.toFixed(1);
    };

    window.syncWeightFromInput = function (rawVal) {
      const valEl = document.getElementById('weight-val');
      if (!valEl) return;
      const parsed = parseFloat(String(rawVal || '').replace(',', '.'));
      if (!isNaN(parsed) && parsed >= 40 && parsed <= 200) {
        valEl.textContent = (Math.round(parsed * 10) / 10).toFixed(1);
      }
    };

    window.saveWeight = async function (e) {
      if (e && e.preventDefault) e.preventDefault();
      const directInp = document.getElementById('weight-direct-input');
      const valEl = document.getElementById('weight-val');
      let rawKg = directInp && directInp.value ? parseFloat(String(directInp.value).replace(',', '.')) : NaN;
      if (isNaN(rawKg) && valEl) {
        rawKg = parseFloat(valEl.textContent);
      }
      const kg = Math.round(rawKg * 10) / 10;
      if (isNaN(kg) || kg < 40 || kg > 200) {
        showToast('Cân nặng phải từ 40 đến 200 kg', true);
        return;
      }
      const payload = { kg, date: state.today };
      try {
        const res = await api('/api/weight', {
          method: 'POST',
          deferQueueToast: true,
          body: JSON.stringify(payload)
        });
        if (res && typeof res.health_rev === 'number') {
          syncState.healthRev = Math.max(syncState.healthRev, res.health_rev);
        }
        if (res && Array.isArray(res.rows)) {
          state.weights = res.rows;
        }
        state.todayWeight = kg;
        state.currentWeight = kg;
        renderWeightStepper();
        closeModal('modal-weight');
        showToast(`Đã lưu cân nặng hôm nay: ${kg.toFixed(1)} kg`);
      } catch (err) {
        if (isQueueableSyncError(err)) {
          state.todayWeight = kg;
          state.currentWeight = kg;
          enqueueSyncOp({
            domain: 'health',
            op: 'weight_post',
            payload
          });
          renderWeightStepper();
          closeModal('modal-weight');
          showToast(`Đã lưu cân nặng ${kg.toFixed(1)} kg (chờ đồng bộ)`);
        }
      }
    };

    // --- CHECKLIST 3 BỮA ĂN HEALTHY HÔM NAY (GIỐNG THUỐC BỔ GAN: ĐÃ ĂN / CHƯA ĂN) ---
    const MEAL_SLOT_ORDER = ['breakfast', 'lunch', 'dinner'];
    const MEAL_SLOT_META = {
      breakfast: { label: 'Bữa sáng Healthy', order: 1 },
      lunch: { label: 'Bữa trưa Healthy', order: 2 },
      dinner: { label: 'Bữa tối Healthy', order: 3 }
    };

    function defaultMealsForDate(date) {
      return MEAL_SLOT_ORDER.map(slot => ({
        date,
        slot,
        items: [],
        kcal: 0,
        status: 'pending',
        note: ''
      }));
    }

    function normalizeTodayHealthyMeals() {
      const bySlot = new Map();
      (state.todayMeals || []).forEach(m => {
        if (m && MEAL_SLOT_ORDER.includes(m.slot)) {
          bySlot.set(m.slot, m);
        }
      });
      return MEAL_SLOT_ORDER.map(slot => bySlot.get(slot) || {
        date: state.today,
        slot,
        items: [],
        kcal: 0,
        status: 'pending',
        note: ''
      });
    }

    window.openMealsModal = function () {
      renderMealsWidget();
      openModal('modal-meals');
    };

    function renderMealsWidget() {
      const mealsList = normalizeTodayHealthyMeals();
      state.todayMeals = mealsList;
      const target = mealsList.length;
      const doneCount = mealsList.filter(m => m.status === 'done').length;
      const pct = Math.min(100, Math.round((doneCount / target) * 100));

      const fillEl = document.getElementById('meal-progress-fill');
      if (fillEl) fillEl.style.width = `${pct}%`;

      const grid = document.getElementById('today-meal-checklist-grid');
      if (grid) {
        const firstPendingIdx = mealsList.findIndex(m => m.status !== 'done');
        grid.innerHTML = mealsList.map((m, i) => {
          const meta = MEAL_SLOT_META[m.slot] || { label: m.slot };
          const isDone = m.status === 'done';
          const isNext = !isDone && i === firstPendingIdx;
          const stateCls = isDone ? 'done' : (isNext ? 'next-dose' : '');
          const icon = isDone
            ? `<svg class="ui-inline-svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>`
            : (isNext
              ? `<svg class="ui-inline-svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`
              : `<svg class="ui-inline-svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg>`);
          const statusText = isDone
            ? 'Đã ăn'
            : (isNext ? 'Chưa ăn • Bấm để đánh dấu' : 'Chưa ăn');

          return `
          <button type="button" class="btn-med-dose-pill ${stateCls} font-tabular" onclick="toggleTodayMealQuick('${m.slot}')" aria-pressed="${isDone}">
            <div class="med-dose-top">
              <span class="med-dose-title">${escapeHtml(meta.label)}</span>
            </div>
            <span class="med-dose-status">${icon}<span>${statusText}</span></span>
          </button>`;
        }).join('');
      }
    }

    window.toggleTodayMealQuick = async function (slot) {
      if (!MEAL_SLOT_ORDER.includes(slot)) return;
      state.todayMeals = normalizeTodayHealthyMeals();
      const meal = state.todayMeals.find(m => m.slot === slot);
      if (!meal) return;

      const prevStatus = meal.status;
      const prevNote = meal.note || '';
      const nextStatus = prevStatus === 'done' ? 'pending' : 'done';
      const targetDate = state.today;
      const meta = MEAL_SLOT_META[slot] || { label: slot };
      const bodyPayload = { date: targetDate, slot, status: nextStatus, note: '' };

      meal.status = nextStatus;
      meal.note = '';
      renderMealsWidget();
      renderDailyHealthScore();

      try {
        const res = await api('/api/meals/check', {
          method: 'POST',
          deferQueueToast: true,
          body: JSON.stringify(bodyPayload)
        });
        if (res && typeof res.health_rev === 'number') {
          syncState.healthRev = Math.max(syncState.healthRev, res.health_rev);
        }
        meal.status = res.status;
        meal.note = res.note || '';
        renderMealsWidget();
        renderDailyHealthScore();

        const target = MEAL_SLOT_ORDER.length;
        const doneCount = state.todayMeals.filter(m => m.status === 'done').length;
        if (res.status === 'done') {
          showToast(doneCount >= target
            ? `Đã ăn đủ ${doneCount}/${target} bữa Healthy hôm nay!`
            : `Đã đánh dấu ${meta.label} (${doneCount}/${target} bữa)`);
        } else {
          showToast(`Đã bỏ đánh dấu ${meta.label} (${doneCount}/${target} bữa)`);
        }
      } catch (e) {
        if (isQueueableSyncError(e)) {
          enqueueSyncOp({
            domain: 'health',
            op: 'meal_check',
            payload: bodyPayload
          });
          showToast(`Đã lưu ${meta.label} (chờ đồng bộ)`);
          return;
        }
        meal.status = prevStatus;
        meal.note = prevNote;
        renderMealsWidget();
        renderDailyHealthScore();
      }
    };

    // ================= 4. CÀI ĐẶT & NHẮC NHỞ =================
    let reminderState = {
      weight: ['06:30'],
      med: ['08:00', '12:30', '20:00'],
      water: ['10:00', '14:00', '17:00', '20:00'],
      sleep: ['22:30']
    };

    async function loadSettingsData(opts = {}) {
      try {
        const data = await api('/api/settings', { silent: Boolean(opts.silent) });
        if (typeof data.health_rev === 'number') {
          syncState.healthRev = Math.max(syncState.healthRev, data.health_rev);
        }
        if (data.user) {
          state.currentUser = data.user;
          localStorage.setItem('qh_user', data.user);
        }
        const s = data.settings || {};
        state.settings = s;
        updateProfileDisplay();
        if (document.getElementById('set-name')) document.getElementById('set-name').value = state.currentUser === 'dev' ? 'Dev' : (s.name || 'Quyền');
        if (document.getElementById('set-age')) document.getElementById('set-age').value = s.age || '22';
        if (document.getElementById('set-height')) document.getElementById('set-height').value = s.height || '172';
        if (document.getElementById('set-goal')) document.getElementById('set-goal').value = s.goal_weight || '70';
        if (document.getElementById('set-water-min')) document.getElementById('set-water-min').value = s.water_min || '2500';
        if (document.getElementById('set-water-max')) document.getElementById('set-water-max').value = s.water_max || '3000';
        if (document.getElementById('set-t-weight')) document.getElementById('set-t-weight').value = s.t_weight || '06:30';
        if (document.getElementById('set-t-med')) document.getElementById('set-t-med').value = s.t_med || '08:00';
        if (document.getElementById('set-t-sleep')) document.getElementById('set-t-sleep').value = s.t_sleep || '22:30';

        if (s.remind_weight_times !== undefined) {
          reminderState.weight = s.remind_weight_times ? s.remind_weight_times.split(',').map(t => t.trim()).filter(Boolean) : [];
        } else if (s.t_weight) {
          reminderState.weight = [s.t_weight];
        }

        if (s.remind_med_times !== undefined) {
          reminderState.med = s.remind_med_times ? s.remind_med_times.split(',').map(t => t.trim()).filter(Boolean) : [];
        } else {
          reminderState.med = ['08:00', '12:30', '20:00'];
        }
        syncMedScheduleFromSettings(s);
        renderMedWidget();

        if (s.remind_water_times !== undefined) {
          reminderState.water = s.remind_water_times ? s.remind_water_times.split(',').map(t => t.trim()).filter(Boolean) : [];
        } else {
          reminderState.water = ['10:00', '14:00', '17:00', '20:00'];
        }

        if (s.remind_sleep_times !== undefined) {
          reminderState.sleep = s.remind_sleep_times ? s.remind_sleep_times.split(',').map(t => t.trim()).filter(Boolean) : [];
        } else if (s.t_sleep) {
          reminderState.sleep = [s.t_sleep];
        }

        renderReminderSection();
        updatePushBtnState();
      } catch (e) { }
    }

    function renderReminderChips(cat) {
      const container = document.getElementById('remind-' + cat + '-chips');
      const badge = document.getElementById('badge-count-' + cat);
      if (!container) return;

      const list = reminderState[cat] || [];
      if (badge) {
        if (list.length === 0) {
          badge.textContent = 'Đang tắt';
        } else if (cat === 'med') {
          badge.textContent = `${list.length} lần/ngày`;
        } else {
          badge.textContent = `${list.length} mốc`;
        }
      }

      if (list.length === 0) {
        container.innerHTML = '<span style="font-size:11px; color:var(--text-muted);">Tắt</span>';
        return;
      }

      container.innerHTML = list.map((timeStr, idx) => `
      <div class="time-chip">
        <input type="time" class="time-chip-input" value="${timeStr}" aria-label="Mốc giờ nhắc" onchange="updateReminderTime('${cat}', ${idx}, this.value)">
        <button type="button" class="btn-chip-del" aria-label="Xoá mốc ${timeStr}" onclick="removeReminderTime('${cat}', ${idx})">&times;</button>
      </div>
    `).join('');
    }

    function renderReminderSection() {
      ['weight', 'med', 'water', 'sleep'].forEach(renderReminderChips);
    }

    window.addReminderTime = function (cat, defaultVal) {
      if (!reminderState[cat]) reminderState[cat] = [];
      if (reminderState[cat].length >= 10) {
        showToast('Tối đa 10 mốc giờ', true);
        return;
      }
      let newTime = defaultVal || '08:00';
      if (reminderState[cat].length > 0) {
        const last = reminderState[cat][reminderState[cat].length - 1];
        const parts = last.split(':').map(Number);
        const nextH = (parts[0] + 2) % 24;
        newTime = `${String(nextH).padStart(2, '0')}:${String(parts[1]).padStart(2, '0')}`;
      }
      reminderState[cat].push(newTime);
      reminderState[cat].sort();
      renderReminderChips(cat);
      if (cat === 'med') {
        saveReminderSchedule(true);
      }
    };

    window.removeReminderTime = function (cat, idx) {
      if (!reminderState[cat]) return;
      reminderState[cat].splice(idx, 1);
      renderReminderChips(cat);
      if (cat === 'med') {
        saveReminderSchedule(true);
      }
    };

    window.updateReminderTime = function (cat, idx, val) {
      if (!reminderState[cat] || !val) return;
      reminderState[cat][idx] = val;
      reminderState[cat].sort();
      renderReminderChips(cat);
      if (cat === 'med') {
        saveReminderSchedule(true);
      }
    };

    window.saveReminderSchedule = async function (silent = false) {
      const payload = {
        remind_weight_times: (reminderState.weight || []).join(','),
        remind_med_times: (reminderState.med || []).join(','),
        remind_water_times: (reminderState.water || []).join(','),
        remind_sleep_times: (reminderState.sleep || []).join(','),
        t_weight: (reminderState.weight && reminderState.weight[0]) || '06:30',
        t_med: (reminderState.med && reminderState.med[0]) || '08:00',
        t_med2: (reminderState.med && reminderState.med[1]) || '',
        t_sleep: (reminderState.sleep && reminderState.sleep[0]) || '22:30'
      };

      try {
        const res = await api('/api/settings', {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        if (res && typeof res.health_rev === 'number') {
          syncState.healthRev = Math.max(syncState.healthRev, res.health_rev);
        }
        state.settings = res.settings;
        syncMedScheduleFromSettings(state.settings);
        renderMedWidget();
        if (!silent) {
          showToast(`Đã lưu lịch nhắc! Số lần uống thuốc: ${state.medTargetCount} lần/ngày.`);
        }
      } catch (e) { }
    };

    window.saveSettings = async function (e) {
      e.preventDefault();
      const payload = {
        name: document.getElementById('set-name')?.value.trim() || '',
        age: document.getElementById('set-age')?.value || '',
        height: document.getElementById('set-height')?.value || '',
        goal_weight: document.getElementById('set-goal')?.value || '',
        water_min: document.getElementById('set-water-min')?.value || '',
        water_max: document.getElementById('set-water-max')?.value || '',
        t_weight: document.getElementById('set-t-weight')?.value || (reminderState.weight && reminderState.weight[0]) || state.settings?.t_weight || '06:30',
        t_med: document.getElementById('set-t-med')?.value || (reminderState.med && reminderState.med[0]) || state.settings?.t_med || '08:00',
        t_sleep: document.getElementById('set-t-sleep')?.value || (reminderState.sleep && reminderState.sleep[0]) || state.settings?.t_sleep || '22:30',
        snack: '0',
        remind_weight_times: (reminderState.weight || []).join(','),
        remind_med_times: (reminderState.med || []).join(','),
        remind_water_times: (reminderState.water || []).join(','),
        remind_sleep_times: (reminderState.sleep || []).join(',')
      };
      try {
        const res = await api('/api/settings', {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        if (res && typeof res.health_rev === 'number') {
          syncState.healthRev = Math.max(syncState.healthRev, res.health_rev);
        }
        state.settings = res.settings;
        state.targetKcal = res.target_kcal;
        syncMedScheduleFromSettings(state.settings);
        renderMedWidget();
        renderTodayHeader();
        await loadToday();
        showToast('Đã lưu cấu hình cá nhân');
      } catch (e) { }
    };

    // --- THÔNG BÁO PUSH & CHUÔNG NHẮC NHỞ ---
    function isIOSDevice() {
      return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    function isStandalonePWA() {
      return window.navigator.standalone === true ||
        window.matchMedia('(display-mode: standalone)').matches;
    }

    window.openIOSGuideModal = function () {
      openModal('modal-ios-pwa-guide');
    };

    function playChimeSound() {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const now = ctx.currentTime;
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(587.33, now); // D5
        gain1.gain.setValueAtTime(0.3, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.6);

        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(880, now + 0.15); // A5
        gain2.gain.setValueAtTime(0.35, now + 0.15);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now + 0.15);
        osc2.stop(now + 0.9);
      } catch (e) { }
    }

    function updatePushBtnState() {
      const btn = document.getElementById('btn-enable-push');
      const tip = document.getElementById('ios-pwa-tip');
      const isIOS = isIOSDevice();
      const isStandalone = isStandalonePWA();

      if (tip) {
        if (isIOS && !isStandalone) {
          tip.style.display = 'flex';
        } else {
          tip.style.display = 'none';
        }
      }

      if (!btn) return;
      if ('Notification' in window && Notification.permission === 'granted') {
        btn.textContent = 'Đã bật thông báo';
        btn.className = 'btn-secondary-pill btn-sm';
      } else {
        btn.textContent = 'Bật thông báo';
        btn.className = 'btn-green-pill btn-sm';
      }
    }

    function arrayBufferToBase64Url(buffer) {
      if (!buffer) return '';
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function getSafeSubscriptionJson(sub) {
      const raw = sub.toJSON ? sub.toJSON() : {};
      let p256dh = raw.keys && raw.keys.p256dh;
      let auth = raw.keys && raw.keys.auth;

      if (!p256dh && sub.getKey) {
        const p256dhKey = sub.getKey('p256dh');
        if (p256dhKey) p256dh = arrayBufferToBase64Url(p256dhKey);
      }
      if (!auth && sub.getKey) {
        const authKey = sub.getKey('auth');
        if (authKey) auth = arrayBufferToBase64Url(authKey);
      }

      return {
        endpoint: sub.endpoint,
        keys: {
          p256dh: p256dh || '',
          auth: auth || ''
        }
      };
    }

    function urlBase64ToUint8Array(base64String) {
      base64String = (base64String || '').trim();
      const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
      const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
      const rawData = window.atob(base64);
      const outputArray = new Uint8Array(rawData.length);
      for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
      }
      return outputArray;
    }

    window.enablePushNotifications = async function () {
      const isIOS = isIOSDevice();
      const isStandalone = isStandalonePWA();

      // Trên iPhone: Nếu mở trong tab Safari thường, Apple chặn PushManager
      if (isIOS && !isStandalone) {
        openModal('modal-ios-pwa-guide');
        return;
      }

      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        if (isIOS) {
          openModal('modal-ios-pwa-guide');
        } else {
          showToast('Trình duyệt chưa hỗ trợ thông báo push', true);
        }
        return;
      }

      try {
        showToast('Đang kết nối dịch vụ thông báo...');
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          showToast('Chưa cấp quyền thông báo trong Cài đặt iPhone', true);
          return;
        }

        const keyData = await api('/api/push/key');
        const pubKey = (keyData.publicKey || '').trim();
        if (!pubKey) {
          throw new Error('Chưa nhận được khoá VAPID từ máy chủ');
        }

        const reg = await navigator.serviceWorker.ready;

        // Luôn huỷ đăng ký cũ để đảm bảo VAPID public key khớp 100% với máy chủ
        const existingSub = await reg.pushManager.getSubscription();
        if (existingSub) {
          try {
            await existingSub.unsubscribe();
          } catch (e) {
            console.warn('Lỗi huỷ sub cũ:', e);
          }
        }

        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(pubKey)
        });

        const payload = getSafeSubscriptionJson(sub);
        if (!payload.keys.p256dh || !payload.keys.auth) {
          throw new Error('Không trích xuất được khoá mã hoá của thiết bị');
        }

        await api('/api/push/subscribe', {
          method: 'POST',
          body: JSON.stringify(payload)
        });

        playChimeSound();
        showToast('Đã kích hoạt thông báo thành công! Bấm "Thử chuông" để nhận thông báo.');
        updatePushBtnState();
      } catch (err) {
        showToast('Lỗi bật thông báo: ' + err.message, true);
      }
    };

    window.sendTestPush = async function () {
      playChimeSound();
      try {
        showToast('Đang gửi thông báo thử tới iPhone qua Apple APNs...');
        const res = await api('/api/push/test', { method: 'POST' });
        if (res.sent > 0) {
          showToast('Đã gửi thông báo! Nếu đang mở app, hãy vuốt thanh thông báo từ trên xuống hoặc khóa màn hình để xem banner.');
        } else if (res.total === 0) {
          showToast('Chưa có thiết bị đăng ký! Bấm nút "Bật thông báo" trước khi thử chuông.', true);
        } else {
          showToast(`Apple từ chối (${res.status || 'lỗi'}: ${res.error || 'Vui lòng bấm Bật thông báo để đăng ký lại'})`, true);
        }
      } catch (e) {
        showToast('Lỗi gửi thử chuông: ' + e.message, true);
      }
    };

    // --- SAO LƯU & KHÔI PHỤC ---
    window.downloadBackup = function () {
      window.location.href = '/api/backup';
    };

    window.restoreBackup = async function (e) {
      const file = e.target.files[0];
      if (!file) return;
      if (!confirm('Khôi phục sẽ ghi đè toàn bộ dữ liệu trên web. Tiếp tục?')) {
        e.target.value = '';
        return;
      }
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        await api('/api/restore', {
          method: 'POST',
          body: JSON.stringify(json)
        });
        showToast('Khôi phục dữ liệu thành công!');
        setTimeout(() => window.location.reload(), 1500);
      } catch (err) {
        showToast('File sao lưu không hợp lệ: ' + err.message, true);
      }
      e.target.value = '';
    };

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // ================= 5. MODAL HELPERS & BOTTOM-SHEET GESTURES =================
    function resetModalSheetState(overlay) {
      if (!overlay) return;
      if (overlay._sheetTimer) {
        clearTimeout(overlay._sheetTimer);
        overlay._sheetTimer = null;
      }
      overlay.classList.remove('is-sheet-dragging', 'is-sheet-settling', 'is-sheet-closing');
      overlay.style.removeProperty('--sheet-backdrop-alpha');
      const dialog = overlay.querySelector('.modal-dialog');
      if (dialog) {
        dialog.classList.remove('is-sheet-dragging', 'is-sheet-settling', 'is-sheet-closing');
        dialog.style.transform = '';
      }
    }

    window.openModal = function (id) {
      const el = document.getElementById(id);
      if (el) {
        resetModalSheetState(el);
        el._prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        el.classList.add('open');
        const firstInput = el.querySelector('input:not([type=hidden]):not([disabled]), button:not(.modal-close):not([disabled])');
        if (firstInput) setTimeout(() => firstInput.focus(), 50);
      }
    };

    window.closeModal = function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      resetModalSheetState(el);
      el.classList.remove('open');
      const prev = el._prevFocus;
      el._prevFocus = null;
      if (prev && prev.isConnected && typeof prev.focus === 'function') {
        try { prev.focus(); } catch (_) { }
      }
    };

    document.querySelectorAll('.modal-overlay').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target === el) {
          if (el.id) window.closeModal(el.id);
          else {
            resetModalSheetState(el);
            el.classList.remove('open');
          }
        }
      });
    });

    function setupModalSheetGestures() {
      const scheduleFrame = typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : (fn) => setTimeout(fn, 16);
      const cancelFrame = typeof window.cancelAnimationFrame === 'function'
        ? window.cancelAnimationFrame.bind(window)
        : clearTimeout;
      const nowMs = () => (window.performance && typeof window.performance.now === 'function')
        ? window.performance.now()
        : Date.now();

      function hasScrolledAncestor(target, dialog) {
        let el = target && target.nodeType === 1 ? target : (target && target.parentElement);
        while (el && el !== dialog) {
          if (el.scrollTop > 1) {
            const overflowY = window.getComputedStyle(el).overflowY;
            if (/(auto|scroll)/.test(overflowY)) return true;
          }
          el = el.parentElement;
        }
        return false;
      }

      function computeVelocityY(samples) {
        if (!samples || samples.length < 2) return 0;
        const last = samples[samples.length - 1];
        let first = null;
        for (let i = 0; i < samples.length; i++) {
          if (last.t - samples[i].t <= 100) {
            first = samples[i];
            break;
          }
        }
        if (!first || first === last) return 0;
        const dt = last.t - first.t;
        return dt > 0 ? (last.y - first.y) / dt : 0;
      }

      document.querySelectorAll('.modal-overlay').forEach(overlay => {
        const dialog = overlay.querySelector('.modal-dialog');
        if (!dialog) return;

        if (!dialog.querySelector('.modal-sheet-handle') && typeof document.createElement === 'function') {
          const handle = document.createElement('div');
          handle.className = 'modal-sheet-handle';
          handle.setAttribute('aria-hidden', 'true');
          dialog.insertBefore(handle, dialog.firstChild);
        }

        if (overlay.dataset.sheetBound) return;
        overlay.dataset.sheetBound = '1';

        let sheet = null;
        let rafId = 0;
        let pendingDy = null;

        function cancelSheetFrame() {
          if (rafId) {
            cancelFrame(rafId);
            rafId = 0;
          }
          pendingDy = null;
        }

        function paintSheetDrag(visualDy) {
          if (!sheet) return;
          if (!prefersReducedMotion()) {
            dialog.style.transform = `translate3d(0, ${visualDy.toFixed(1)}px, 0)`;
          }
          const alpha = Math.max(0.08, 1 - (Math.max(0, visualDy) / sheet.dialogH) * 0.85);
          overlay.style.setProperty('--sheet-backdrop-alpha', alpha.toFixed(3));
          sheet.visualDy = visualDy;
        }

        function dismissSheet() {
          if (!sheet) return;
          const dialogH = sheet.dialogH;
          sheet = null;
          if (prefersReducedMotion()) {
            if (overlay.id) window.closeModal(overlay.id);
            else {
              resetModalSheetState(overlay);
              overlay.classList.remove('open');
            }
            return;
          }
          overlay.classList.remove('is-sheet-dragging');
          dialog.classList.remove('is-sheet-dragging');
          overlay.classList.add('is-sheet-closing');
          dialog.classList.add('is-sheet-closing');
          dialog.style.transform = `translate3d(0, ${Math.ceil(dialogH + 36)}px, 0)`;
          overlay.style.setProperty('--sheet-backdrop-alpha', '0');
          overlay._sheetTimer = setTimeout(() => {
            overlay._sheetTimer = null;
            if (overlay.id) window.closeModal(overlay.id);
            else {
              resetModalSheetState(overlay);
              overlay.classList.remove('open');
            }
          }, 210);
        }

        function reboundSheet() {
          if (!sheet) return;
          const hadDrag = sheet.axis === 'y';
          sheet = null;
          if (!hadDrag) return;
          if (prefersReducedMotion()) {
            resetModalSheetState(overlay);
            return;
          }
          overlay.classList.remove('is-sheet-dragging');
          dialog.classList.remove('is-sheet-dragging');
          overlay.classList.add('is-sheet-settling');
          dialog.classList.add('is-sheet-settling');
          dialog.style.transform = 'translate3d(0, 0, 0)';
          overlay.style.setProperty('--sheet-backdrop-alpha', '1');
          overlay._sheetTimer = setTimeout(() => {
            overlay._sheetTimer = null;
            resetModalSheetState(overlay);
          }, 250);
        }

        dialog.addEventListener('touchstart', (e) => {
          cancelSheetFrame();
          if (!overlay.classList.contains('open')) return;
          if (overlay.classList.contains('is-sheet-closing')) return;
          if (!e.touches || e.touches.length !== 1) return;

          const targetEl = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement);
          if (!targetEl || !dialog.contains(targetEl)) return;
          if (targetEl.closest('.modal-close, input[type="range"], select')) return;

          if (overlay.classList.contains('is-sheet-settling')) {
            resetModalSheetState(overlay);
          }

          const touch = e.touches[0];
          const rect = typeof dialog.getBoundingClientRect === 'function'
            ? dialog.getBoundingClientRect()
            : { height: 400 };
          sheet = {
            startX: touch.clientX,
            startY: touch.clientY,
            originY: touch.clientY,
            lastY: touch.clientY,
            visualDy: 0,
            axis: null,
            targetEl,
            fromHeader: Boolean(targetEl.closest('.modal-sheet-handle, .modal-header')),
            dialogH: Math.max(240, rect.height || 400),
            samples: [{ y: touch.clientY, t: nowMs() }]
          };
        }, { passive: true });

        dialog.addEventListener('touchmove', (e) => {
          if (!sheet) return;
          if (!e.touches || e.touches.length !== 1) {
            cancelSheetFrame();
            reboundSheet();
            return;
          }

          const touch = e.touches[0];
          sheet.lastY = touch.clientY;

          if (sheet.axis === null) {
            const dx = touch.clientX - sheet.startX;
            const dy = touch.clientY - sheet.startY;
            const absX = Math.abs(dx);
            const absY = Math.abs(dy);
            if (absX < 8 && absY < 8) return;

            if (absX > absY || dy <= 0) {
              sheet = null;
              return;
            }
            if (absY >= absX * 1.15) {
              const canPull = sheet.fromHeader || (dialog.scrollTop <= 1 && !hasScrolledAncestor(sheet.targetEl, dialog));
              if (!canPull) {
                sheet = null;
                return;
              }
              sheet.axis = 'y';
              sheet.originY = touch.clientY;
              sheet.samples = [{ y: touch.clientY, t: nowMs() }];
              if (document.activeElement && dialog.contains(document.activeElement) && typeof document.activeElement.blur === 'function') {
                document.activeElement.blur();
              }
              overlay.classList.add('is-sheet-dragging');
              dialog.classList.add('is-sheet-dragging');
            } else {
              return;
            }
          }

          if (e.cancelable && typeof e.preventDefault === 'function') {
            e.preventDefault();
          }

          const t = nowMs();
          sheet.samples.push({ y: touch.clientY, t });
          while (sheet.samples.length > 2 && t - sheet.samples[0].t > 100) {
            sheet.samples.shift();
          }

          const rawDy = touch.clientY - sheet.originY;
          const visualDy = rawDy >= 0 ? rawDy : Math.max(-14, rawDy * 0.12);
          pendingDy = visualDy;
          if (!rafId) {
            rafId = scheduleFrame(() => {
              rafId = 0;
              if (pendingDy === null || !sheet) return;
              const val = pendingDy;
              pendingDy = null;
              paintSheetDrag(val);
            });
          }
        }, { passive: false });

        dialog.addEventListener('touchend', (e) => {
          if (!sheet) return;
          if (pendingDy !== null && sheet.axis === 'y') {
            const val = pendingDy;
            cancelSheetFrame();
            paintSheetDrag(val);
          } else {
            cancelSheetFrame();
          }
          if (sheet.axis !== 'y') {
            sheet = null;
            return;
          }

          const touch = (e.changedTouches && e.changedTouches[0]) || null;
          const endY = touch ? touch.clientY : sheet.lastY;
          const t = nowMs();
          sheet.samples.push({ y: endY, t });
          while (sheet.samples.length > 2 && t - sheet.samples[0].t > 100) {
            sheet.samples.shift();
          }

          const dy = Math.max(0, endY - sheet.originY);
          const vy = computeVelocityY(sheet.samples);
          const shouldClose = dy >= Math.min(130, sheet.dialogH * 0.28) || (vy >= 0.45 && dy >= 28);
          if (shouldClose) {
            dismissSheet();
          } else {
            reboundSheet();
          }
        }, { passive: true });

        dialog.addEventListener('touchcancel', () => {
          cancelSheetFrame();
          reboundSheet();
        }, { passive: true });
      });
    }

    // =========================================================================
    // KHU VỰC ĐỘNG LỰC: NGƯỜI CON GÁI PHÙNG VĂN QUYỀN YÊU
    // =========================================================================
    const ALI_PHOTOS = [
      'igexport-Daasz15CSO_-2.webp', 'igexport-Daasz15CSO_-3.webp', 'igexport-Daasz15CSO_-4.webp',
      'igexport-Daasz15CSO_-5.webp', 'igexport-Daasz15CSO_-6.webp', 'igexport-Daasz15CSO_-7.webp',
      'igexport-Daasz15CSO_.webp', 'igexport-Dae9kAVCbKL-10.webp', 'igexport-Dae9kAVCbKL-11.webp',
      'igexport-Dae9kAVCbKL-2.webp', 'igexport-Dae9kAVCbKL-3.webp', 'igexport-Dae9kAVCbKL-4.webp',
      'igexport-Dae9kAVCbKL-5.webp', 'igexport-Dae9kAVCbKL-6.webp', 'igexport-Dae9kAVCbKL-7.webp',
      'igexport-Dae9kAVCbKL-9.webp', 'igexport-Dae9kAVCbKL.webp',
      'igexport-DdIV9QtCUqt-2.webp', 'igexport-DdIV9QtCUqt.webp', 'igexport-De9ryl2ozcv-2.webp',
      'igexport-De9ryl2ozcv-3.webp', 'igexport-De9ryl2ozcv-4.webp', 'igexport-De9ryl2ozcv-5.webp',
      'igexport-De9ryl2ozcv-6.webp', 'igexport-De9ryl2ozcv-7.webp', 'igexport-De9ryl2ozcv-8.webp',
      'igexport-De9ryl2ozcv.webp', 'igexport-DNaF8pjBQDg-10.webp', 'igexport-DNaF8pjBQDg-11.webp',
      'igexport-DNaF8pjBQDg-12.webp', 'igexport-DNaF8pjBQDg-13.webp', 'igexport-DNaF8pjBQDg-14.webp',
      'igexport-DNaF8pjBQDg-15.webp', 'igexport-DNaF8pjBQDg-16.webp', 'igexport-DNaF8pjBQDg-17.webp',
      'igexport-DNaF8pjBQDg-18.webp', 'igexport-DNaF8pjBQDg-19.webp', 'igexport-DNaF8pjBQDg-2.webp',
      'igexport-DNaF8pjBQDg-3.webp', 'igexport-DNaF8pjBQDg-4.webp', 'igexport-DNaF8pjBQDg-5.webp',
      'igexport-DNaF8pjBQDg-6.webp', 'igexport-DNaF8pjBQDg-7.webp', 'igexport-DNaF8pjBQDg-8.webp',
      'igexport-DNaF8pjBQDg-9.webp', 'igexport-DNaF8pjBQDg.webp'
    ];

    const MOTIVATION_QUOTES = [
      "Mỗi ngày kiên trì một chút, để trở thành phiên bản phong độ và khoẻ mạnh nhất bên người mình yêu.",
      "Mỗi khi muốn bỏ cuộc, hãy nhớ đến nụ cười của cô ấy để tiếp tục cố gắng!",
      "Mục tiêu 70kg — Giảm cân vì người con gái tôi yêu.",
      "Tình yêu là động lực lớn nhất để thay đổi và hoàn thiện bản thân mỗi ngày.",
      "Hôm nay uống đủ nước, ăn chuẩn calo để luôn khoẻ mạnh và tự tin bên cô ấy nhé Quyền!",
      "Cô ấy chính là lý do để bạn kỷ luật với bản thân hôm nay và ngày mai.",
      "Một cơ thể khoẻ khoắn, một trái tim kiên định dành trọn cho người mình yêu.",
      "Đích đến 70kg không còn xa — Hãy vững vàng vì người con gái ấy!",
      "Khỏe mạnh hơn, tự tin hơn, hạnh phúc hơn cùng người con gái trong tim."
    ];

    let currentMotivationIdx = 0;
    let motivationInitialized = false;

    function initMotivationSection() {
      const strip = document.getElementById('motivation-thumbs-strip');
      if (!strip) return;

      if (!motivationInitialized) {
        const saved = localStorage.getItem('quyen_motivation_idx');
        if (saved !== null && !isNaN(parseInt(saved))) {
          currentMotivationIdx = parseInt(saved) % ALI_PHOTOS.length;
        } else {
          currentMotivationIdx = Math.floor(Math.random() * ALI_PHOTOS.length);
        }

        strip.innerHTML = ALI_PHOTOS.map((file, idx) => `
        <img src="/ali/${file}" alt="Ảnh Ali ${idx + 1}" class="motivation-thumb-item ${idx === currentMotivationIdx ? 'active' : ''}" loading="lazy" onclick="selectMotivationPhoto(${idx})">
      `).join('');
        motivationInitialized = true;
      }

      renderMotivationHero();
    }

    function renderMotivationHero() {
      const heroImg = document.getElementById('motivation-hero-img');
      const quoteText = document.getElementById('motivation-quote-text');
      if (heroImg) {
        heroImg.style.opacity = '0.35';
        setTimeout(() => {
          heroImg.src = '/ali/' + ALI_PHOTOS[currentMotivationIdx];
          heroImg.style.opacity = '1';
        }, 120);
      }
      if (quoteText) {
        const qIdx = currentMotivationIdx % MOTIVATION_QUOTES.length;
        quoteText.textContent = `"${MOTIVATION_QUOTES[qIdx]}"`;
      }

      const thumbs = document.querySelectorAll('.motivation-thumb-item');
      thumbs.forEach((el, idx) => {
        if (idx === currentMotivationIdx) {
          el.classList.add('active');
          el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        } else {
          el.classList.remove('active');
        }
      });

      localStorage.setItem('quyen_motivation_idx', currentMotivationIdx);
    }

    window.selectMotivationPhoto = function (idx) {
      if (idx < 0 || idx >= ALI_PHOTOS.length) return;
      currentMotivationIdx = idx;
      renderMotivationHero();
    };

    window.shuffleMotivationPhoto = function () {
      if (ALI_PHOTOS.length <= 1) return;
      let next;
      do {
        next = Math.floor(Math.random() * ALI_PHOTOS.length);
      } while (next === currentMotivationIdx);
      currentMotivationIdx = next;
      renderMotivationHero();
    };

    window.openMotivationModal = function () {
      const modalImg = document.getElementById('modal-motivation-img');
      const modalCaption = document.getElementById('modal-motivation-caption');
      if (modalImg) modalImg.src = '/ali/' + ALI_PHOTOS[currentMotivationIdx];
      if (modalCaption) {
        const qIdx = currentMotivationIdx % MOTIVATION_QUOTES.length;
        modalCaption.textContent = `"${MOTIVATION_QUOTES[qIdx]}"`;
      }
      openModal('modal-motivation');
    };

    window.nextMotivationPhoto = function () {
      currentMotivationIdx = (currentMotivationIdx + 1) % ALI_PHOTOS.length;
      renderMotivationHero();
      const modalImg = document.getElementById('modal-motivation-img');
      const modalCaption = document.getElementById('modal-motivation-caption');
      if (modalImg) modalImg.src = '/ali/' + ALI_PHOTOS[currentMotivationIdx];
      if (modalCaption) {
        const qIdx = currentMotivationIdx % MOTIVATION_QUOTES.length;
        modalCaption.textContent = `"${MOTIVATION_QUOTES[qIdx]}"`;
      }
    };

    window.prevMotivationPhoto = function () {
      currentMotivationIdx = (currentMotivationIdx - 1 + ALI_PHOTOS.length) % ALI_PHOTOS.length;
      renderMotivationHero();
      const modalImg = document.getElementById('modal-motivation-img');
      const modalCaption = document.getElementById('modal-motivation-caption');
      if (modalImg) modalImg.src = '/ali/' + ALI_PHOTOS[currentMotivationIdx];
      if (modalCaption) {
        const qIdx = currentMotivationIdx % MOTIVATION_QUOTES.length;
        modalCaption.textContent = `"${MOTIVATION_QUOTES[qIdx]}"`;
      }
    };

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const openModals = Array.from(document.querySelectorAll('.modal-overlay.open'));
        if (openModals.length > 0) {
          const topModal = openModals[openModals.length - 1];
          if (topModal.id) window.closeModal(topModal.id);
          else topModal.classList.remove('open');
          return;
        }
        const fabMenu = document.getElementById('funds-fab-menu');
        if (fabMenu && fabMenu.classList.contains('open') && typeof window.closeFundsFabMenu === 'function') {
          window.closeFundsFabMenu({ restoreFocus: true });
        }
      }
    });

    // =========================================================================
    // 6. SỔ CÔNG VIỆC CỦA QUYỀN (THAY THẾ BẢNG EXCEL TRÊN ĐIỆN THOẠI)
    // =========================================================================
    let workLoadSeq = 0;
    let workState = {
      date: '',
      month: '',
      calendarMonth: '',
      today: '',
      workCalendarExpanded: false,
      ledgerCalendarExpanded: false,
      heroScope: 'day', // 'day' | 'month'
      ledgerScope: 'day', // 'day' | 'month'
      subTab: 'jobs', // 'jobs' | 'unpaid'
      jobs: [],
      ledger: [],
      allBorrows: [],
      borrowFilter: 'all', // 'all' | 'unpaid' | 'settled'
      borrowSearchQuery: '',
      dayRepayments: [],
      daySummary: {},
      monthSummary: {},
      unpaidGroups: [],
      debtGroups: [],
      debtFilter: 'all',
      debtExpandedKeys: {},
      debtSearchQuery: '',
      debtTimeMode: 'all', // 'all' | 'day' | 'month' | 'range'
      debtTimeDate: '',
      debtTimeMonth: '',
      debtTimeFrom: '',
      debtTimeTo: '',
      totalUnpaidAll: 0,
      totalUnpaidJobs: 0,
      recentDays: [],
      suggestions: { customers: [], services: [] }
    };

    function getInstallmentTotals(origRaw, installmentsRaw, fallbackPaidRaw) {
      const orig = Math.max(0, Number(origRaw) || 0);
      const installments = Array.isArray(installmentsRaw) ? installmentsRaw : [];
      const sumPaid = installments.reduce((acc, r) => acc + Math.max(0, Number(r && r.amount) || 0), 0);
      const paid = installments.length > 0
        ? sumPaid
        : Math.max(0, Number(fallbackPaidRaw) || 0);
      const remaining = Math.max(0, orig - paid);
      const overpaid = Math.max(0, paid - orig);
      return { orig, paid, remaining, overpaid, installments };
    }

    function getBorrowTotals(item) {
      const t = getInstallmentTotals(item && item.amount, item && item.repayments, item && item.paid_amount);
      return { orig: t.orig, paid: t.paid, remaining: t.remaining, overpaid: t.overpaid, repayments: t.installments };
    }

    function getDebtJobTotals(job) {
      const orig = Math.max(0, Number(job && job.price) || 0);
      const pays = Array.isArray(job && job.payments) ? job.payments : [];
      const isTT = Boolean(job && job.status === 'TT');
      if (pays.length > 0) {
        const t = getInstallmentTotals(orig, pays, job && job.paid_amount);
        return {
          orig: t.orig,
          paid: t.paid,
          remaining: isTT ? 0 : t.remaining,
          overpaid: t.overpaid,
          payments: pays
        };
      }
      return {
        orig,
        paid: isTT ? orig : 0,
        remaining: isTT ? 0 : orig,
        overpaid: 0,
        payments: []
      };
    }

    function findDebtJobById(jobId) {
      const target = Number(jobId);
      const scan = (list) => {
        for (const x of (list || [])) {
          if (x && Number(x.id) === target) return x;
        }
        return null;
      };
      let found = scan(workState.jobs);
      if (found) return found;
      for (const grpList of [workState.debtGroups, workState.unpaidGroups]) {
        for (const g of (grpList || [])) {
          found = scan(g && g.jobs);
          if (found) return found;
        }
      }
      const vault = readFinanceVaultSync();
      return scan(vault.jobs);
    }

    function getAllBorrowItems() {
      const vault = readFinanceVaultSync();
      const vBorrows = Array.isArray(vault.ledger)
        ? vault.ledger.filter(l => l && l.category === 'borrow')
        : [];
      if (vBorrows.length > 0) return vBorrows;
      return Array.isArray(workState.allBorrows) ? workState.allBorrows : [];
    }

    function getGlobalBorrowSummary() {
      const items = getAllBorrowItems();
      let orig = 0;
      let paid = 0;
      let remaining = 0;
      let unpaidCount = 0;
      let settledCount = 0;
      items.forEach(item => {
        const t = getBorrowTotals(item);
        orig += t.orig;
        paid += t.paid;
        remaining += t.remaining;
        if (t.orig > 0 && t.remaining <= 0) settledCount++;
        else unpaidCount++;
      });
      return {
        items,
        totalCount: items.length,
        unpaidCount,
        settledCount,
        orig,
        paid,
        remaining
      };
    }

    function findBorrowLedgerItem(ledgerId) {
      const targetId = Number(ledgerId);
      if (!targetId) return null;
      const inAll = getAllBorrowItems().find(l => Number(l.id) === targetId);
      if (inAll) return inAll;
      const inState = (workState.ledger || []).find(l => Number(l.id) === targetId);
      if (inState) return inState;
      const v = readFinanceVaultSync();
      return (v.ledger || []).find(l => Number(l.id) === targetId) || null;
    }

    function findLedgerItemById(ledgerId) {
      const targetId = Number(ledgerId);
      if (!targetId) return null;
      const inState = (workState.ledger || []).find(l => Number(l.id) === targetId);
      if (inState) return inState;
      const inAll = (workState.allBorrows || []).find(l => Number(l.id) === targetId);
      if (inAll) return inAll;
      const v = readFinanceVaultSync();
      return (v.ledger || []).find(l => Number(l.id) === targetId) || null;
    }

    function escapeHTML(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    /** Normalizes Vietnamese text for diacritic- and case-insensitive search. */
    function normalizeSearchText(str) {
      return String(str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[đĐ]/g, 'd')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
    }

    /** Matches a date token like 15/11, 15/11/2026, 11/2026, or 2026-11 against YYYY-MM-DD. */
    function doesDateMatchSearchToken(dateStr, token) {
      if (!dateStr || !token) return false;
      const parts = String(dateStr).split('-');
      if (parts.length !== 3) return false;
      const y = Number(parts[0]);
      const m = Number(parts[1]);
      const d = Number(parts[2]);
      if (!y || !m || !d) return false;

      let match = token.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
      if (match) {
        return Number(match[1]) === d && Number(match[2]) === m;
      }
      match = token.match(/^(\d{1,2})[\/\-](\d{4})$/);
      if (match) {
        return Number(match[1]) === m && Number(match[2]) === y;
      }
      match = token.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
      if (match) {
        let yy = Number(match[3]);
        if (match[3].length === 2) yy += 2000;
        return Number(match[1]) === d && Number(match[2]) === m && yy === y;
      }
      match = token.match(/^(\d{4})[\/\-](\d{1,2})(?:[\/\-](\d{1,2}))?$/);
      if (match) {
        const dy = Number(match[1]);
        const dm = Number(match[2]);
        const dd = match[3] ? Number(match[3]) : null;
        return dy === y && dm === m && (dd === null || dd === d);
      }
      return false;
    }

    /** Returns true when every whitespace token in query matches fields or optional dateStr. */
    function matchesTokenizedQuery(query, fields, dateStrOpt) {
      const qNorm = normalizeSearchText(query);
      if (!qNorm) return true;
      const combined = normalizeSearchText((fields || []).filter(Boolean).join(' '));
      const tokens = qNorm.split(' ');
      return tokens.every(tok => combined.includes(tok) || (dateStrOpt ? doesDateMatchSearchToken(dateStrOpt, tok) : false));
    }

    /** Keeps a search input and clear button synced without interrupting active IME input. */
    function syncSearchInputUI(inputId, clearBtnId, rawQuery) {
      const inputEl = document.getElementById(inputId);
      const val = String(rawQuery || '');
      if (inputEl && document.activeElement !== inputEl && inputEl.value !== val) {
        inputEl.value = val;
      }
      const clearBtn = document.getElementById(clearBtnId);
      if (clearBtn) {
        clearBtn.hidden = !val.trim();
      }
    }

    /** Updates the search summary bar and permanent screen-reader status live region. */
    function renderSearchStatusBanner(statusId, liveId, isActive, text, resetFnName, isEmpty) {
      const statusEl = document.getElementById(statusId);
      const liveEl = document.getElementById(liveId);
      if (statusEl) {
        if (!isActive) {
          statusEl.hidden = true;
          statusEl.classList.remove('is-empty-result');
          statusEl.innerHTML = '';
        } else {
          statusEl.hidden = false;
          statusEl.classList.toggle('is-empty-result', Boolean(isEmpty));
          statusEl.innerHTML = `
            <span class="work-search-status-text">${escapeHTML(text)}</span>
            <button type="button" class="btn-search-reset" onclick="${resetFnName}()">Xoá lọc</button>
          `;
        }
      }
      if (liveEl) {
        liveEl.textContent = isActive ? text : '';
      }
    }

    function workIconSVG(name, size = 14) {
      const paths = {
        check: '<path d="M20 6L9 17l-5-5"/>',
        clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
        expense: '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>',
        fund_in: '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
        fund_bal: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
        borrow: '<line x1="17" y1="7" x2="7" y2="17"/><polyline points="17 17 7 17 7 7"/>',
        repay: '<line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/>',
        shield_ok: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>'
      };
      const body = paths[name] || '';
      return `<svg class="ui-inline-svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
    }

    function formatVND(amount) {
      const n = Number(amount) || 0;
      return n.toLocaleString('vi-VN') + 'đ';
    }

    function formatShortK(amount) {
      const n = Number(amount) || 0;
      if (n === 0) return '0đ';
      const abs = Math.abs(n);
      const sign = n < 0 ? '-' : '';
      if (abs >= 1000000000) {
        const ty = (abs / 1000000000).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
        return `${sign}${ty} tỷ`;
      }
      if (abs >= 1000000) {
        const tr = (abs / 1000000).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
        return `${sign}${tr}tr`;
      }
      if (abs >= 1000) {
        const k = (abs / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 });
        return `${sign}${k}k`;
      }
      return n.toLocaleString('vi-VN') + 'đ';
    }

    // Quy ước nhập tiền thống nhất: mọi ô nhập tiền đều theo đơn vị nghìn đồng (1 = 1.000đ, 1000 = 1.000.000đ)
    function parseMoneyInputVND(rawVal) {
      const cleaned = String(rawVal == null ? '' : rawVal).trim().replace(',', '.');
      if (!cleaned) return 0;
      const num = Number(cleaned);
      if (!Number.isFinite(num) || num <= 0) return 0;
      return Math.round(num * 1000);
    }

    function formatMoneyInputVal(vnd) {
      const n = Number(vnd) || 0;
      if (n <= 0) return '';
      return String(Math.round(n) / 1000);
    }

    function shiftDateStr(dStr, deltaDays) {
      const parts = dStr.split('-').map(Number);
      const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
      dt.setUTCDate(dt.getUTCDate() + deltaDays);
      return dt.toISOString().slice(0, 10);
    }

    // ---------- KÉT LƯU TRỮ DỮ LIỆU TÀI CHÍNH TRÊN MÁY CÁ NHÂN (LOCAL-FIRST + AUTO-HEAL REDEPLOY) ----------
    const FINANCE_VAULT_KEY = 'qh_finance_vault_v1';
    const FINANCE_IDB_NAME = 'QuyenFinanceVaultDB';
    const FINANCE_IDB_STORE = 'kv';
    let linkedFinanceFileHandle = null;
    let idbHydrated = false;

    function openFinanceIDB() {
      return new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) return reject(new Error('No IndexedDB'));
        const req = indexedDB.open(FINANCE_IDB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(FINANCE_IDB_STORE)) {
            db.createObjectStore(FINANCE_IDB_STORE);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }

    async function idbGet(key) {
      try {
        const db = await openFinanceIDB();
        return await new Promise((resolve) => {
          const tx = db.transaction(FINANCE_IDB_STORE, 'readonly');
          const req = tx.objectStore(FINANCE_IDB_STORE).get(key);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        });
      } catch (e) {
        return null;
      }
    }

    async function idbSet(key, val) {
      try {
        const db = await openFinanceIDB();
        await new Promise((resolve) => {
          const tx = db.transaction(FINANCE_IDB_STORE, 'readwrite');
          tx.objectStore(FINANCE_IDB_STORE).put(val, key);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        });
      } catch (e) { }
    }

    function readFinanceVaultSync() {
      try {
        const raw = localStorage.getItem(FINANCE_VAULT_KEY);
        if (!raw) return { db_id: '', updated_at: 0, dirty: false, jobs: [], ledger: [], tombstones: [] };
        const parsed = JSON.parse(raw);
        return {
          db_id: parsed.db_id || '',
          updated_at: parsed.updated_at || 0,
          dirty: Boolean(parsed.dirty),
          jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
          ledger: Array.isArray(parsed.ledger) ? parsed.ledger : [],
          tombstones: Array.isArray(parsed.tombstones) ? parsed.tombstones : []
        };
      } catch (e) {
        return { db_id: '', updated_at: 0, dirty: false, jobs: [], ledger: [], tombstones: [] };
      }
    }

    async function hydrateVaultFromIDB() {
      if (idbHydrated) return readFinanceVaultSync();
      idbHydrated = true;
      const local = readFinanceVaultSync();
      const idbVault = await idbGet('vault_main');
      const savedHandle = await idbGet('file_handle');
      if (savedHandle) {
        linkedFinanceFileHandle = savedHandle;
        updateLinkDiskButtonUI();
      }
      if (idbVault && Array.isArray(idbVault.jobs)) {
        const localCount = (local.jobs ? local.jobs.length : 0) + (local.ledger ? local.ledger.length : 0);
        const idbCount = idbVault.jobs.length + (Array.isArray(idbVault.ledger) ? idbVault.ledger.length : 0);
        if (localCount === 0 && idbCount > 0) {
          const normalized = Object.assign({ tombstones: [] }, idbVault);
          try {
            localStorage.setItem(FINANCE_VAULT_KEY, JSON.stringify(normalized));
          } catch (e) { }
          return normalized;
        }
      }
      return local;
    }

    async function writeToLinkedDiskFile(payload) {
      if (!linkedFinanceFileHandle) return;
      try {
        if (linkedFinanceFileHandle.queryPermission) {
          const perm = await linkedFinanceFileHandle.queryPermission({ mode: 'readwrite' });
          if (perm !== 'granted') return;
        }
        const writable = await linkedFinanceFileHandle.createWritable();
        await writable.write(JSON.stringify(payload, null, 2));
        await writable.close();
      } catch (e) { }
    }

    function saveFinanceVaultToDevice(vaultInput) {
      const cur = readFinanceVaultSync();
      const payload = {
        app: 'QuyenHealth-FinanceVault',
        version: 2,
        db_id: vaultInput.db_id !== undefined ? vaultInput.db_id : cur.db_id,
        updated_at: Date.now(),
        dirty: Boolean(vaultInput.dirty),
        jobs: Array.isArray(vaultInput.jobs) ? vaultInput.jobs : cur.jobs,
        ledger: Array.isArray(vaultInput.ledger) ? vaultInput.ledger : cur.ledger,
        tombstones: Array.isArray(vaultInput.tombstones) ? vaultInput.tombstones.slice(-1500) : (cur.tombstones || [])
      };
      try {
        localStorage.setItem(FINANCE_VAULT_KEY, JSON.stringify(payload));
      } catch (e) { }
      idbSet('vault_main', payload);
      writeToLinkedDiskFile(payload);
      renderFinanceVaultStatus(payload);
      return payload;
    }

    function appendTombstoneToVault(vaultObj, kind, uid, sig) {
      if (!vaultObj || (!uid && !sig)) return;
      const list = Array.isArray(vaultObj.tombstones) ? vaultObj.tombstones.slice() : [];
      const key = uid || `sig:${kind}:${sig}`;
      const deletedAt = Math.floor(Date.now() / 1000);
      const next = list.filter(t => t && t.uid !== key);
      next.push({ uid: key, kind, sig: sig || '', deleted_at: deletedAt });
      vaultObj.tombstones = next.slice(-1500);
    }

    function removeJobFromLocalVault(jobId, opts = {}) {
      const cur = readFinanceVaultSync();
      const targetJob = (cur.jobs || []).find(j => Number(j.id) === Number(jobId));
      if (opts.tombstone && targetJob) {
        appendTombstoneToVault(cur, 'job', targetJob.uid || '', computeWorkJobSig(targetJob));
      }
      cur.jobs = (cur.jobs || []).filter(j => Number(j.id) !== Number(jobId));
      if (opts.dirty) cur.dirty = true;
      saveFinanceVaultToDevice(cur);
    }

    function updateJobInLocalVault(jobId, jobUid, patch) {
      const cur = readFinanceVaultSync();
      const nowTs = Math.floor(Date.now() / 1000);
      cur.jobs = (cur.jobs || []).map(j => {
        const matchId = jobId && Number(j.id) === Number(jobId);
        const matchUid = jobUid && j.uid && j.uid === jobUid;
        if (!matchId && !matchUid) return j;
        const next = Object.assign({}, j, patch, { updated_at: nowTs });
        return normalizeVaultJobAfterPaymentEdit(next, Array.isArray(next.payments) ? next.payments : []);
      });
      saveFinanceVaultToDevice(cur);
    }

    function normalizeVaultJobAfterPaymentEdit(j, nextPays) {
      nextPays.sort((a, b) => (a.date === b.date ? (Number(a.id) - Number(b.id)) : (a.date < b.date ? -1 : 1)));
      const paid = nextPays.reduce((s, p) => s + Math.max(0, Number(p.amount) || 0), 0);
      const orig = Math.max(0, Number(j.price) || 0);
      const rem = Math.max(0, orig - paid);
      return {
        ...j,
        payments: nextPays,
        paid_amount: paid,
        remaining_amount: rem,
        status: nextPays.length > 0 ? (rem === 0 ? 'TT' : 'CTT') : (j.status || 'TT')
      };
    }

    function addJobPaymentToLocalVault(jobId, payment, opts = {}) {
      const cur = readFinanceVaultSync();
      const targetId = Number(jobId);
      const list = cur.jobs || [];
      let found = false;
      const updated = list.map(j => {
        if (Number(j.id) !== targetId) return j;
        found = true;
        const nextPays = Array.isArray(j.payments) ? [...j.payments] : [];
        const payId = Number(payment.id);
        const payUid = payment.uid || '';
        const dup = (payUid && nextPays.some(p => p.uid === payUid)) || (payId && nextPays.some(p => Number(p.id) === payId));
        if (!dup) {
          nextPays.push(payment);
        }
        return normalizeVaultJobAfterPaymentEdit(j, nextPays);
      });
      if (!found) {
        const fallback = findDebtJobById(targetId);
        if (fallback) {
          const nextPays = Array.isArray(fallback.payments) ? [...fallback.payments, payment] : [payment];
          updated.push(normalizeVaultJobAfterPaymentEdit(fallback, nextPays));
        }
      }
      cur.jobs = updated;
      if (opts.dirty) cur.dirty = true;
      saveFinanceVaultToDevice(cur);
    }

    function removeJobPaymentFromLocalVault(paymentId, opts = {}) {
      const cur = readFinanceVaultSync();
      const targetPayId = Number(paymentId);
      cur.jobs = (cur.jobs || []).map(j => {
        if (!Array.isArray(j.payments) || !j.payments.some(p => Number(p.id) === targetPayId)) {
          return j;
        }
        const victim = j.payments.find(p => Number(p.id) === targetPayId);
        if (opts.tombstone && victim) {
          appendTombstoneToVault(cur, 'job_payment', victim.uid || '', computeInstallmentSig(victim));
        }
        const nextPays = j.payments.filter(p => Number(p.id) !== targetPayId);
        return normalizeVaultJobAfterPaymentEdit({ ...j, status: nextPays.length === 0 ? 'CTT' : j.status }, nextPays);
      });
      if (opts.dirty) cur.dirty = true;
      saveFinanceVaultToDevice(cur);
    }

    function payCustomerDebtInLocalVault(customerName, opts = {}) {
      const cur = readFinanceVaultSync();
      const targetCust = (customerName || '').trim().toLowerCase();
      const todayStr = workState.today || state.today || new Date().toISOString().slice(0, 10);
      const nowTs = Math.floor(Date.now() / 1000);
      let seq = Date.now();
      cur.jobs = (cur.jobs || []).map(j => {
        if ((j.customer || '').trim().toLowerCase() !== targetCust || j.status !== 'CTT') return j;
        const nextPays = Array.isArray(j.payments) ? [...j.payments] : [];
        const dt = getDebtJobTotals(j);
        if (dt.remaining > 0) {
          nextPays.push({
            id: ++seq,
            uid: genClientUID('jpay'),
            job_id: j.id,
            date: todayStr,
            amount: dt.remaining,
            note: 'Trả hết nợ',
            ts: nowTs
          });
        }
        return normalizeVaultJobAfterPaymentEdit({ ...j, updated_at: nowTs }, nextPays);
      });
      if (opts.dirty) cur.dirty = true;
      saveFinanceVaultToDevice(cur);
    }

    function removeLedgerFromLocalVault(ledgerId, opts = {}) {
      const cur = readFinanceVaultSync();
      const targetItem = (cur.ledger || []).find(l => Number(l.id) === Number(ledgerId));
      if (opts.tombstone && targetItem) {
        appendTombstoneToVault(cur, 'ledger', targetItem.uid || '', computeWorkLedgerSig(targetItem));
      }
      cur.ledger = (cur.ledger || []).filter(l => Number(l.id) !== Number(ledgerId));
      if (opts.dirty) cur.dirty = true;
      saveFinanceVaultToDevice(cur);
    }

    function addRepaymentToLocalVault(ledgerId, repayment, opts = {}) {
      const cur = readFinanceVaultSync();
      const targetId = Number(ledgerId);
      const list = cur.ledger || [];
      let found = false;
      const updated = list.map(l => {
        if (Number(l.id) !== targetId) return l;
        found = true;
        const nextReps = Array.isArray(l.repayments) ? [...l.repayments] : [];
        const repId = Number(repayment.id);
        const repUid = repayment.uid || '';
        const dup = (repUid && nextReps.some(r => r.uid === repUid)) || (repId && nextReps.some(r => Number(r.id) === repId));
        if (!dup) {
          nextReps.push(repayment);
        }
        nextReps.sort((a, b) => (a.date === b.date ? (Number(a.id) - Number(b.id)) : (a.date < b.date ? -1 : 1)));
        const paid = nextReps.reduce((s, r) => s + Math.max(0, Number(r.amount) || 0), 0);
        const orig = Math.max(0, Number(l.amount) || 0);
        return {
          ...l,
          repayments: nextReps,
          paid_amount: paid,
          remaining_amount: Math.max(0, orig - paid)
        };
      });
      if (!found) {
        const fallback = findBorrowLedgerItem(targetId);
        if (fallback) {
          const nextReps = Array.isArray(fallback.repayments) ? [...fallback.repayments, repayment] : [repayment];
          const paid = nextReps.reduce((s, r) => s + Math.max(0, Number(r.amount) || 0), 0);
          const orig = Math.max(0, Number(fallback.amount) || 0);
          updated.push({
            ...fallback,
            repayments: nextReps,
            paid_amount: paid,
            remaining_amount: Math.max(0, orig - paid)
          });
        }
      }
      cur.ledger = updated;
      if (opts.dirty) cur.dirty = true;
      saveFinanceVaultToDevice(cur);
    }

    function removeRepaymentFromLocalVault(repaymentId, opts = {}) {
      const cur = readFinanceVaultSync();
      const targetRepId = Number(repaymentId);
      cur.ledger = (cur.ledger || []).map(l => {
        if (!Array.isArray(l.repayments) || !l.repayments.some(r => Number(r.id) === targetRepId)) {
          return l;
        }
        const victim = l.repayments.find(r => Number(r.id) === targetRepId);
        if (opts.tombstone && victim) {
          appendTombstoneToVault(cur, 'repayment', victim.uid || '', computeInstallmentSig(victim));
        }
        const nextReps = l.repayments.filter(r => Number(r.id) !== targetRepId);
        const paid = nextReps.reduce((s, r) => s + Math.max(0, Number(r.amount) || 0), 0);
        const orig = Math.max(0, Number(l.amount) || 0);
        return {
          ...l,
          repayments: nextReps,
          paid_amount: paid,
          remaining_amount: Math.max(0, orig - paid)
        };
      });
      if (opts.dirty) cur.dirty = true;
      saveFinanceVaultToDevice(cur);
    }

    function updateLinkDiskButtonUI() {
      const lbl = document.getElementById('work-link-disk-label');
      const btn = document.getElementById('btn-work-link-disk');
      if (!lbl || !btn) return;
      const pendingCount = readSyncQueueSync().length;
      if (linkedFinanceFileHandle) {
        lbl.textContent = 'Đã gắn ổ cứng';
        btn.classList.add('is-linked');
      } else if ('showSaveFilePicker' in window) {
        lbl.textContent = 'Gắn file ổ cứng';
        btn.classList.remove('is-linked');
      } else {
        lbl.textContent = pendingCount > 0 ? `Đồng bộ ngay (${pendingCount})` : 'Đồng bộ ngay';
        btn.classList.remove('is-linked');
      }
    }

    function renderFinanceVaultStatus(vaultOpt) {
      const v = vaultOpt || readFinanceVaultSync();
      const badgeEl = document.getElementById('work-vault-badge');
      const subEl = document.getElementById('work-vault-sub');
      const jobCount = (v.jobs || []).length;
      const ledgerCount = (v.ledger || []).length;
      const pendingCount = readSyncQueueSync().length;

      if (badgeEl) {
        badgeEl.classList.toggle('is-pending', pendingCount > 0);
        badgeEl.textContent = pendingCount > 0
          ? `Chờ đồng bộ ${pendingCount} • ${jobCount} đơn`
          : `Đã đồng bộ ${jobCount} đơn • ${ledgerCount} thu chi`;
      }
      if (subEl) {
        const timeStr = v.updated_at
          ? new Date(v.updated_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
          : '';
        if (pendingCount > 0) {
          subEl.textContent = `Đang có ${pendingCount} thao tác lưu tạm trên thiết bị này — tự động đẩy lên máy chủ ngay khi có mạng.`;
        } else if (linkedFinanceFileHandle) {
          subEl.textContent = `Đã đồng bộ đa thiết bị & lưu kép vào file ổ cứng${timeStr ? ' (lúc ' + timeStr + ')' : ''}.`;
        } else {
          subEl.textContent = `Đã đồng bộ giữa các thiết bị${timeStr ? ' (cập nhật ' + timeStr + ')' : ''} & sao lưu an toàn trên máy.`;
        }
      }
      updateLinkDiskButtonUI();
    }

    async function syncFinanceVaultOnBoot(opts = {}) {
      try {
        await flushPendingSyncQueues({ silent: true });
        const localVault = await hydrateVaultFromIDB();
        renderFinanceVaultStatus(localVault);
        const localHasData = (localVault.jobs && localVault.jobs.length > 0) || (localVault.ledger && localVault.ledger.length > 0);
        const srv = await api('/api/work/vault', { silent: true });
        if (srv && srv.db_id) {
          syncState.dbId = srv.db_id;
        }
        if (srv && typeof srv.work_rev === 'number') {
          syncState.workRev = Math.max(syncState.workRev, srv.work_rev);
        }
        const srvJobs = srv.jobs || [];
        const srvLedger = srv.ledger || [];
        const srvTombstones = Array.isArray(srv.tombstones) ? srv.tombstones : [];
        const srvEmpty = srvJobs.length === 0 && srvLedger.length === 0;
        const dbChanged = Boolean(localVault.db_id && srv.db_id && localVault.db_id !== srv.db_id);

        if (localHasData && (srvEmpty || dbChanged || localVault.dirty)) {
          const synced = await api('/api/work/vault', {
            method: 'POST',
            silent: Boolean(opts.silent),
            body: JSON.stringify({
              mode: 'merge',
              jobs: localVault.jobs,
              ledger: localVault.ledger,
              tombstones: localVault.tombstones || []
            })
          });
          if (synced && typeof synced.work_rev === 'number') {
            syncState.workRev = Math.max(syncState.workRev, synced.work_rev);
          }
          saveFinanceVaultToDevice({
            db_id: synced.db_id || srv.db_id,
            dirty: false,
            jobs: synced.jobs || localVault.jobs,
            ledger: synced.ledger || localVault.ledger,
            tombstones: Array.isArray(synced.tombstones) ? synced.tombstones : srvTombstones
          });
          if (!opts.silent) {
            showToast('Đã đồng bộ & khôi phục an toàn dữ liệu Sổ công việc');
          }
        } else {
          saveFinanceVaultToDevice({
            db_id: srv.db_id || localVault.db_id,
            dirty: false,
            jobs: srvJobs,
            ledger: srvLedger,
            tombstones: srvTombstones
          });
        }
        computeWorkFromLocalVault(workState.date || state.today);
      } catch (e) { }
    }

    function computeWorkFromLocalVault(targetDate, targetMonth) {
      const v = readFinanceVaultSync();
      const date = targetDate || workState.date || state.today || new Date().toISOString().slice(0, 10);
      const month = (targetMonth && /^\d{4}-\d{2}$/.test(targetMonth))
        ? targetMonth
        : date.slice(0, 7);
      const allJobs = (v.jobs || []).filter(j => !isJobPendingDelete(j));
      const allLedger = (v.ledger || []).filter(l => !isLedgerPendingDelete(l));

      const dayJobs = allJobs.filter(j => j.date === date);
      const dayLedger = allLedger.filter(l => l.date === date);

      const calcSum = (jobsArr, ledgerArr, payMatchFn) => {
        const s = {
          total_jobs: 0, paid_jobs: 0, unpaid_jobs: 0,
          total_revenue: 0, paid_amount: 0, unpaid_amount: 0,
          expense_amount: 0, net_cash: 0, fund_in: 0, fund_bal: 0,
          borrow_amount: 0, repay_amount: 0
        };
        jobsArr.forEach(j => {
          const p = Math.max(0, Number(j.price) || 0);
          s.total_jobs++;
          s.total_revenue += p;
          const dt = getDebtJobTotals(j);
          if (dt.payments.length > 0) {
            if (dt.remaining > 0) {
              s.unpaid_jobs++;
              s.unpaid_amount += dt.remaining;
            } else {
              s.paid_jobs++;
            }
          } else if (j.status === 'CTT') {
            s.unpaid_jobs++;
            s.unpaid_amount += p;
          } else {
            s.paid_jobs++;
            s.paid_amount += p;
          }
        });
        ledgerArr.forEach(l => {
          const a = Number(l.amount) || 0;
          if (l.category === 'expense') s.expense_amount += a;
          if (l.category === 'fund_in') s.fund_in += a;
          if (l.category === 'fund_bal') s.fund_bal = a;
          if (l.category === 'borrow') s.borrow_amount += getBorrowTotals(l).remaining;
          if (l.category === 'repay') s.repay_amount += a;
        });
        if (typeof payMatchFn === 'function') {
          allJobs.forEach(j => {
            if (!Array.isArray(j.payments)) return;
            j.payments.forEach(pm => {
              if (pm && payMatchFn(pm.date || '')) {
                s.paid_amount += Math.max(0, Number(pm.amount) || 0);
              }
            });
          });
          allLedger.forEach(l => {
            if (l.category !== 'borrow' || !Array.isArray(l.repayments)) return;
            l.repayments.forEach(r => {
              if (r && payMatchFn(r.date || '')) {
                s.repay_amount += Math.max(0, Number(r.amount) || 0);
              }
            });
          });
        }
        s.net_cash = s.paid_amount - s.expense_amount;
        return s;
      };

      const dayRepayments = [];
      allLedger.forEach(l => {
        if (l.category !== 'borrow' || !Array.isArray(l.repayments)) return;
        const bt = getBorrowTotals(l);
        l.repayments.forEach(r => {
          if (r && r.date === date) {
            dayRepayments.push({
              id: r.id,
              ledger_id: l.id,
              borrow_date: l.date,
              borrow_note: l.note,
              borrow_amount: bt.orig,
              remaining_amount: bt.remaining,
              date: r.date,
              amount: Number(r.amount) || 0,
              note: r.note || '',
              ts: r.ts || 0
            });
          }
        });
      });
      dayRepayments.sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));

      const monthJobs = allJobs.filter(j => (j.date || '').startsWith(month + '-'));
      const monthLedger = allLedger.filter(l => (l.date || '').startsWith(month + '-'));

      const byCust = {};
      let totalUnpaidAll = 0;
      let totalUnpaidJobs = 0;
      allJobs.filter(j => j.status === 'CTT' || (Array.isArray(j.payments) && j.payments.length > 0)).forEach(j => {
        const dt = getDebtJobTotals(j);
        const nj = {
          ...j,
          paid_amount: dt.paid,
          remaining_amount: dt.remaining,
          payments: dt.payments
        };
        const key = (j.customer || '').trim().toLowerCase();
        if (!byCust[key]) {
          byCust[key] = {
            customer: j.customer,
            channel: j.channel || 'ZL',
            job_count: 0,
            total_job_count: 0,
            settled_count: 0,
            total_amount: 0,
            original_amount: 0,
            paid_amount: 0,
            settled: false,
            jobs: []
          };
        }
        const g = byCust[key];
        g.total_job_count++;
        g.original_amount += dt.orig;
        g.paid_amount += dt.paid;
        if (dt.remaining > 0) {
          g.job_count++;
          g.total_amount += dt.remaining;
          totalUnpaidAll += dt.remaining;
          totalUnpaidJobs++;
        } else {
          g.settled_count++;
        }
        g.jobs.push(nj);
      });

      const debtGroups = Object.values(byCust).map(g => {
        g.settled = g.total_amount === 0 && g.total_job_count > 0;
        g.jobs.sort((a, b) => {
          const ra = (a.remaining_amount || 0) > 0 ? 0 : 1;
          const rb = (b.remaining_amount || 0) > 0 ? 0 : 1;
          if (ra !== rb) return ra - rb;
          if (a.date !== b.date) return a.date < b.date ? 1 : -1;
          return (Number(b.id) || 0) - (Number(a.id) || 0);
        });
        return g;
      }).sort((a, b) => {
        if (a.settled !== b.settled) return a.settled ? 1 : -1;
        if (b.total_amount !== a.total_amount) return b.total_amount - a.total_amount;
        return b.original_amount - a.original_amount;
      });
      const unpaidGroups = debtGroups.filter(g => g.total_amount > 0);

      const byDate = {};
      const ensureDateBrief = d => {
        if (!byDate[d]) {
          byDate[d] = { date: d, job_count: 0, total_revenue: 0, paid_amount: 0, unpaid_amount: 0, expense_amount: 0 };
        }
        return byDate[d];
      };
      monthJobs.forEach(j => {
        const row = ensureDateBrief(j.date);
        const dt = getDebtJobTotals(j);
        row.job_count++;
        row.total_revenue += dt.orig;
        if (dt.payments.length > 0) {
          row.unpaid_amount += dt.remaining;
        } else if (j.status === 'CTT') {
          row.unpaid_amount += dt.orig;
        } else {
          row.paid_amount += dt.orig;
        }
      });
      allJobs.forEach(j => {
        if (!Array.isArray(j.payments)) return;
        j.payments.forEach(pm => {
          if (pm && (pm.date || '').startsWith(month + '-')) {
            ensureDateBrief(pm.date).paid_amount += Math.max(0, Number(pm.amount) || 0);
          }
        });
      });
      monthLedger.filter(l => l.category === 'expense').forEach(l => {
        ensureDateBrief(l.date).expense_amount += Number(l.amount) || 0;
      });

      workState.date = date;
      workState.month = month;
      workState.calendarMonth = month;
      workState.today = state.today || date;
      workState.jobs = dayJobs.map(j => {
        const dt = getDebtJobTotals(j);
        return { ...j, paid_amount: dt.paid, remaining_amount: dt.remaining, payments: dt.payments };
      });
      workState.ledger = dayLedger;
      workState.allBorrows = allLedger.filter(l => l && l.category === 'borrow');
      workState.dayRepayments = dayRepayments;
      workState.daySummary = calcSum(dayJobs, dayLedger, d => d === date);
      workState.monthSummary = calcSum(monthJobs, monthLedger, d => d.startsWith(month + '-'));
      workState.debtGroups = debtGroups;
      workState.unpaidGroups = unpaidGroups;
      workState.totalUnpaidAll = totalUnpaidAll;
      workState.totalUnpaidJobs = totalUnpaidJobs;
      workState.recentDays = Object.values(byDate).sort((a, b) => (a.date < b.date ? 1 : -1));
      renderFinanceVaultStatus(v);
      renderWorkScreen();
    }

    window.exportFinanceVaultFile = function () {
      const v = readFinanceVaultSync();
      const dateStr = workState.today || state.today || new Date().toISOString().slice(0, 10);
      const blob = new Blob([JSON.stringify(v, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `so-tai-chinh-quyen-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 200);
      showToast(`Đã lưu file tài chính (${(v.jobs || []).length} đơn, ${(v.ledger || []).length} thu chi) về máy cá nhân`);
    };

    window.importFinanceVaultFile = async function (e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const jobs = Array.isArray(parsed.jobs)
          ? parsed.jobs
          : (Array.isArray(parsed.work_jobs) ? parsed.work_jobs : null);
        const ledger = Array.isArray(parsed.ledger)
          ? parsed.ledger
          : (Array.isArray(parsed.work_ledger) ? parsed.work_ledger : []);

        if (!jobs) {
          throw new Error('File không chứa dữ liệu Sổ công việc hợp lệ');
        }
        if (!confirm(`Khôi phục ${jobs.length} đơn dịch vụ và ${ledger.length} khoản thu chi từ file vào máy cá nhân & server?`)) {
          e.target.value = '';
          return;
        }

        const tombstones = Array.isArray(parsed.tombstones) ? parsed.tombstones : [];
        const synced = await api('/api/work/vault', {
          method: 'POST',
          body: JSON.stringify({
            mode: 'replace',
            jobs,
            ledger,
            tombstones
          })
        });

        clearPendingSyncQueue('work');
        if (synced && typeof synced.work_rev === 'number') {
          syncState.workRev = Math.max(syncState.workRev, synced.work_rev);
        }
        saveFinanceVaultToDevice({
          db_id: synced.db_id || '',
          dirty: false,
          jobs: synced.jobs || jobs,
          ledger: synced.ledger || ledger,
          tombstones: Array.isArray(synced.tombstones) ? synced.tombstones : tombstones
        });

        showToast(`Đã nạp thành công ${jobs.length} đơn & ${ledger.length} khoản thu chi!`);
        await loadWorkData(workState.date);
      } catch (err) {
        showToast('Lỗi nạp file: ' + (err.message || 'File không hợp lệ'), true);
      }
      e.target.value = '';
    };

    window.syncLocalFileToCloud = async function (e) {
      const input = e && e.target;
      const file = input && input.files && input.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('File không đúng định dạng JSON của Quyền Anh');
        }

        const isFullBackup =
          Array.isArray(parsed.water) ||
          Array.isArray(parsed.weight) ||
          Array.isArray(parsed.med) ||
          Array.isArray(parsed.meals) ||
          (parsed.settings && typeof parsed.settings === 'object' && !Array.isArray(parsed.settings));

        if (isFullBackup) {
          const jobsCount = Array.isArray(parsed.work_jobs)
            ? parsed.work_jobs.length
            : (Array.isArray(parsed.jobs) ? parsed.jobs.length : 0);
          const ledgerCount = Array.isArray(parsed.work_ledger)
            ? parsed.work_ledger.length
            : (Array.isArray(parsed.ledger) ? parsed.ledger.length : 0);
          if (!confirm(`Tải file sao lưu "${file.name}" (${jobsCount} đơn, ${ledgerCount} thu chi & dữ liệu sức khoẻ) lên để đồng bộ với Cloud?`)) {
            return;
          }
          await api('/api/restore', {
            method: 'POST',
            body: JSON.stringify(parsed)
          });
          const restoredJobs = Array.isArray(parsed.work_jobs)
            ? parsed.work_jobs
            : (Array.isArray(parsed.jobs) ? parsed.jobs : []);
          const restoredLedger = Array.isArray(parsed.work_ledger)
            ? parsed.work_ledger
            : (Array.isArray(parsed.ledger) ? parsed.ledger : []);
          saveFinanceVaultToDevice({
            dirty: false,
            jobs: restoredJobs,
            ledger: restoredLedger
          });
          renderFinanceVaultStatus();
          showToast(`Đã tải "${file.name}" lên và đồng bộ hoàn tất với Cloud!`);
          await loadToday();
          await loadWorkData(workState.date);
          return;
        }

        const hasJobs = Array.isArray(parsed.jobs) || Array.isArray(parsed.work_jobs);
        const hasLedger = Array.isArray(parsed.ledger) || Array.isArray(parsed.work_ledger);
        const jobs = Array.isArray(parsed.jobs)
          ? parsed.jobs
          : (Array.isArray(parsed.work_jobs) ? parsed.work_jobs : []);
        const ledger = Array.isArray(parsed.ledger)
          ? parsed.ledger
          : (Array.isArray(parsed.work_ledger) ? parsed.work_ledger : []);

        if (!hasJobs && !hasLedger) {
          throw new Error('File không chứa dữ liệu sao lưu hoặc Sổ công việc hợp lệ');
        }
        if (!confirm(`Tải ${jobs.length} đơn dịch vụ và ${ledger.length} khoản thu chi từ "${file.name}" lên để đồng bộ (gộp không trùng) với Cloud?`)) {
          return;
        }

        const tombstones = Array.isArray(parsed.tombstones) ? parsed.tombstones : [];
        const synced = await api('/api/work/vault', {
          method: 'POST',
          body: JSON.stringify({
            mode: 'merge',
            jobs,
            ledger,
            tombstones
          })
        });

        const nextJobs = Array.isArray(synced.jobs) ? synced.jobs : jobs;
        const nextLedger = Array.isArray(synced.ledger) ? synced.ledger : ledger;
        if (synced && typeof synced.work_rev === 'number') {
          syncState.workRev = Math.max(syncState.workRev, synced.work_rev);
        }
        saveFinanceVaultToDevice({
          db_id: synced.db_id || '',
          dirty: false,
          jobs: nextJobs,
          ledger: nextLedger,
          tombstones: Array.isArray(synced.tombstones) ? synced.tombstones : tombstones
        });
        renderFinanceVaultStatus();
        showToast(`Đã đồng bộ file lên Cloud: hiện có ${nextJobs.length} đơn & ${nextLedger.length} khoản thu chi!`);
        await loadWorkData(workState.date);
      } catch (err) {
        showToast('Lỗi đồng bộ file lên Cloud: ' + (err.message || 'File không hợp lệ'), true);
      } finally {
        if (input) input.value = '';
      }
    };

    window.linkOrSyncLocalFinance = async function () {
      if ('showSaveFilePicker' in window) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: 'so-tai-chinh-quyen.json',
            types: [{
              description: 'Dữ liệu Sổ Tài Chính Quyền (JSON)',
              accept: { 'application/json': ['.json'] }
            }]
          });
          linkedFinanceFileHandle = handle;
          await idbSet('file_handle', handle);
          const v = readFinanceVaultSync();
          await writeToLinkedDiskFile(v);
          renderFinanceVaultStatus(v);
          showToast('Đã gắn file trên ổ cứng! Mọi thay đổi tài chính sẽ tự động ghi trực tiếp vào file này.');
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return;
        }
      }

      await checkRemoteSyncState({ silent: false, force: true, forceHealth: true, forceWork: true });
      const v = readFinanceVaultSync();
      const pending = readSyncQueueSync().length;
      if (pending > 0) {
        showToast(`Chưa thể kết nối máy chủ — còn ${pending} thay đổi chờ đồng bộ`, true);
      } else {
        showToast(`Đã đồng bộ đa thiết bị (${(v.jobs || []).length} đơn, ${(v.ledger || []).length} thu chi)`);
      }
    };

    async function loadWorkData(targetDate, opts = {}) {
      const reqSeq = ++workLoadSeq;
      await hydrateSyncQueueFromIDB();
      await hydrateVaultFromIDB();
      await flushPendingSyncQueues({ silent: true });
      if (reqSeq !== workLoadSeq) return;
      const dateParam = targetDate || workState.date || state.today || '';
      const explicitMonth = opts && typeof opts.month === 'string' && /^\d{4}-\d{2}$/.test(opts.month)
        ? opts.month
        : '';
      const monthParam = explicitMonth
        || (targetDate ? targetDate.slice(0, 7) : (workState.calendarMonth || (dateParam ? dateParam.slice(0, 7) : '')));
      const qs = dateParam ? `?date=${encodeURIComponent(dateParam)}&month=${encodeURIComponent(monthParam)}` : '';
      try {
        let data = await api('/api/work' + qs, { silent: Boolean(opts.silent) });
        const localVault = readFinanceVaultSync();
        const localHasData = (localVault.jobs && localVault.jobs.length > 0) || (localVault.ledger && localVault.ledger.length > 0);
        const srvJobs = data.vault_jobs || [];
        const srvLedger = data.vault_ledger || [];
        const srvEmpty = srvJobs.length === 0 && srvLedger.length === 0;
        const dbChanged = Boolean(localVault.db_id && data.db_id && localVault.db_id !== data.db_id);

        // Nếu server vừa khởi tạo DB mới sau Redeploy (hoặc còn dữ liệu cục bộ chưa hợp nhất), tự động gộp an toàn (merge + tombstones)
        if (localHasData && (srvEmpty || dbChanged || localVault.dirty)) {
          await api('/api/work/vault', {
            method: 'POST',
            silent: Boolean(opts.silent),
            body: JSON.stringify({
              mode: 'merge',
              jobs: localVault.jobs,
              ledger: localVault.ledger,
              tombstones: localVault.tombstones || []
            })
          });
          data = await api('/api/work' + qs, { silent: Boolean(opts.silent) });
          if (!opts.silent) {
            showToast('Đã tự động hợp nhất dữ liệu tài chính với máy chủ');
          }
        }

        if (data.db_id) {
          syncState.dbId = data.db_id;
        }
        if (typeof data.work_rev === 'number') {
          syncState.workRev = Math.max(syncState.workRev, data.work_rev);
        }
        saveFinanceVaultToDevice({
          db_id: data.db_id || localVault.db_id,
          dirty: false,
          jobs: data.vault_jobs || [],
          ledger: data.vault_ledger || [],
          tombstones: Array.isArray(data.tombstones) ? data.tombstones : (localVault.tombstones || [])
        });

        if (reqSeq !== workLoadSeq) return;

        if (pendingJobDeletes.size > 0 || pendingLedgerDeletes.size > 0) {
          workState.today = data.today || state.today;
          workState.suggestions = data.suggestions || workState.suggestions;
          computeWorkFromLocalVault(data.date || dateParam, data.month || monthParam);
          return;
        }

        workState.date = data.date || state.today;
        workState.month = data.month || workState.date.slice(0, 7);
        workState.calendarMonth = workState.month;
        workState.today = data.today || state.today;
        workState.jobs = data.jobs || [];
        workState.ledger = data.ledger || [];
        workState.allBorrows = (data.vault_ledger || []).filter(l => l && l.category === 'borrow');
        workState.dayRepayments = data.day_repayments || [];
        workState.daySummary = data.day_summary || {};
        workState.monthSummary = data.month_summary || {};
        workState.unpaidGroups = data.unpaid_groups || [];
        workState.debtGroups = Array.isArray(data.debt_groups) ? data.debt_groups : (data.unpaid_groups || []);
        workState.totalUnpaidAll = data.total_unpaid_all || 0;
        workState.totalUnpaidJobs = data.total_unpaid_jobs || 0;
        workState.recentDays = data.recent_days || [];
        workState.suggestions = data.suggestions || { customers: [], services: [] };

        renderWorkScreen();
      } catch (e) {
        if (reqSeq !== workLoadSeq) return;
        // Nếu server đang khởi động lại trong lúc Redeploy, hiển thị trực tiếp từ bộ nhớ máy cá nhân
        computeWorkFromLocalVault(dateParam, monthParam);
      }
    }

    function renderWorkScreen() {
      // 1. Nút quay về hôm nay trên bảng lịch
      const calMonth = workState.calendarMonth || workState.month || '';
      updateTodayChipButton('btn-work-today', calMonth);

      // 2. Summary Hero Card (Hỗ trợ chuyển nhanh Theo ngày / Cả tháng)
      const ds = workState.daySummary || {};
      const ms = workState.monthSummary || {};
      const isMonthScope = workState.heroScope === 'month';
      const activeSum = isMonthScope ? ms : ds;
      const setTxt = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };

      const btnScopeDay = document.getElementById('btn-hero-scope-day');
      const btnScopeMonth = document.getElementById('btn-hero-scope-month');
      if (btnScopeDay) btnScopeDay.classList.toggle('active', !isMonthScope);
      if (btnScopeMonth) btnScopeMonth.classList.toggle('active', isMonthScope);

      let monthHuman = workState.month || '';
      if (workState.month) {
        const mParts = workState.month.split('-');
        monthHuman = `Tháng ${parseInt(mParts[1], 10)}/${mParts[0]}`;
      }

      const revFormatted = formatVND(activeSum.total_revenue || 0);
      if (isMonthScope) {
        setTxt('work-summary-date-label', `Tổng doanh thu ${monthHuman}`);
      } else {
        setTxt('work-summary-date-label', workState.date === workState.today ? 'Tổng doanh thu hôm nay' : `Doanh thu ngày ${formatVNDate(workState.date)}`);
      }
      setTxt('work-day-revenue', revFormatted);
      const revEl = document.getElementById('work-day-revenue');
      if (revEl) {
        revEl.classList.toggle('is-long', revFormatted.length >= 12);
      }
      setTxt('work-day-job-count', `${activeSum.total_jobs || 0} đơn`);
      setTxt('work-day-paid', formatShortK(activeSum.paid_amount || 0));
      setTxt('work-day-unpaid', formatShortK(activeSum.unpaid_amount || 0));

      // Subtab badges
      setTxt('work-badge-day-jobs', String(workState.jobs.length));
      setTxt('work-badge-unpaid-all', String(workState.totalUnpaidJobs || 0));

      renderWorkSuggestions();
      renderWorkCalendar();
      renderWorkJobsList();
      renderWorkUnpaidGroups();
      renderLedgerScreen();
      if (typeof renderFundsScreen === 'function') {
        renderFundsScreen();
      }
    }

    window.setWorkHeroScope = function (scope) {
      workState.heroScope = scope === 'month' ? 'month' : 'day';
      renderWorkScreen();
    };

    window.setLedgerHeroScope = function (scope) {
      workState.ledgerScope = scope === 'month' ? 'month' : 'day';
      renderLedgerScreen();
    };

    window.jumpWorkToday = function () {
      const today = workState.today || state.today;
      if (!today) return;
      const todayMonth = today.slice(0, 7);
      const scope = state.activeTab === 'ledger' ? 'ledger' : 'work';
      workState.heroScope = 'day';
      workState.ledgerScope = 'day';
      workState.calendarMonth = todayMonth;
      if (scope === 'work' && workState.subTab !== 'jobs') {
        switchWorkSubTab('jobs');
      }
      syncAndRenderWorkTarget(today, todayMonth);
      announceCalendarDay(today, scope);
    };

    window.switchWorkSubTab = function (sub) {
      if (sub === 'ledger') {
        switchTab('ledger');
        return;
      }
      if (sub !== 'jobs' && sub !== 'unpaid') sub = 'jobs';
      workState.subTab = sub;
      ['jobs', 'unpaid'].forEach(k => {
        const btn = document.getElementById('work-subtab-btn-' + k);
        const pane = document.getElementById('work-subpane-' + k);
        if (btn) {
          const active = k === sub;
          btn.classList.toggle('active', active);
          btn.setAttribute('aria-selected', active ? 'true' : 'false');
        }
        if (pane) {
          pane.classList.toggle('active', k === sub);
        }
      });
    };

    function renderWorkSuggestions() {
      const custContainer = document.getElementById('work-customer-chips');
      if (custContainer) {
        const custs = (workState.suggestions && workState.suggestions.customers) || [];
        custContainer.innerHTML = custs.map(c => {
          const safe = escapeHTML(c);
          return `<button type="button" class="work-suggest-chip" data-cust="${safe}" onclick="pickWorkCustomer(this.getAttribute('data-cust'))">${safe}</button>`;
        }).join('');
      }

      const svcContainer = document.getElementById('work-service-chips');
      if (svcContainer) {
        const svcs = (workState.suggestions && workState.suggestions.services) || [];
        svcContainer.innerHTML = svcs.map(item => {
          const safeSvc = escapeHTML(item.service);
          return `<button type="button" class="work-suggest-chip" data-svc="${safeSvc}" onclick="pickWorkService(this.getAttribute('data-svc'))">${safeSvc.trim()}</button>`;
        }).join('');
      }
    }

    window.pickWorkCustomer = function (name) {
      const input = document.getElementById('work-job-customer');
      if (input) {
        input.value = name;
        const svcInput = document.getElementById('work-job-service');
        if (svcInput && !svcInput.value) {
          svcInput.focus();
        }
      }
    };

    window.pickWorkService = function (svcName) {
      const input = document.getElementById('work-job-service');
      if (input) {
        input.value = svcName;
        input.focus();
        try {
          input.setSelectionRange(svcName.length, svcName.length);
        } catch (e) { }
      }
    };

    window.setWorkJobChannel = function (ch) {
      const hidden = document.getElementById('work-job-channel');
      if (hidden) hidden.value = ch;
      const btnZl = document.getElementById('btn-ch-zl');
      const btnFb = document.getElementById('btn-ch-fb');
      if (btnZl) btnZl.classList.toggle('active', ch === 'ZL');
      if (btnFb) btnFb.classList.toggle('active', ch === 'FB');
    };

    window.setWorkJobStatus = function (st) {
      const hidden = document.getElementById('work-job-status');
      if (hidden) hidden.value = st;
      const btnTt = document.getElementById('btn-st-tt');
      const btnCtt = document.getElementById('btn-st-ctt');
      if (btnTt) btnTt.classList.toggle('active-tt', st === 'TT');
      if (btnCtt) btnCtt.classList.toggle('active-ctt', st === 'CTT');
    };

    window.updateWorkPricePreview = function (rawVal) {
      const preview = document.getElementById('work-job-price-preview');
      if (!preview) return;
      const vnd = parseMoneyInputVND(rawVal);
      preview.textContent = vnd > 0 ? ('= ' + formatVND(vnd)) : '';
    };

    window.openAddWorkJobModal = function () {
      renderWorkSuggestions();
      openModal('modal-add-work-job');
      setTimeout(() => {
        const custInp = document.getElementById('work-job-customer');
        if (custInp && !custInp.value) custInp.focus();
      }, 80);
    };

    window.submitWorkJob = async function (e) {
      e.preventDefault();
      const customer = document.getElementById('work-job-customer').value.trim();
      const service = document.getElementById('work-job-service').value.trim();
      const priceInput = document.getElementById('work-job-price');
      const price = parseMoneyInputVND(priceInput ? priceInput.value : '');
      const channel = document.getElementById('work-job-channel').value || 'ZL';
      const status = document.getElementById('work-job-status').value || 'TT';

      if (!customer || !service) {
        showToast('Nhập đầy đủ tên khách, dịch vụ và giá tiền', true);
        return;
      }
      if (!price || price < 1000 || price > 200000000) {
        showToast('Giá tiền phải từ 1.000đ đến 200.000.000đ (nhập 1 – 200.000)', true);
        if (priceInput) priceInput.focus();
        return;
      }
      const jobDate = workState.date || state.today || new Date().toISOString().slice(0, 10);
      const clientUid = genClientUID('job');
      const nowTs = Math.floor(Date.now() / 1000);
      const bodyPayload = {
        uid: clientUid,
        date: jobDate,
        customer,
        channel,
        service,
        price,
        status,
        note: '',
        ts: nowTs
      };
      try {
        const res = await api('/api/work/job', {
          method: 'POST',
          deferQueueToast: true,
          body: JSON.stringify(bodyPayload)
        });
        if (res && typeof res.work_rev === 'number') {
          syncState.workRev = Math.max(syncState.workRev, res.work_rev);
        }
        document.getElementById('work-job-service').value = '';
        document.getElementById('work-job-price').value = '';
        updateWorkPricePreview('');
        closeModal('modal-add-work-job');
        showToast(`Đã lưu đơn ${customer} (${formatShortK(price)} - ${status})`);
        workState.calendarMonth = jobDate.slice(0, 7);
        await loadWorkData(jobDate, { month: workState.calendarMonth });
      } catch (err) {
        if (!isQueueableSyncError(err)) return;
        const v = readFinanceVaultSync();
        v.jobs.push({
          id: Date.now(),
          uid: clientUid,
          date: jobDate,
          customer,
          channel,
          service,
          price,
          status,
          note: '',
          ts: nowTs,
          updated_at: nowTs
        });
        saveFinanceVaultToDevice(v);
        enqueueSyncOp({
          domain: 'work',
          op: 'work_job_add',
          payload: bodyPayload
        });
        document.getElementById('work-job-service').value = '';
        document.getElementById('work-job-price').value = '';
        updateWorkPricePreview('');
        closeModal('modal-add-work-job');
        showToast(`Đã lưu đơn ${customer} vào máy này (sẽ tự đồng bộ lên Cloud)`);
        workState.calendarMonth = jobDate.slice(0, 7);
        computeWorkFromLocalVault(jobDate, workState.calendarMonth);
      }
    };

    const pendingJobDeletes = new Map();
    const pendingLedgerDeletes = new Map();
    let activeJobSwipeCloser = null;

    function isJobPendingDelete(j) {
      if (!j || pendingJobDeletes.size === 0) return false;
      for (const entry of pendingJobDeletes.values()) {
        if (entry.uid && j.uid && entry.uid === j.uid) return true;
        if (entry.id && Number(j.id) === Number(entry.id)) return true;
      }
      return false;
    }

    function isLedgerPendingDelete(l) {
      if (!l || pendingLedgerDeletes.size === 0) return false;
      for (const entry of pendingLedgerDeletes.values()) {
        if (entry.uid && l.uid && entry.uid === l.uid) return true;
        if (entry.id && Number(l.id) === Number(entry.id)) return true;
      }
      return false;
    }

    function isFundLedgerItem(l) {
      return Boolean(l && (l.category === 'fund_in' || l.category === 'fund_bal'));
    }

    window.closeActiveJobSwipeRow = function () {
      if (typeof activeJobSwipeCloser === 'function') {
        activeJobSwipeCloser();
      }
    };

    function renderWorkJobsList() {
      const container = document.getElementById('work-jobs-list');
      const titleEl = document.getElementById('work-day-jobs-title');
      const subEl = document.getElementById('work-day-jobs-sub');
      const jobs = workState.jobs || [];
      const dm = formatDayMonth(workState.date);

      if (titleEl) {
        titleEl.textContent = workState.date === workState.today
          ? 'Danh sách đơn hôm nay'
          : (dm ? `Danh sách đơn ngày ${dm}` : 'Danh sách đơn trong ngày');
      }
      if (subEl) {
        subEl.textContent = `${jobs.length} đơn`;
      }
      if (!container) return;

      closeActiveJobSwipeRow();

      if (jobs.length === 0) {
        container.innerHTML = `<div class="empty-state-box">Chưa có đơn dịch vụ nào trong ngày ${formatVNDate(workState.date)}.</div>`;
        return;
      }

      container.innerHTML = jobs.map((j, idx) => {
        const dt = getDebtJobTotals(j);
        const isCTT = j.status === 'CTT';
        const chClass = j.channel === 'FB' ? 'ch-fb' : 'ch-zl';
        const stClass = isCTT ? 'st-ctt' : 'st-tt';
        const stLabel = isCTT
          ? `${workIconSVG('clock', 13)} <span>${dt.paid > 0 ? `Còn nợ ${formatShortK(dt.remaining)} • Trả tiếp` : 'Nợ (CTT) • Bấm để thu'}</span>`
          : `${workIconSVG('check', 13)} <span>Đã thu (TT)</span>`;
        const partialSub = dt.paid > 0 && isCTT
          ? ` &bull; Đã trả ${formatShortK(dt.paid)}/${formatShortK(dt.orig)}`
          : '';
        const payCueText = dt.paid > 0
          ? `Thu tiếp (${formatShortK(dt.remaining)})`
          : `Thu nhanh (${formatShortK(dt.remaining)})`;

        return `
        <div class="job-swipe-row" data-no-tab-swipe="1" data-job-id="${j.id}" data-job-status="${isCTT ? 'CTT' : 'TT'}" data-job-partial="${dt.paid > 0 ? '1' : '0'}">
          <div class="job-swipe-rail">
            ${isCTT ? `<div class="job-swipe-underlay job-swipe-underlay-pay" aria-hidden="true"><span class="job-swipe-cue">${workIconSVG('check', 16)} <span>${payCueText}</span></span></div>` : ''}
            <div class="job-swipe-underlay job-swipe-underlay-actions" aria-hidden="true" inert>
              <button type="button" class="job-swipe-action-btn is-edit" tabindex="-1" onclick="closeActiveJobSwipeRow(); openEditWorkJobModal(${j.id})" aria-label="Sửa đơn ${escapeHTML(j.customer)}">
                <svg class="ui-inline-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                <span>Sửa</span>
              </button>
              <button type="button" class="job-swipe-action-btn is-delete" tabindex="-1" onclick="closeActiveJobSwipeRow(); deleteWorkJobWithUndo(${j.id})" aria-label="Xoá đơn ${escapeHTML(j.customer)}">
                <svg class="ui-inline-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                <span>Xoá</span>
              </button>
            </div>
          </div>
          <div class="work-job-card ${isCTT ? 'is-unpaid' : ''} job-swipe-surface">
            <div class="work-job-top">
              <div class="work-job-cust-wrap">
                <span class="work-stt-badge font-tabular">#${idx + 1}</span>
                <span class="work-ch-badge ${chClass}">${escapeHTML(j.channel)}</span>
                <span class="work-job-cust-name">${escapeHTML(j.customer)}</span>
              </div>
              <span class="work-job-price-val font-tabular">${formatVND(j.price)}</span>
            </div>
            <div class="work-job-bottom">
              <div style="width: 100%; min-width: 0;">
                <span class="work-job-service-name">${escapeHTML(j.service)}</span>
                <div class="font-tabular" style="font-size: 11.5px; color: var(--text-sub); margin-top: 2px;">${escapeHTML(formatDayMonthTime(j.date || workState.date, j.ts))}${partialSub}</div>
              </div>
              <div class="work-job-actions">
                <button type="button" class="btn-status-toggle ${stClass}" onclick="${isCTT && dt.paid > 0 ? `openDebtJobPayModal(${j.id})` : `toggleWorkJobStatus(${j.id}, '${isCTT ? 'TT' : 'CTT'}')`}" aria-label="${isCTT && dt.paid > 0 ? 'Trả tiền đơn' : 'Đổi trạng thái thanh toán đơn'} ${escapeHTML(j.customer)}">
                  ${stLabel}
                </button>
                <button type="button" class="btn-job-icon" onclick="openEditWorkJobModal(${j.id})" aria-label="Sửa đơn ${escapeHTML(j.customer)}">Sửa</button>
                <button type="button" class="btn-job-icon btn-del" onclick="deleteWorkJobWithUndo(${j.id})" aria-label="Xoá đơn ${escapeHTML(j.customer)}">Xoá</button>
              </div>
            </div>
          </div>
        </div>
      `;
      }).join('');
    }

    window.toggleWorkJobStatus = async function (jobId, nextStatus, opts = {}) {
      const existing = findDebtJobById(jobId);
      const jobUid = existing && existing.uid ? existing.uid : '';
      const payload = { uid: jobUid || undefined, status: nextStatus };
      const qs = jobUid ? `?uid=${encodeURIComponent(jobUid)}` : '';
      const undoablePay = Boolean(opts && opts.undoable && nextStatus === 'TT');
      const custName = (opts && opts.customer) || (existing && existing.customer) || 'khách';
      const paidAmt = Number((opts && opts.amount) || (existing && existing.price) || 0);

      try {
        const res = await api('/api/work/job/' + jobId + qs, {
          method: 'PUT',
          deferQueueToast: true,
          body: JSON.stringify(payload)
        });
        if (res && typeof res.work_rev === 'number') {
          syncState.workRev = Math.max(syncState.workRev, res.work_rev);
        }
        if (undoablePay) {
          showToast(`Đã thu ${formatShortK(paidAmt)} • ${custName}`, {
            actionLabel: 'Hoàn tác',
            duration: 6500,
            onAction: () => window.toggleWorkJobStatus(jobId, 'CTT')
          });
        } else {
          showToast(nextStatus === 'TT' ? 'Đã chuyển sang Đã thu tiền (TT)' : 'Đã chuyển sang Khách nợ (CTT)');
        }
        await loadWorkData(workState.date);
      } catch (e) {
        if (!isQueueableSyncError(e)) return;
        updateJobInLocalVault(jobId, jobUid, { status: nextStatus });
        enqueueSyncOp({
          domain: 'work',
          op: 'work_job_put',
          target_id: Number(jobId) || 0,
          target_uid: jobUid,
          payload
        });
        if (undoablePay) {
          showToast(`Đã thu ${formatShortK(paidAmt)} • ${custName} • chờ đồng bộ`, {
            actionLabel: 'Hoàn tác',
            duration: 6500,
            onAction: () => window.toggleWorkJobStatus(jobId, 'CTT')
          });
        } else {
          showToast(nextStatus === 'TT' ? 'Đã đánh dấu Đã thu (TT) • chờ đồng bộ' : 'Đã đánh dấu Khách nợ (CTT) • chờ đồng bộ');
        }
        computeWorkFromLocalVault(workState.date);
      }
    };

    window.quickCollectWorkJob = function (jobId) {
      const job = findDebtJobById(jobId);
      if (!job || job.status !== 'CTT') return;
      const dt = getDebtJobTotals(job);
      if (dt.paid > 0) {
        window.openDebtJobPayModal(jobId);
        return;
      }
      window.toggleWorkJobStatus(jobId, 'TT', {
        undoable: true,
        customer: job.customer,
        amount: job.price
      });
    };

    async function commitPendingJobDelete(key, opts = {}) {
      const entry = pendingJobDeletes.get(key);
      if (!entry || entry.committed) return;
      entry.committed = true;
      pendingJobDeletes.delete(key);
      if (entry.toastHandle && typeof entry.toastHandle.dismiss === 'function') {
        entry.toastHandle.dismiss('commit');
      }

      removeJobFromLocalVault(entry.id, { dirty: false, tombstone: true });
      const qs = `?uid=${encodeURIComponent(entry.uid)}&sig=${encodeURIComponent(entry.sig)}`;
      const isKeepalive = Boolean(opts && opts.keepalive);
      try {
        const res = await api('/api/work/job/' + entry.id + qs, {
          method: 'DELETE',
          deferQueueToast: true,
          silent: isKeepalive,
          keepalive: isKeepalive
        });
        if (res && typeof res.work_rev === 'number') {
          syncState.workRev = Math.max(syncState.workRev, res.work_rev);
        }
        if (!isKeepalive && pendingJobDeletes.size === 0 && state.activeTab === 'work') {
          await loadWorkData(workState.date, { silent: true });
        }
      } catch (err) {
        if (!isQueueableSyncError(err)) return;
        enqueueSyncOp({
          domain: 'work',
          op: 'work_job_del',
          target_id: entry.id,
          target_uid: entry.uid,
          sig: entry.sig
        });
        if (!isKeepalive) {
          computeWorkFromLocalVault(workState.date, workState.calendarMonth);
        }
      }
    }

    function undoPendingJobDelete(key) {
      const entry = pendingJobDeletes.get(key);
      if (!entry || entry.committed) return;
      entry.committed = true;
      pendingJobDeletes.delete(key);
      computeWorkFromLocalVault(workState.date, workState.calendarMonth);
      showToast(`Đã hoàn tác đơn của ${entry.customer}`);
    }

    window.deleteWorkJobWithUndo = function (jobId) {
      const job = findDebtJobById(jobId);
      if (!job) return;
      const key = job.uid || ('id:' + job.id);
      if (pendingJobDeletes.has(key)) return;

      closeActiveJobSwipeRow();
      const entry = {
        key,
        id: Number(job.id) || 0,
        uid: job.uid || '',
        sig: computeWorkJobSig(job),
        customer: job.customer || 'khách',
        committed: false,
        toastHandle: null
      };
      pendingJobDeletes.set(key, entry);
      computeWorkFromLocalVault(workState.date, workState.calendarMonth);

      entry.toastHandle = showToast(`Đã xoá đơn ${entry.customer} (${formatShortK(job.price)})`, {
        actionLabel: 'Hoàn tác',
        duration: 6500,
        onAction: () => undoPendingJobDelete(key),
        onDismiss: (reason) => {
          if (reason !== 'action') {
            commitPendingJobDelete(key);
          }
        }
      });
    };

    async function commitPendingLedgerDelete(key, opts = {}) {
      const entry = pendingLedgerDeletes.get(key);
      if (!entry || entry.committed) return;
      entry.committed = true;
      pendingLedgerDeletes.delete(key);
      if (entry.toastHandle && typeof entry.toastHandle.dismiss === 'function') {
        entry.toastHandle.dismiss('commit');
      }

      removeLedgerFromLocalVault(entry.id, { dirty: false, tombstone: true });
      const qs = `?uid=${encodeURIComponent(entry.uid)}&sig=${encodeURIComponent(entry.sig)}`;
      const isKeepalive = Boolean(opts && opts.keepalive);
      try {
        const res = await api('/api/work/ledger/' + entry.id + qs, {
          method: 'DELETE',
          deferQueueToast: true,
          silent: isKeepalive,
          keepalive: isKeepalive
        });
        if (res && typeof res.work_rev === 'number') {
          syncState.workRev = Math.max(syncState.workRev, res.work_rev);
        }
        if (!isKeepalive && pendingLedgerDeletes.size === 0 &&
          (state.activeTab === 'work' || state.activeTab === 'ledger' || state.activeTab === 'funds')) {
          await loadWorkData(workState.date, { silent: true });
        }
      } catch (err) {
        if (!isQueueableSyncError(err)) return;
        enqueueSyncOp({
          domain: 'work',
          op: 'work_ledger_del',
          target_id: entry.id,
          target_uid: entry.uid,
          sig: entry.sig
        });
        if (!isKeepalive) {
          computeWorkFromLocalVault(workState.date, workState.calendarMonth);
        }
      }
    }

    function undoPendingLedgerDelete(key) {
      const entry = pendingLedgerDeletes.get(key);
      if (!entry || entry.committed) return;
      entry.committed = true;
      pendingLedgerDeletes.delete(key);
      computeWorkFromLocalVault(workState.date, workState.calendarMonth);
      showToast('Đã hoàn tác lần nạp quỹ');
    }

    window.deleteFundDepositWithUndo = function (ledgerId) {
      const item = findLedgerItemById(ledgerId);
      if (!item) return;
      const key = item.uid || ('id:' + item.id);
      if (pendingLedgerDeletes.has(key)) return;

      const entry = {
        key,
        id: Number(item.id) || 0,
        uid: item.uid || '',
        sig: computeWorkLedgerSig(item),
        committed: false,
        toastHandle: null
      };
      pendingLedgerDeletes.set(key, entry);
      computeWorkFromLocalVault(workState.date, workState.calendarMonth);

      entry.toastHandle = showToast(`Đã xoá lần nạp ${formatShortK(item.amount)}`, {
        actionLabel: 'Hoàn tác',
        duration: 6500,
        onAction: () => undoPendingLedgerDelete(key),
        onDismiss: (reason) => {
          if (reason !== 'action') {
            commitPendingLedgerDelete(key);
          }
        }
      });
    };

    let flushPendingDeleteBound = false;
    function flushAllPendingJobDeletes() {
      if (pendingJobDeletes.size > 0) {
        Array.from(pendingJobDeletes.keys()).forEach(key => {
          commitPendingJobDelete(key, { keepalive: true });
        });
      }
      if (pendingLedgerDeletes.size > 0) {
        Array.from(pendingLedgerDeletes.keys()).forEach(key => {
          commitPendingLedgerDelete(key, { keepalive: true });
        });
      }
    }

    function bindPendingDeleteFlushListeners() {
      if (flushPendingDeleteBound) return;
      flushPendingDeleteBound = true;
      window.addEventListener('pagehide', flushAllPendingJobDeletes);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          flushAllPendingJobDeletes();
        }
      });
    }

    function setupWorkJobSwipeGestures() {
      const listEl = document.getElementById('work-jobs-list');
      if (!listEl || listEl.dataset.swipeBound) return;
      listEl.dataset.swipeBound = '1';

      const EDGE_ZONE_PX = 36;
      const ACTION_TRAY_W = 144;
      const PAY_TRIGGER_X = 76;
      const PAY_MAX_X = 112;

      const scheduleFrame = typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : (fn) => setTimeout(fn, 16);
      const cancelFrame = typeof window.cancelAnimationFrame === 'function'
        ? window.cancelAnimationFrame.bind(window)
        : clearTimeout;
      const nowMs = () => (window.performance && typeof window.performance.now === 'function')
        ? window.performance.now()
        : Date.now();

      let openRow = null;
      let drag = null;
      let rafId = 0;
      let pendingX = null;
      let suppressClickUntil = 0;

      function setActionsInert(row, isOpen) {
        const actionsEl = row.querySelector('.job-swipe-underlay-actions');
        if (!actionsEl) return;
        actionsEl.inert = !isOpen;
        actionsEl.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
        actionsEl.querySelectorAll('button').forEach(btn => {
          btn.setAttribute('tabindex', isOpen ? '0' : '-1');
        });
      }

      function clearRowTimer(row) {
        if (row && row._swipeTimer) {
          clearTimeout(row._swipeTimer);
          row._swipeTimer = null;
        }
      }

      function setRowOpen(row, open) {
        if (!row) return;
        const surface = row.querySelector('.job-swipe-surface');
        clearRowTimer(row);
        row.classList.remove('is-swiping-right', 'is-pay-armed');
        row.classList.toggle('is-actions-open', open);
        row.classList.toggle('is-swiping-left', open);
        setActionsInert(row, open);

        if (open) {
          if (openRow && openRow !== row) setRowOpen(openRow, false);
          openRow = row;
        } else if (openRow === row) {
          openRow = null;
        }

        if (surface) {
          surface.classList.remove('is-dragging');
          surface.classList.add('is-settling');
          surface.style.transform = open ? `translate3d(-${ACTION_TRAY_W}px, 0, 0)` : 'translate3d(0, 0, 0)';
          if (prefersReducedMotion()) {
            surface.classList.remove('is-settling');
            if (!open) surface.style.transform = '';
          } else {
            row._swipeTimer = setTimeout(() => {
              row._swipeTimer = null;
              surface.classList.remove('is-settling');
              if (!open) {
                surface.style.transform = '';
                row.classList.remove('is-swiping-left');
              }
            }, 250);
          }
        }
      }

      activeJobSwipeCloser = () => {
        if (openRow && openRow.isConnected) {
          setRowOpen(openRow, false);
        } else {
          openRow = null;
        }
      };

      function cancelDragFrame() {
        if (rafId) {
          cancelFrame(rafId);
          rafId = 0;
        }
        pendingX = null;
      }

      function applyDragX(x) {
        if (!drag) return;
        const { row, surface, isUnpaid } = drag;
        drag.lastAppliedX = x;
        if (surface) {
          surface.style.transform = `translate3d(${x.toFixed(1)}px, 0, 0)`;
        }
        const swipingRight = isUnpaid && x > 4;
        const swipingLeft = x < -4;
        const armed = isUnpaid && x >= PAY_TRIGGER_X;
        row.classList.toggle('is-swiping-right', swipingRight);
        row.classList.toggle('is-swiping-left', swipingLeft);
        row.classList.toggle('is-pay-armed', armed);
        if (armed && !drag.hapticFired) {
          drag.hapticFired = true;
          if (typeof navigator.vibrate === 'function') {
            try { navigator.vibrate(10); } catch (_) { }
          }
        } else if (!armed) {
          drag.hapticFired = false;
        }
      }

      function computeVelocityX(samples) {
        if (!samples || samples.length < 2) return 0;
        const last = samples[samples.length - 1];
        let first = null;
        for (let i = 0; i < samples.length; i++) {
          if (last.t - samples[i].t <= 100) {
            first = samples[i];
            break;
          }
        }
        if (!first || first === last) return 0;
        const dt = last.t - first.t;
        return dt > 0 ? (last.x - first.x) / dt : 0;
      }

      listEl.addEventListener('touchstart', (e) => {
        cancelDragFrame();
        if (!e.touches || e.touches.length !== 1) return;

        const touch = e.touches[0];
        const appView = document.getElementById('app-view');
        const rect = appView && typeof appView.getBoundingClientRect === 'function'
          ? appView.getBoundingClientRect()
          : { left: 0, right: window.innerWidth || 390 };
        const leftBoundary = Math.max(0, rect.left || 0);
        const rightBoundary = rect.right && rect.right > 0 ? rect.right : (window.innerWidth || 390);
        const viewportWidth = window.innerWidth || rightBoundary;
        if (touch.clientX - leftBoundary <= EDGE_ZONE_PX ||
          rightBoundary - touch.clientX <= EDGE_ZONE_PX ||
          touch.clientX <= EDGE_ZONE_PX ||
          touch.clientX >= viewportWidth - EDGE_ZONE_PX) {
          return;
        }

        const targetEl = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement);
        if (targetEl && targetEl.closest && targetEl.closest('.job-swipe-action-btn')) return;
        const row = targetEl && targetEl.closest ? targetEl.closest('.job-swipe-row') : null;
        if (!row) return;
        const surface = row.querySelector('.job-swipe-surface');
        if (!surface) return;

        if (openRow && openRow !== row) {
          setRowOpen(openRow, false);
        }

        clearRowTimer(row);
        drag = {
          row,
          surface,
          isUnpaid: row.dataset.jobStatus === 'CTT',
          baseX: openRow === row ? -ACTION_TRAY_W : 0,
          startX: touch.clientX,
          startY: touch.clientY,
          originX: touch.clientX,
          lastAppliedX: openRow === row ? -ACTION_TRAY_W : 0,
          axis: null,
          hapticFired: false,
          samples: [{ x: touch.clientX, t: nowMs() }]
        };
      }, { passive: true });

      listEl.addEventListener('touchmove', (e) => {
        if (!drag) return;
        if (!e.touches || e.touches.length !== 1) {
          const d = drag;
          drag = null;
          cancelDragFrame();
          setRowOpen(d.row, d.baseX < 0);
          return;
        }

        const touch = e.touches[0];
        if (drag.axis === null) {
          const dx = touch.clientX - drag.startX;
          const dy = touch.clientY - drag.startY;
          const absX = Math.abs(dx);
          const absY = Math.abs(dy);
          if (absX < 8 && absY < 8) return;

          if (absY >= absX * 0.9) {
            drag = null;
            return;
          }
          if (absX >= absY * 1.15) {
            drag.axis = 'x';
            drag.originX = touch.clientX;
            drag.samples = [{ x: touch.clientX, t: nowMs() }];
            drag.surface.classList.remove('is-settling');
            drag.surface.classList.add('is-dragging');
          } else {
            return;
          }
        }

        if (e.cancelable && typeof e.preventDefault === 'function') {
          e.preventDefault();
        }
        suppressClickUntil = Date.now() + 280;

        const t = nowMs();
        drag.samples.push({ x: touch.clientX, t });
        while (drag.samples.length > 2 && t - drag.samples[0].t > 100) {
          drag.samples.shift();
        }

        const rawX = drag.baseX + (touch.clientX - drag.originX);
        let visualX = rawX;
        if (rawX > 0) {
          if (drag.isUnpaid) {
            visualX = rawX <= PAY_MAX_X ? rawX : PAY_MAX_X + (rawX - PAY_MAX_X) * 0.2;
          } else {
            visualX = Math.min(18, rawX * 0.15);
          }
        } else if (rawX < -ACTION_TRAY_W) {
          visualX = -ACTION_TRAY_W + (rawX + ACTION_TRAY_W) * 0.22;
        }

        pendingX = visualX;
        if (!rafId) {
          rafId = scheduleFrame(() => {
            rafId = 0;
            if (pendingX === null || !drag) return;
            const val = pendingX;
            pendingX = null;
            applyDragX(val);
          });
        }
      }, { passive: false });

      function finishDrag(e, isCancel) {
        if (!drag) return;
        if (pendingX !== null && drag.axis === 'x') {
          const val = pendingX;
          cancelDragFrame();
          applyDragX(val);
        } else {
          cancelDragFrame();
        }
        const d = drag;
        drag = null;
        if (d.axis !== 'x') return;

        suppressClickUntil = Date.now() + 280;
        const touch = (e && e.changedTouches && e.changedTouches[0]) || null;
        if (touch) {
          const t = nowMs();
          d.samples.push({ x: touch.clientX, t });
          while (d.samples.length > 2 && t - d.samples[0].t > 100) {
            d.samples.shift();
          }
        }

        const vx = computeVelocityX(d.samples);
        const x = d.lastAppliedX;

        if (!isCancel && d.isUnpaid && (x >= PAY_TRIGGER_X || (vx >= 0.35 && x >= 42))) {
          setRowOpen(d.row, false);
          window.quickCollectWorkJob(Number(d.row.dataset.jobId));
          return;
        }
        if (!isCancel && (x <= -56 || (vx <= -0.3 && x <= -28))) {
          setRowOpen(d.row, true);
          return;
        }
        setRowOpen(d.row, false);
      }

      listEl.addEventListener('touchend', (e) => finishDrag(e, false), { passive: true });
      listEl.addEventListener('touchcancel', (e) => finishDrag(e, true), { passive: true });

      listEl.addEventListener('click', (e) => {
        if (Date.now() < suppressClickUntil) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (openRow && openRow.isConnected) {
          const clickedSurface = e.target && e.target.closest && e.target.closest('.job-swipe-surface');
          if (clickedSurface && openRow.contains(clickedSurface)) {
            e.preventDefault();
            e.stopPropagation();
            setRowOpen(openRow, false);
          }
        }
      }, true);

      document.addEventListener('pointerdown', (e) => {
        if (!openRow || !openRow.isConnected) return;
        if (!openRow.contains(e.target)) {
          setRowOpen(openRow, false);
        }
      }, { passive: true });
    }

    window.updateEditJobPricePreview = function (rawVal) {
      const preview = document.getElementById('edit-job-price-preview');
      if (!preview) return;
      const vnd = parseMoneyInputVND(rawVal);
      preview.textContent = vnd > 0 ? ('= ' + formatVND(vnd)) : '';
    };

    window.openEditWorkJobModal = function (jobId) {
      const job = findDebtJobById(jobId);
      if (!job) return;

      document.getElementById('edit-job-id').value = job.id;
      document.getElementById('edit-job-date').value = job.date;
      document.getElementById('edit-job-channel').value = job.channel || 'ZL';
      document.getElementById('edit-job-customer').value = job.customer;
      document.getElementById('edit-job-service').value = job.service;
      const priceInput = document.getElementById('edit-job-price');
      if (priceInput) {
        priceInput.value = formatMoneyInputVal(job.price);
        updateEditJobPricePreview(priceInput.value);
      }
      document.getElementById('edit-job-status').value = job.status || 'TT';

      openModal('modal-edit-work-job');
    };

    window.submitEditWorkJob = async function (e) {
      e.preventDefault();
      const id = document.getElementById('edit-job-id').value;
      const date = document.getElementById('edit-job-date').value;
      const channel = document.getElementById('edit-job-channel').value;
      const customer = document.getElementById('edit-job-customer').value.trim();
      const service = document.getElementById('edit-job-service').value.trim();
      const priceInput = document.getElementById('edit-job-price');
      const price = parseMoneyInputVND(priceInput ? priceInput.value : '');
      const status = document.getElementById('edit-job-status').value;

      if (!customer || !service) {
        showToast('Nhập đầy đủ tên khách hàng và dịch vụ', true);
        return;
      }
      if (!price || price < 1000 || price > 200000000) {
        showToast('Giá tiền phải từ 1.000đ đến 200.000.000đ (nhập 1 – 200.000)', true);
        if (priceInput) priceInput.focus();
        return;
      }
      const existing = findDebtJobById(id);
      const jobUid = existing && existing.uid ? existing.uid : '';
      const payload = { uid: jobUid || undefined, date, channel, customer, service, price, status };
      const qs = jobUid ? `?uid=${encodeURIComponent(jobUid)}` : '';
      try {
        const res = await api('/api/work/job/' + id + qs, {
          method: 'PUT',
          deferQueueToast: true,
          body: JSON.stringify(payload)
        });
        if (res && typeof res.work_rev === 'number') {
          syncState.workRev = Math.max(syncState.workRev, res.work_rev);
        }
        closeModal('modal-edit-work-job');
        showToast('Đã cập nhật đơn dịch vụ');
        await loadWorkData(workState.date);
      } catch (err) {
        if (!isQueueableSyncError(err)) return;
        updateJobInLocalVault(id, jobUid, { date, channel, customer, service, price, status });
        enqueueSyncOp({
          domain: 'work',
          op: 'work_job_put',
          target_id: Number(id) || 0,
          target_uid: jobUid,
          payload
        });
        closeModal('modal-edit-work-job');
        showToast('Đã cập nhật đơn trên máy này (sẽ tự đồng bộ)');
        computeWorkFromLocalVault(workState.date);
      }
    };

    window.deleteWorkJob = async function (jobId, opts = {}) {
      const confirmMsg = opts.fromDebt
        ? 'Xoá toàn bộ đơn nợ này và tất cả các lần trả tiền đã lưu? Thao tác này không thể hoàn tác.'
        : 'Xoá đơn dịch vụ này khỏi sổ công việc? Thao tác này không thể hoàn tác.';
      if (!confirm(confirmMsg)) return;
      const existing = findDebtJobById(jobId);
      const jobUid = existing && existing.uid ? existing.uid : '';
      const jobSig = computeWorkJobSig(existing);
      const qs = `?uid=${encodeURIComponent(jobUid)}&sig=${encodeURIComponent(jobSig)}`;
      try {
        const res = await api('/api/work/job/' + jobId + qs, { method: 'DELETE', deferQueueToast: true });
        if (res && typeof res.work_rev === 'number') {
          syncState.workRev = Math.max(syncState.workRev, res.work_rev);
        }
        removeJobFromLocalVault(jobId, { dirty: false, tombstone: true });
        if (opts.closePayModal) closeModal('modal-pay-debt-job');
        showToast(opts.fromDebt ? 'Đã xoá đơn nợ' : 'Đã xoá đơn dịch vụ');
        await loadWorkData(workState.date);
      } catch (err) {
        if (!isQueueableSyncError(err)) return;
        removeJobFromLocalVault(jobId, { dirty: false, tombstone: true });
        enqueueSyncOp({
          domain: 'work',
          op: 'work_job_del',
          target_id: Number(jobId) || 0,
          target_uid: jobUid,
          sig: jobSig
        });
        if (opts.closePayModal) closeModal('modal-pay-debt-job');
        showToast(opts.fromDebt ? 'Đã xoá đơn nợ trên máy này (chờ đồng bộ)' : 'Đã xoá đơn trên máy này (chờ đồng bộ)');
        computeWorkFromLocalVault(workState.date);
      }
    };

    function shiftMonthStr(monthStr, deltaMonths) {
      const base = /^\d{4}-\d{2}$/.test(monthStr || '')
        ? monthStr
        : (workState.date || workState.today || state.today || new Date().toISOString().slice(0, 10)).slice(0, 7);
      const parts = base.split('-').map(Number);
      const dt = new Date(Date.UTC(parts[0], parts[1] - 1 + deltaMonths, 1));
      return dt.toISOString().slice(0, 7);
    }

    function getWorkCalendarWeekdayName(dateStr) {
      const parts = String(dateStr || '').split('-').map(Number);
      if (parts.length !== 3) return '';
      const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
      const names = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
      return names[dt.getUTCDay()] || '';
    }

    function getResolvedCalendarMonth() {
      const fallbackDate = workState.date || workState.today || state.today || new Date().toISOString().slice(0, 10);
      return /^\d{4}-\d{2}$/.test(workState.calendarMonth || '')
        ? workState.calendarMonth
        : (/^\d{4}-\d{2}$/.test(workState.month || '') ? workState.month : fallbackDate.slice(0, 7));
    }

    function updateTodayChipButton(btnId, calMonth) {
      const todayBtn = document.getElementById(btnId);
      if (!todayBtn) return;
      const todayMonth = (workState.today || '').slice(0, 7);
      const isAtToday = Boolean(workState.today && workState.date === workState.today && calMonth === todayMonth);
      todayBtn.classList.toggle('is-at-today', isAtToday);
      todayBtn.setAttribute('aria-label', isAtToday ? 'Hôm nay — đang xem ngày hiện tại' : 'Hôm nay — chuyển về ngày hiện tại');
    }

    function buildWorkOrderDaysMap(monthStr) {
      const map = {};
      (workState.recentDays || []).forEach(d => {
        if (!d || !d.date || !d.date.startsWith(monthStr + '-')) return;
        if (Number(d.job_count) > 0) {
          map[d.date] = d;
        }
      });
      return map;
    }

    function buildLedgerActivityDaysMap(monthStr, ledgerItems) {
      const map = {};
      (ledgerItems || []).forEach(item => {
        if (!item || !item.date || item.category === 'borrow' || isFundLedgerItem(item)) return;
        if (!item.date.startsWith(monthStr + '-')) return;
        if (!map[item.date]) {
          map[item.date] = { date: item.date, count: 0, expense: 0, repay: 0 };
        }
        const row = map[item.date];
        const amt = Number(item.amount) || 0;
        row.count++;
        if (item.category === 'expense') row.expense += amt;
        if (item.category === 'repay') row.repay += amt;
      });
      return map;
    }

    function formatWorkActivityAria(brief) {
      return `có ${brief.job_count} đơn, doanh thu ${formatVND(brief.total_revenue || 0)}`;
    }

    function formatLedgerActivityAria(brief) {
      const parts = [`có ${brief.count} khoản thu chi`];
      if (brief.expense > 0) parts.push(`chi ${formatVND(brief.expense)}`);
      if (brief.repay > 0) parts.push(`trả nợ ${formatVND(brief.repay)}`);
      return parts.join(', ');
    }

    function getTimedMonthLedgerForMonth(monthStr) {
      const vault = readFinanceVaultSync();
      const allLedger = Array.isArray(vault.ledger) && vault.ledger.length > 0
        ? vault.ledger
        : (workState.ledger || []);
      return monthStr
        ? allLedger.filter(l => l && l.category !== 'borrow' && !isFundLedgerItem(l) && (l.date || '').startsWith(monthStr + '-'))
        : [];
    }

    function announceCalendarDay(dateStr, scope) {
      const isLedger = scope === 'ledger';
      const liveEl = document.getElementById(isLedger ? 'ledger-cal-live' : 'work-cal-live');
      if (!liveEl || !dateStr) return;
      const monthStr = dateStr.slice(0, 7);
      const vnDate = formatVNDate(dateStr);
      if (isLedger) {
        const map = buildLedgerActivityDaysMap(monthStr, getTimedMonthLedgerForMonth(monthStr));
        const brief = map[dateStr];
        liveEl.textContent = brief
          ? `Đang xem ngày ${vnDate}, ${formatLedgerActivityAria(brief)}.`
          : `Đang xem ngày ${vnDate}, chưa có thu chi.`;
      } else {
        const orderMap = buildWorkOrderDaysMap(monthStr);
        const brief = orderMap[dateStr];
        liveEl.textContent = (brief && Number(brief.job_count) > 0)
          ? `Đang xem ngày ${vnDate}, ${brief.job_count} đơn, doanh thu ${formatVND(brief.total_revenue || 0)}.`
          : `Đang xem ngày ${vnDate}, chưa có đơn.`;
      }
    }

    function syncAndRenderWorkTarget(targetDate, targetMonth) {
      const v = readFinanceVaultSync();
      if ((v.jobs && v.jobs.length > 0) || (v.ledger && v.ledger.length > 0)) {
        computeWorkFromLocalVault(targetDate, targetMonth);
        loadWorkData(targetDate, { month: targetMonth, silent: true });
      } else {
        workState.date = targetDate;
        workState.month = targetMonth;
        renderWorkCalendar();
        renderLedgerCalendar(getTimedMonthLedgerForMonth(targetMonth), targetMonth);
        loadWorkData(targetDate, { month: targetMonth });
      }
    }

    window.stepWorkCalendarMonth = function (deltaMonths) {
      const curMonth = getResolvedCalendarMonth();
      const nextMonth = shiftMonthStr(curMonth, deltaMonths);
      workState.calendarMonth = nextMonth;
      const targetDate = workState.date || workState.today || state.today || '';
      syncAndRenderWorkTarget(targetDate, nextMonth);
    };

    window.selectWorkCalendarDay = function (dateStr, scope) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) return;
      const resolvedScope = scope === 'ledger' || (scope !== 'work' && state.activeTab === 'ledger')
        ? 'ledger'
        : 'work';
      const targetMonth = dateStr.slice(0, 7);
      workState.calendarMonth = targetMonth;
      if (resolvedScope === 'ledger') {
        workState.ledgerScope = 'day';
      } else {
        workState.heroScope = 'day';
        if (workState.subTab !== 'jobs') {
          switchWorkSubTab('jobs');
        }
      }
      syncAndRenderWorkTarget(dateStr, targetMonth);
      announceCalendarDay(dateStr, resolvedScope);
    };

    window.onWorkCalGridKeydown = function (e) {
      const grid = (e && e.currentTarget) || document.getElementById('work-cal-grid');
      if (!grid) return;
      const gridId = grid.id || 'work-cal-grid';
      const buttons = Array.from(grid.querySelectorAll('.work-cal-day-btn'));
      if (buttons.length === 0) return;
      const idx = buttons.indexOf(document.activeElement);
      if (idx === -1) return;

      const deltaMap = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 };
      let nextIdx = -1;
      let deltaDays = 0;
      if (e.key in deltaMap) {
        deltaDays = deltaMap[e.key];
        nextIdx = idx + deltaDays;
      } else if (e.key === 'Home') {
        nextIdx = 0;
      } else if (e.key === 'End') {
        nextIdx = buttons.length - 1;
      } else {
        return;
      }

      e.preventDefault();
      if (nextIdx >= 0 && nextIdx < buttons.length) {
        buttons[nextIdx].focus();
        return;
      }

      const curDate = buttons[idx].getAttribute('data-date');
      const targetDate = curDate ? shiftDateStr(curDate, deltaDays) : '';
      if (!targetDate) return;
      workState.calendarMonth = targetDate.slice(0, 7);
      syncAndRenderWorkTarget(workState.date || workState.today || state.today || '', workState.calendarMonth);
      const liveGrid = document.getElementById(gridId);
      const targetBtn = liveGrid && liveGrid.querySelector(`[data-date="${targetDate}"]`);
      if (targetBtn) targetBtn.focus();
    };

    function renderMonthCalendarGrid(cfg) {
      const grid = document.getElementById(cfg.gridId);
      const titleEl = document.getElementById(cfg.titleId);
      const statsEl = document.getElementById(cfg.statsId);
      if (!grid) return;

      const activeFocusDate = (document.activeElement && grid.contains(document.activeElement))
        ? document.activeElement.getAttribute('data-date')
        : null;

      const calMonth = cfg.calMonth || getResolvedCalendarMonth();
      if (titleEl) {
        titleEl.textContent = formatMonthHumanLabel(calMonth);
      }

      const [year, monthNum] = calMonth.split('-').map(Number);
      const firstOfMonth = new Date(Date.UTC(year, monthNum - 1, 1));
      const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
      // Thứ Hai là cột đầu tiên (T2=0 .. CN=6)
      const leadingDays = (firstOfMonth.getUTCDay() + 6) % 7;
      const totalCells = Math.ceil((leadingDays + daysInMonth) / 7) * 7;

      const activityMap = cfg.activityMap || {};
      const activeDaysCount = Object.keys(activityMap).length;
      if (statsEl) {
        statsEl.textContent = `${activeDaysCount} ${cfg.statUnitLabel}`;
      }

      const todayStr = workState.today || state.today || '';
      const selectedStr = workState.date || '';

      const cells = [];
      for (let i = 0; i < totalCells; i++) {
        const dt = new Date(Date.UTC(year, monthNum - 1, 1 - leadingDays + i));
        const cellDate = dt.toISOString().slice(0, 10);
        const cellMonth = cellDate.slice(0, 7);
        const dayNum = dt.getUTCDate();
        const isCurrentMonth = cellMonth === calMonth;
        const isSelected = cellDate === selectedStr;
        const isToday = isCurrentMonth && cellDate === todayStr;
        const brief = isCurrentMonth ? activityMap[cellDate] : null;
        const hasActivity = Boolean(brief);

        const weekdayName = getWorkCalendarWeekdayName(cellDate);
        const ariaParts = [`${dayNum}, ${weekdayName} ${formatVNDate(cellDate)}`];
        if (isToday) ariaParts.push('hôm nay');
        if (hasActivity) {
          ariaParts.push(cfg.formatAriaActivity(brief));
        } else if (isCurrentMonth) {
          ariaParts.push(cfg.emptyAriaLabel);
        }
        if (isSelected) ariaParts.push('đang xem');

        const classes = ['work-cal-day-btn'];
        if (!isCurrentMonth) classes.push('is-outside');
        if (isSelected) classes.push('is-selected');
        if (isToday) classes.push('is-today');
        if (hasActivity) classes.push('has-activity');

        cells.push(
          `<button type="button" class="${classes.join(' ')}" data-date="${cellDate}" aria-label="${escapeHTML(ariaParts.join(', '))}" aria-pressed="${isSelected ? 'true' : 'false'}"${isToday ? ' aria-current="date"' : ''} onclick="selectWorkCalendarDay('${cellDate}', '${cfg.scope}')"><span class="work-cal-day-circle">${dayNum}</span></button>`
        );
      }

      grid.innerHTML = cells.join('');

      if (activeFocusDate) {
        const restoreBtn = grid.querySelector(`[data-date="${activeFocusDate}"]`)
          || grid.querySelector(`[data-date="${selectedStr}"]`);
        if (restoreBtn) restoreBtn.focus({ preventScroll: true });
      }
    }

    function syncCalendarCollapseUI(scope) {
      const isLedger = scope === 'ledger';
      const expanded = isLedger ? Boolean(workState.ledgerCalendarExpanded) : Boolean(workState.workCalendarExpanded);
      const cardEl = document.getElementById(isLedger ? 'ledger-calendar-card' : 'work-calendar-card');
      const bodyEl = document.getElementById(isLedger ? 'ledger-cal-body' : 'work-cal-body');
      const btnEl = document.getElementById(isLedger ? 'btn-ledger-cal-toggle' : 'btn-work-cal-toggle');
      if (cardEl) cardEl.classList.toggle('is-collapsed', !expanded);
      if (bodyEl) bodyEl.hidden = !expanded;
      if (btnEl) {
        btnEl.classList.toggle('is-expanded', expanded);
        btnEl.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        btnEl.setAttribute(
          'aria-label',
          expanded ? 'Thu nhỏ — thu gọn bảng lịch tháng' : 'Mở lịch — mở rộng bảng lịch tháng'
        );
        const lblEl = btnEl.querySelector('.work-cal-toggle-label');
        if (lblEl) lblEl.textContent = expanded ? 'Thu nhỏ' : 'Mở lịch';
      }
    }

    window.toggleWorkCalendar = function (scope) {
      const resolved = scope === 'ledger' ? 'ledger' : 'work';
      if (resolved === 'ledger') {
        workState.ledgerCalendarExpanded = !workState.ledgerCalendarExpanded;
      } else {
        workState.workCalendarExpanded = !workState.workCalendarExpanded;
      }
      syncCalendarCollapseUI(resolved);
    };

    function renderWorkCalendar() {
      const calMonth = getResolvedCalendarMonth();
      renderMonthCalendarGrid({
        scope: 'work',
        gridId: 'work-cal-grid',
        titleId: 'work-cal-month-title',
        statsId: 'work-cal-month-stats',
        calMonth,
        activityMap: buildWorkOrderDaysMap(calMonth),
        statUnitLabel: 'ngày có đơn',
        formatAriaActivity: formatWorkActivityAria,
        emptyAriaLabel: 'chưa có đơn'
      });
      syncCalendarCollapseUI('work');
    }

    function renderLedgerCalendar(timedMonthLedger, calMonthOpt) {
      const calMonth = calMonthOpt || getResolvedCalendarMonth();
      renderMonthCalendarGrid({
        scope: 'ledger',
        gridId: 'ledger-cal-grid',
        titleId: 'ledger-cal-month-title',
        statsId: 'ledger-cal-month-stats',
        calMonth,
        activityMap: buildLedgerActivityDaysMap(calMonth, timedMonthLedger),
        statUnitLabel: 'ngày có thu chi',
        formatAriaActivity: formatLedgerActivityAria,
        emptyAriaLabel: 'chưa có thu chi'
      });
      syncCalendarCollapseUI('ledger');
    }

    window.setDebtListFilter = function (filter) {
      if (!['all', 'unpaid', 'settled'].includes(filter)) filter = 'all';
      workState.debtFilter = filter;
      renderWorkUnpaidGroups();
    };

    function getDefaultWorkDateStr() {
      return workState.date || workState.today || state.today || new Date().toISOString().slice(0, 10);
    }

    function formatMonthHumanLabel(monthStr) {
      if (!monthStr || !monthStr.includes('-')) return monthStr || '';
      const parts = monthStr.split('-');
      return `Tháng ${parseInt(parts[1], 10)}/${parts[0]}`;
    }

    function getAvailableDebtMonths(groups) {
      const counts = {};
      (groups || []).forEach(g => {
        (g.jobs || []).forEach(j => {
          const m = String((j && j.date) || '').slice(0, 7);
          if (/^\d{4}-\d{2}$/.test(m)) {
            counts[m] = (counts[m] || 0) + 1;
          }
        });
      });
      const fallbackMonth = (workState.month || getDefaultWorkDateStr().slice(0, 7));
      if (/^\d{4}-\d{2}$/.test(fallbackMonth) && !(fallbackMonth in counts)) {
        counts[fallbackMonth] = 0;
      }
      if (workState.debtTimeMonth && /^\d{4}-\d{2}$/.test(workState.debtTimeMonth) && !(workState.debtTimeMonth in counts)) {
        counts[workState.debtTimeMonth] = 0;
      }
      return Object.keys(counts)
        .sort((a, b) => (a < b ? 1 : -1))
        .map(m => ({ month: m, count: counts[m] }));
    }

    function syncDebtFilterControls(groups) {
      syncSearchInputUI('debt-search-input', 'debt-search-clear', workState.debtSearchQuery);

      const mode = workState.debtTimeMode || 'all';
      document.querySelectorAll('#debt-time-modes .work-time-mode-pill').forEach(btn => {
        const active = btn.getAttribute('data-mode') === mode;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });

      const dayRow = document.getElementById('debt-time-day-row');
      const monthRow = document.getElementById('debt-time-month-row');
      const rangeRow = document.getElementById('debt-time-range-row');
      if (dayRow) dayRow.hidden = mode !== 'day';
      if (monthRow) monthRow.hidden = mode !== 'month';
      if (rangeRow) rangeRow.hidden = mode !== 'range';

      const dateInput = document.getElementById('debt-filter-date');
      if (dateInput && document.activeElement !== dateInput && dateInput.value !== (workState.debtTimeDate || '')) {
        dateInput.value = workState.debtTimeDate || '';
      }

      const monthSelect = document.getElementById('debt-filter-month');
      if (monthSelect) {
        const monthItems = getAvailableDebtMonths(groups);
        if (!workState.debtTimeMonth && mode === 'month' && monthItems.length > 0) {
          const withData = monthItems.find(x => x.count > 0);
          workState.debtTimeMonth = (withData || monthItems[0]).month;
        }
        const sig = monthItems.map(x => `${x.month}:${x.count}`).join('|');
        if (monthSelect.dataset.sig !== sig) {
          monthSelect.dataset.sig = sig;
          monthSelect.innerHTML = monthItems.map(x => {
            const label = x.count > 0
              ? `${formatMonthHumanLabel(x.month)} (${x.count} đơn)`
              : formatMonthHumanLabel(x.month);
            return `<option value="${escapeHTML(x.month)}">${escapeHTML(label)}</option>`;
          }).join('');
        }
        if (workState.debtTimeMonth && monthSelect.value !== workState.debtTimeMonth) {
          monthSelect.value = workState.debtTimeMonth;
        }
      }

      const fromInput = document.getElementById('debt-filter-from');
      if (fromInput && document.activeElement !== fromInput && fromInput.value !== (workState.debtTimeFrom || '')) {
        fromInput.value = workState.debtTimeFrom || '';
      }
      const toInput = document.getElementById('debt-filter-to');
      if (toInput && document.activeElement !== toInput && toInput.value !== (workState.debtTimeTo || '')) {
        toInput.value = workState.debtTimeTo || '';
      }
    }

    function hasActiveDebtTimeConstraint() {
      const mode = workState.debtTimeMode || 'all';
      if (mode === 'day') return Boolean((workState.debtTimeDate || '').trim());
      if (mode === 'month') return Boolean((workState.debtTimeMonth || '').trim());
      if (mode === 'range') return Boolean((workState.debtTimeFrom || '').trim() || (workState.debtTimeTo || '').trim());
      return false;
    }

    function matchesDebtTimeFilter(dateStr) {
      const mode = workState.debtTimeMode || 'all';
      const d = String(dateStr || '');
      if (mode === 'day') {
        const target = (workState.debtTimeDate || '').trim();
        return !target || d === target;
      }
      if (mode === 'month') {
        const target = (workState.debtTimeMonth || '').trim();
        return !target || d.startsWith(target + '-');
      }
      if (mode === 'range') {
        const from = (workState.debtTimeFrom || '').trim();
        const to = (workState.debtTimeTo || '').trim();
        if (!from && !to) return true;
        if (!d) return false;
        if (from && to) {
          const start = from <= to ? from : to;
          const end = from <= to ? to : from;
          return d >= start && d <= end;
        }
        return from ? d >= from : d <= to;
      }
      return true;
    }

    function describeDebtTimeFilter() {
      const mode = workState.debtTimeMode || 'all';
      if (mode === 'day' && workState.debtTimeDate) {
        return `ngày ${formatVNDate(workState.debtTimeDate)}`;
      }
      if (mode === 'month' && workState.debtTimeMonth) {
        return formatMonthHumanLabel(workState.debtTimeMonth).toLowerCase();
      }
      if (mode === 'range') {
        const from = (workState.debtTimeFrom || '').trim();
        const to = (workState.debtTimeTo || '').trim();
        if (from && to) {
          const start = from <= to ? from : to;
          const end = from <= to ? to : from;
          return `từ ${formatVNDate(start)} đến ${formatVNDate(end)}`;
        }
        if (from) return `từ ngày ${formatVNDate(from)}`;
        if (to) return `đến ngày ${formatVNDate(to)}`;
      }
      return '';
    }

    window.onDebtSearchInput = function (val) {
      workState.debtSearchQuery = String(val || '');
      renderWorkUnpaidGroups();
    };

    window.onDebtSearchKeydown = function (e) {
      if (e.key === 'Escape') {
        const hasText = Boolean((workState.debtSearchQuery || '').trim() || (e.target && e.target.value));
        if (hasText) {
          e.preventDefault();
          window.clearDebtSearch();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
      }
    };

    window.clearDebtSearch = function () {
      workState.debtSearchQuery = '';
      const inputEl = document.getElementById('debt-search-input');
      if (inputEl) inputEl.value = '';
      renderWorkUnpaidGroups();
      if (inputEl) inputEl.focus();
    };

    window.setDebtTimeMode = function (mode) {
      if (!['all', 'day', 'month', 'range'].includes(mode)) mode = 'all';
      workState.debtTimeMode = mode;
      if (mode === 'day' && !workState.debtTimeDate) {
        workState.debtTimeDate = getDefaultWorkDateStr();
      } else if (mode === 'month' && !workState.debtTimeMonth) {
        const groups = Array.isArray(workState.debtGroups) && workState.debtGroups.length > 0
          ? workState.debtGroups
          : (workState.unpaidGroups || []);
        const months = getAvailableDebtMonths(groups);
        const withData = months.find(x => x.count > 0);
        workState.debtTimeMonth = (withData || months[0] || { month: getDefaultWorkDateStr().slice(0, 7) }).month;
      }
      renderWorkUnpaidGroups();
    };

    window.setDebtFilterToday = function () {
      workState.debtTimeMode = 'day';
      workState.debtTimeDate = workState.today || state.today || new Date().toISOString().slice(0, 10);
      renderWorkUnpaidGroups();
    };

    window.onDebtTimeDetailChange = function () {
      const dateInput = document.getElementById('debt-filter-date');
      const monthSelect = document.getElementById('debt-filter-month');
      const fromInput = document.getElementById('debt-filter-from');
      const toInput = document.getElementById('debt-filter-to');
      if (dateInput) workState.debtTimeDate = dateInput.value || '';
      if (monthSelect) workState.debtTimeMonth = monthSelect.value || '';
      if (fromInput) workState.debtTimeFrom = fromInput.value || '';
      if (toInput) workState.debtTimeTo = toInput.value || '';
      renderWorkUnpaidGroups();
    };

    window.resetDebtFilters = function () {
      workState.debtSearchQuery = '';
      workState.debtTimeMode = 'all';
      workState.debtTimeDate = '';
      workState.debtTimeMonth = '';
      workState.debtTimeFrom = '';
      workState.debtTimeTo = '';
      const inputEl = document.getElementById('debt-search-input');
      if (inputEl) inputEl.value = '';
      renderWorkUnpaidGroups();
      if (inputEl) inputEl.focus();
    };

    function findDebtGroupByKeyOrIdx(custEncOrIdx) {
      const allGroups = (workState.debtGroups && workState.debtGroups.length > 0)
        ? workState.debtGroups
        : (workState.unpaidGroups || []);
      if (typeof custEncOrIdx === 'number' && Number.isInteger(custEncOrIdx)) {
        return (workState.unpaidGroups || allGroups)[custEncOrIdx] || null;
      }
      let decoded = String(custEncOrIdx || '');
      try { decoded = decodeURIComponent(decoded); } catch (_) { }
      const target = decoded.trim().toLowerCase();
      return allGroups.find(g => (g.customer || '').trim().toLowerCase() === target) || null;
    }

    function renderWorkUnpaidGroups() {
      const totalEl = document.getElementById('work-unpaid-total-all');
      const countEl = document.getElementById('work-unpaid-count-all');
      const listEl = document.getElementById('work-unpaid-groups-list');
      if (totalEl) totalEl.textContent = formatVND(workState.totalUnpaidAll || 0);
      if (countEl) countEl.textContent = `${workState.totalUnpaidJobs || 0} đơn nợ`;

      const groups = Array.isArray(workState.debtGroups) && workState.debtGroups.length > 0
        ? workState.debtGroups
        : (workState.unpaidGroups || []);

      syncDebtFilterControls(groups);

      const rawQuery = (workState.debtSearchQuery || '').trim();
      const hasTimeFilter = hasActiveDebtTimeConstraint();
      const hasSearchOrTimeFilter = Boolean(rawQuery || hasTimeFilter);

      let allJobsCount = 0;
      let unpaidJobsCount = 0;
      let settledJobsCount = 0;

      const searchMatchedGroups = groups.map(g => {
        const jobs = (g.jobs || []).filter(j => {
          if (!matchesDebtTimeFilter(j.date)) return false;
          if (!matchesTokenizedQuery(rawQuery, [j.customer || g.customer, j.service, j.note], j.date)) {
            return false;
          }
          return true;
        });
        jobs.forEach(j => {
          allJobsCount++;
          if (getDebtJobTotals(j).remaining > 0) unpaidJobsCount++;
          else settledJobsCount++;
        });
        return jobs.length > 0 ? { ...g, _matchedJobs: jobs } : null;
      }).filter(Boolean);

      const setTxt = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };
      setTxt('debt-cnt-all', String(allJobsCount));
      setTxt('debt-cnt-unpaid', String(unpaidJobsCount));
      setTxt('debt-cnt-settled', String(settledJobsCount));

      const filter = workState.debtFilter || 'all';
      document.querySelectorAll('#debt-list-filters .borrow-filter-pill').forEach(btn => {
        const active = btn.getAttribute('data-filter') === filter;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
      });

      const filteredGroups = searchMatchedGroups.map(g => {
        const matchedJobs = g._matchedJobs.filter(j => {
          const isSettledJob = getDebtJobTotals(j).remaining <= 0;
          if (filter === 'unpaid') return !isSettledJob;
          if (filter === 'settled') return isSettledJob;
          return true;
        });
        return matchedJobs.length > 0 ? { ...g, _visibleJobs: matchedJobs } : null;
      }).filter(Boolean);

      let visibleJobsCount = 0;
      let visibleRemainingTotal = 0;
      filteredGroups.forEach(g => {
        g._visibleJobs.forEach(j => {
          visibleJobsCount++;
          visibleRemainingTotal += Math.max(0, getDebtJobTotals(j).remaining);
        });
      });

      const statusText = visibleJobsCount > 0
        ? `Tìm thấy ${filteredGroups.length} khách (${visibleJobsCount} đơn) • Còn nợ ${formatVND(visibleRemainingTotal)}`
        : 'Không có đơn nợ nào khớp điều kiện đang lọc';
      renderSearchStatusBanner(
        'debt-search-status',
        'debt-search-live',
        hasSearchOrTimeFilter && groups.length > 0,
        statusText,
        'resetDebtFilters',
        visibleJobsCount === 0
      );

      if (!listEl) return;

      if (groups.length === 0) {
        listEl.innerHTML = `
        <div class="empty-state-box" style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
          <span style="color: var(--color-score-ring);">${workIconSVG('shield_ok', 28)}</span>
          <span>Chưa có đơn nợ nào (Chưa thanh toán). Tất cả các đơn đều đã thu ngay.</span>
        </div>
      `;
        return;
      }

      if (filteredGroups.length === 0) {
        if (hasSearchOrTimeFilter) {
          const criteriaParts = [];
          if (rawQuery) criteriaParts.push(`"${escapeHTML(rawQuery)}"`);
          const timeDesc = describeDebtTimeFilter();
          if (timeDesc) criteriaParts.push(escapeHTML(timeDesc));
          const criteriaText = criteriaParts.join(' trong ');

          if (allJobsCount > 0 && filter !== 'all') {
            const tabLabel = filter === 'unpaid' ? 'Chưa trả' : 'Đã trả xong';
            listEl.innerHTML = `
              <div class="empty-state-box">
                Không có đơn khớp ${criteriaText} ở mục <strong>${tabLabel}</strong>.
                <div class="empty-state-actions">
                  <button type="button" class="btn-search-reset" onclick="setDebtListFilter('all')">Xem tất cả (${allJobsCount})</button>
                  <button type="button" class="btn-search-reset" onclick="resetDebtFilters()">Xoá lọc</button>
                </div>
              </div>
            `;
          } else {
            listEl.innerHTML = `
              <div class="empty-state-box">
                Không tìm thấy đơn nợ nào khớp ${criteriaText || 'bộ lọc hiện tại'}.
                <div class="empty-state-actions">
                  <button type="button" class="btn-search-reset" onclick="resetDebtFilters()">Xoá bộ lọc</button>
                </div>
              </div>
            `;
          }
          return;
        }

        const emptyMsg = filter === 'unpaid'
          ? 'Tuyệt vời! Tất cả các đơn trong Sổ nợ đều đã trả xong. Bấm tab "Đã trả xong" hoặc "Tất cả" để xem lại.'
          : 'Chưa có đơn nợ nào đã trả xong.';
        listEl.innerHTML = `<div class="empty-state-box">${emptyMsg}</div>`;
        return;
      }

      listEl.innerHTML = filteredGroups.map((g, groupIdx) => {
        const safeCust = escapeHTML(g.customer);
        const encCust = encodeURIComponent(g.customer || '');
        const custKey = (g.customer || '').trim().toLowerCase();
        const groupUnpaidAmt = Math.max(0, Number(g.total_amount) || 0);
        const groupOrigAmt = Math.max(0, Number(g.original_amount) || groupUnpaidAmt);
        const groupPaidAmt = Math.max(0, Number(g.paid_amount) || 0);
        const groupSettled = groupUnpaidAmt === 0 && (g.total_job_count || (g.jobs || []).length) > 0;
        const unpaidJobCnt = Number(g.job_count) || 0;
        const totalJobCnt = Number(g.total_job_count) || (g.jobs || []).length;

        const visibleUnpaidAmt = g._visibleJobs.reduce((acc, j) => acc + Math.max(0, getDebtJobTotals(j).remaining), 0);
        const visibleOrigAmt = g._visibleJobs.reduce((acc, j) => acc + Math.max(0, getDebtJobTotals(j).orig), 0);
        const isPartialView = hasSearchOrTimeFilter && g._visibleJobs.length < totalJobCnt;
        const headerDisplayAmt = isPartialView ? visibleUnpaidAmt : groupUnpaidAmt;

        const subText = isPartialView
          ? `Khớp ${g._visibleJobs.length}/${totalJobCnt} đơn • Tổng nợ cả sổ ${formatShortK(groupUnpaidAmt)}`
          : (groupSettled
            ? `${totalJobCnt} đơn đều đã trả xong • Đã thu ${formatShortK(groupPaidAmt)}`
            : (groupPaidAmt > 0
              ? `${unpaidJobCnt}/${totalJobCnt} đơn chưa trả • Đã thu ${formatShortK(groupPaidAmt)}`
              : `${unpaidJobCnt} đơn chưa thanh toán`));

        const itemsHtml = g._visibleJobs.map(j => {
          const dt = getDebtJobTotals(j);
          const jobSettled = dt.remaining <= 0;
          const badgeHtml = jobSettled
            ? '<span class="work-debt-status-badge is-settled">&#10003; Đã trả xong</span>'
            : (dt.paid > 0
              ? '<span class="work-debt-status-badge">Đang trả góp</span>'
              : '<span class="work-debt-status-badge">Chưa trả xong</span>');
          const footHtml = buildInstallmentFootHTML(dt.orig, dt.paid, dt.remaining, dt.overpaid, dt.payments, j.date);

          return `
        <div class="work-debt-item-row font-tabular${jobSettled ? ' is-debt-settled' : ''}">
          <div class="work-debt-item-top">
            <div class="work-debt-item-main">
              <div class="work-debt-item-title-line">
                <strong>${formatVNDate(j.date).slice(0, 5)}</strong>:
                <span>${escapeHTML(j.service)}</span>
              </div>
              <div class="work-debt-item-meta">
                ${badgeHtml}
                ${dt.paid > 0 ? `<span class="work-borrow-orig-sub">Gốc ${formatShortK(dt.orig)}${dt.overpaid > 0 ? ` • Thừa +${formatShortK(dt.overpaid)}` : ''}</span>` : ''}
              </div>
            </div>
            <div class="work-debt-item-right">
              <span class="work-debt-item-amt${jobSettled ? ' is-settled' : ''}">${jobSettled ? '0đ' : formatVND(dt.remaining)}</span>
              <div class="work-debt-item-actions">
                <button type="button" class="btn-ledger-repay${jobSettled ? ' is-settled' : ''}" onclick="openDebtJobPayModal(${Number(j.id)})" aria-label="${jobSettled ? 'Xem lịch sử trả tiền' : 'Trả tiền'} đơn ${escapeHTML(j.service)} của ${safeCust}">${jobSettled ? 'Lịch sử' : 'Trả tiền'}</button>
                <button type="button" class="btn-job-icon btn-del" onclick="deleteWorkJob(${Number(j.id)}, { fromDebt: true })" aria-label="Xoá đơn nợ ${escapeHTML(j.service)} của ${safeCust}">Xoá</button>
              </div>
            </div>
          </div>
          ${footHtml}
        </div>
      `;
        }).join('');

        const visibleCount = g._visibleJobs.length;
        const canToggle = visibleCount >= 2;
        const isExpanded = !canToggle || Boolean(workState.debtExpandedKeys && workState.debtExpandedKeys[custKey]);
        const itemsListId = `debt-group-items-${groupIdx}`;
        const toggleBtnHtml = canToggle
          ? `<button type="button" class="btn-debt-items-toggle${isExpanded ? ' is-expanded' : ''}" data-count="${visibleCount}" aria-expanded="${isExpanded ? 'true' : 'false'}" aria-controls="${itemsListId}" aria-label="${isExpanded ? `Ẩn chi tiết ${visibleCount} đơn của ${safeCust}` : `Hiện chi tiết ${visibleCount} đơn của ${safeCust}`}" onclick="toggleDebtGroupItems('${encCust}', '${itemsListId}', this)"><span class="debt-toggle-label">${isExpanded ? `Ẩn chi tiết (${visibleCount} đơn)` : `Hiện chi tiết (${visibleCount} đơn)`}</span><svg class="debt-toggle-chevron" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg></button>`
          : '';

        return `
        <div class="work-debt-group-card${groupSettled ? ' is-debt-settled' : ''}">
          <div class="work-debt-group-header">
            <div style="min-width: 0;">
              <div class="work-debt-cust-title">${safeCust} <span class="work-ch-badge ${g.channel === 'FB' ? 'ch-fb' : 'ch-zl'}">${escapeHTML(g.channel)}</span>${groupSettled ? ' <span class="work-borrow-settled-badge">&#10003; Đã trả xong</span>' : ''}</div>
              <span style="font-size: 11.5px; color: var(--text-sub);">${subText}</span>
            </div>
            <div class="work-ledger-amt-col font-tabular">
              <span class="work-debt-total-val">${formatVND(headerDisplayAmt)}</span>
              ${isPartialView
                ? (visibleOrigAmt > 0 ? `<span class="work-borrow-orig-sub">Gốc khớp ${formatShortK(visibleOrigAmt)}</span>` : '')
                : (groupPaidAmt > 0 ? `<span class="work-borrow-orig-sub">Gốc ${formatShortK(groupOrigAmt)}</span>` : '')}
            </div>
          </div>
          ${toggleBtnHtml}
          <div id="${itemsListId}" class="work-debt-items-list"${isExpanded ? '' : ' hidden'}>${itemsHtml}</div>
          <div class="work-debt-group-actions${groupSettled ? ' is-single' : ''}">
            <button type="button" class="btn-debt-copy" onclick="copyCustomerDebtText('${encCust}')">${workIconSVG('copy', 14)} <span>${groupSettled ? 'Copy lịch sử trả' : 'Copy báo nợ'}</span></button>
            ${groupSettled ? '' : `<button type="button" class="btn-debt-payall" onclick="payAllCustomerDebt('${encCust}')">${workIconSVG('check', 14)} <span>${isPartialView ? `Thu hết sổ (${formatShortK(groupUnpaidAmt)})` : `Đã thu hết (${formatShortK(groupUnpaidAmt)})`}</span></button>`}
          </div>
        </div>
      `;
      }).join('');
    }

    window.toggleDebtGroupItems = function (encCust, itemsListId, btnEl) {
      let decoded = String(encCust || '');
      try { decoded = decodeURIComponent(decoded); } catch (_) { }
      const custKey = decoded.trim().toLowerCase();
      if (!workState.debtExpandedKeys || typeof workState.debtExpandedKeys !== 'object') {
        workState.debtExpandedKeys = {};
      }
      const nextExpanded = !Boolean(workState.debtExpandedKeys[custKey]);
      if (nextExpanded) {
        workState.debtExpandedKeys[custKey] = true;
      } else {
        delete workState.debtExpandedKeys[custKey];
      }

      const listEl = itemsListId ? document.getElementById(itemsListId) : null;
      if (listEl) listEl.hidden = !nextExpanded;
      if (btnEl) {
        const count = Number(btnEl.getAttribute('data-count')) || (listEl ? listEl.children.length : 0);
        btnEl.classList.toggle('is-expanded', nextExpanded);
        btnEl.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
        const custName = decoded.trim();
        btnEl.setAttribute(
          'aria-label',
          nextExpanded
            ? `Ẩn chi tiết ${count} đơn của ${custName}`
            : `Hiện chi tiết ${count} đơn của ${custName}`
        );
        const lblEl = btnEl.querySelector('.debt-toggle-label');
        if (lblEl) {
          lblEl.textContent = nextExpanded ? `Ẩn chi tiết (${count} đơn)` : `Hiện chi tiết (${count} đơn)`;
        }
      }
    };

    window.copyCustomerDebtText = async function (custEncOrIdx) {
      const g = findDebtGroupByKeyOrIdx(custEncOrIdx);
      if (!g) return;
      const lines = g.settled
        ? [`Gửi ${g.customer} xác nhận các đơn đã thanh toán xong (${g.total_job_count || (g.jobs || []).length} đơn):`]
        : [`Gửi ${g.customer} danh sách đơn chưa thanh toán (${g.job_count} đơn):`];
      const jobsToPrint = g.settled
        ? (g.jobs || [])
        : (g.jobs || []).filter(j => getDebtJobTotals(j).remaining > 0);
      jobsToPrint.slice().reverse().forEach((j, idx) => {
        const dShort = formatVNDate(j.date).slice(0, 5);
        const dt = getDebtJobTotals(j);
        if (dt.remaining <= 0) {
          lines.push(`${idx + 1}. Ngày ${dShort}: ${j.service} = Đã trả xong (${formatShortK(dt.paid)})`);
        } else if (dt.paid > 0) {
          lines.push(`${idx + 1}. Ngày ${dShort}: ${j.service} = Còn ${formatShortK(dt.remaining)} (Gốc ${formatShortK(dt.orig)}, đã trả ${formatShortK(dt.paid)})`);
        } else {
          lines.push(`${idx + 1}. Ngày ${dShort}: ${j.service} = ${formatShortK(dt.remaining)}`);
        }
      });
      lines.push(g.settled ? `Tổng đã thanh toán: ${formatVND(g.paid_amount || g.original_amount || 0)}` : `Tổng còn nợ: ${formatVND(g.total_amount)}`);

      const text = lines.join('\n');
      try {
        await navigator.clipboard.writeText(text);
        showToast(`Đã copy thông tin của ${g.customer} để dán gửi Zalo/FB`);
      } catch (e) {
        showToast('Không thể copy tự động trên trình duyệt này', true);
      }
    };

    window.payAllCustomerDebt = async function (custEncOrIdx) {
      const g = findDebtGroupByKeyOrIdx(custEncOrIdx);
      if (!g || g.total_amount <= 0) return;
      if (!confirm(`Xác nhận đã thu đủ ${formatVND(g.total_amount)} (${g.job_count} đơn) của khách "${g.customer}"?`)) return;

      const payload = { customer: g.customer };
      try {
        const res = await api('/api/work/job/pay-customer', {
          method: 'POST',
          deferQueueToast: true,
          body: JSON.stringify(payload)
        });
        if (res && typeof res.work_rev === 'number') {
          syncState.workRev = Math.max(syncState.workRev, res.work_rev);
        }
        showToast(`Đã tất toán toàn bộ đơn nợ của ${g.customer}`);
        await loadWorkData(workState.date);
      } catch (err) {
        if (!isQueueableSyncError(err)) return;
        payCustomerDebtInLocalVault(g.customer, { dirty: false });
        enqueueSyncOp({
          domain: 'work',
          op: 'work_pay_customer',
          payload
        });
        showToast(`Đã tất toán đơn nợ ${g.customer} trên máy này (chờ đồng bộ)`);
        computeWorkFromLocalVault(workState.date);
      }
    };

    // ================= PHÂN KHU 3: SỔ THU CHI / QUỸ / MƯỢN / TRẢ NỢ =================
    window.setWorkLedgerCategory = function (cat) {
      const hidden = document.getElementById('work-ledger-category');
      if (hidden) hidden.value = cat;
      document.querySelectorAll('.work-cat-chip').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-cat') === cat);
      });
    };

    window.updateWorkLedgerAmountPreview = function (rawVal) {
      const preview = document.getElementById('work-ledger-amount-preview');
      if (!preview) return;
      const vnd = parseMoneyInputVND(rawVal);
      preview.textContent = vnd > 0 ? ('= ' + formatVND(vnd)) : '';
    };

    window.setWorkLedgerNote = function (noteText) {
      const noteInput = document.getElementById('work-ledger-note');
      if (noteInput) noteInput.value = noteText;
      setWorkLedgerCategory('expense');
    };

    window.openAddWorkLedgerModal = function (presetCategory) {
      const hidden = document.getElementById('work-ledger-category');
      if (presetCategory && ['expense', 'borrow'].includes(presetCategory)) {
        setWorkLedgerCategory(presetCategory);
      } else if (hidden && !['expense', 'borrow'].includes(hidden.value)) {
        setWorkLedgerCategory('expense');
      }
      const amtInp = document.getElementById('work-ledger-amount');
      updateWorkLedgerAmountPreview(amtInp ? amtInp.value : '');
      openModal('modal-add-work-ledger');
      setTimeout(() => {
        if (amtInp) amtInp.focus();
      }, 80);
    };

    window.submitWorkLedger = async function (e) {
      e.preventDefault();
      const category = document.getElementById('work-ledger-category').value || 'expense';
      const amtInput = document.getElementById('work-ledger-amount');
      const amount = parseMoneyInputVND(amtInput ? amtInput.value : '');
      const note = document.getElementById('work-ledger-note').value.trim();

      if (!note) {
        showToast('Nhập số tiền và nội dung chi tiết', true);
        return;
      }
      if (!amount || amount < 1000 || amount > 500000000) {
        showToast('Số tiền phải từ 1.000đ đến 500.000.000đ (nhập 1 – 500.000)', true);
        if (amtInput) amtInput.focus();
        return;
      }
      const ledgerDate = workState.date || state.today || new Date().toISOString().slice(0, 10);
      const clientUid = genClientUID('ldg');
      const nowTs = Math.floor(Date.now() / 1000);
      const bodyPayload = {
        uid: clientUid,
        date: ledgerDate,
        category,
        amount,
        note,
        ts: nowTs
      };
      try {
        const res = await api('/api/work/ledger', {
          method: 'POST',
          deferQueueToast: true,
          body: JSON.stringify(bodyPayload)
        });
        if (res && typeof res.work_rev === 'number') {
          syncState.workRev = Math.max(syncState.workRev, res.work_rev);
        }
        document.getElementById('work-ledger-amount').value = '';
        document.getElementById('work-ledger-note').value = '';
        updateWorkLedgerAmountPreview('');
        closeModal('modal-add-work-ledger');
        showToast('Đã lưu khoản mục vào sổ');
        workState.calendarMonth = ledgerDate.slice(0, 7);
        await loadWorkData(ledgerDate, { month: workState.calendarMonth });
      } catch (err) {
        if (!isQueueableSyncError(err)) return;
        const v = readFinanceVaultSync();
        v.ledger.push({
          id: Date.now(),
          uid: clientUid,
          date: ledgerDate,
          category,
          amount,
          note,
          ts: nowTs,
          updated_at: nowTs
        });
        saveFinanceVaultToDevice(v);
        enqueueSyncOp({
          domain: 'work',
          op: 'work_ledger_add',
          payload: bodyPayload
        });
        document.getElementById('work-ledger-amount').value = '';
        document.getElementById('work-ledger-note').value = '';
        updateWorkLedgerAmountPreview('');
        closeModal('modal-add-work-ledger');
        showToast('Đã lưu khoản mục trên máy này (chờ đồng bộ)');
        workState.calendarMonth = ledgerDate.slice(0, 7);
        computeWorkFromLocalVault(ledgerDate, workState.calendarMonth);
      }
    };

    function getLedgerCatLabel(cat) {
      switch (cat) {
        case 'expense': return `${workIconSVG('expense', 13)} <span>Chi tiêu / Phát sinh</span>`;
        case 'fund_in': return `${workIconSVG('fund_in', 13)} <span>Nộp Quỹ</span>`;
        case 'fund_bal': return `${workIconSVG('fund_bal', 13)} <span>Số Quỹ</span>`;
        case 'borrow': return `${workIconSVG('borrow', 13)} <span>Mượn</span>`;
        case 'repay': return `${workIconSVG('repay', 13)} <span>Trả Nợ</span>`;
        default: return escapeHTML(cat);
      }
    }

    function renderLedgerScreen() {
      const curDate = workState.date || state.today || '';
      const todayDate = workState.today || state.today || curDate;
      const curMonth = getResolvedCalendarMonth();

      updateTodayChipButton('btn-ledger-today', curMonth);

      const dayLedger = workState.ledger || [];
      const timedDayLedger = dayLedger.filter(l => l && l.category !== 'borrow' && !isFundLedgerItem(l));
      const timedMonthLedger = getTimedMonthLedgerForMonth(curMonth);

      const ds = workState.daySummary || {};
      const ms = workState.monthSummary || {};
      const isMonthScope = workState.ledgerScope === 'month';
      const activeSum = isMonthScope ? ms : ds;

      const btnScopeDay = document.getElementById('btn-ledger-scope-day');
      const btnScopeMonth = document.getElementById('btn-ledger-scope-month');
      if (btnScopeDay) btnScopeDay.classList.toggle('active', !isMonthScope);
      if (btnScopeMonth) btnScopeMonth.classList.toggle('active', isMonthScope);

      let monthHuman = curMonth;
      if (curMonth && curMonth.includes('-')) {
        const mParts = curMonth.split('-');
        monthHuman = `Tháng ${parseInt(mParts[1], 10)}/${mParts[0]}`;
      }

      const setTxt = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };

      const globalBorrow = getGlobalBorrowSummary();

      setTxt(
        'ledger-summary-date-label',
        isMonthScope
          ? `Tổng chi tiêu ${monthHuman}`
          : (curDate === todayDate ? 'Tổng chi tiêu hôm nay' : `Chi tiêu ngày ${formatDayMonth(curDate)}`)
      );
      setTxt('ledger-day-count-pill', `${isMonthScope ? timedMonthLedger.length : timedDayLedger.length} khoản`);

      const expStr = formatVND(activeSum.expense_amount || 0);
      setTxt('ledger-hero-expense', expStr);
      const expEl = document.getElementById('ledger-hero-expense');
      if (expEl) expEl.classList.toggle('is-long', expStr.length >= 12);

      setTxt('ledger-stat-expense', formatShortK(activeSum.expense_amount || 0));
      setTxt('ledger-stat-borrow', formatShortK(globalBorrow.remaining));
      setTxt('ledger-stat-repay', formatShortK(activeSum.repay_amount || 0));

      renderBorrowSummaryButton(globalBorrow);
      renderWorkLedgerList();
      renderLedgerCalendar(timedMonthLedger, curMonth);

      const borrowModalEl = document.getElementById('modal-borrow-list');
      if (borrowModalEl && borrowModalEl.classList.contains('open')) {
        renderBorrowListModal();
      }
    }

    function formatBorrowDateTime(dStr, tsSec) {
      const fullDate = dStr ? formatVNDate(dStr) : '';
      const hm = tsSec ? formatTimeHM(tsSec) : '';
      if (fullDate && hm) return `${fullDate} • ${hm}`;
      return fullDate || hm;
    }

    function buildInstallmentFootHTML(orig, paid, remaining, overpaid, installments, fallbackDate) {
      const list = Array.isArray(installments) ? installments : [];
      if (paid <= 0 && list.length === 0) return '';
      const isSettled = remaining <= 0 && orig > 0;
      const pct = orig > 0 ? Math.min(100, Math.round((paid / orig) * 100)) : 0;
      return `
        <div class="borrow-repay-card-foot">
          <div class="borrow-repay-progress-head font-tabular">
            <span>${isSettled ? 'Đã trả xong' : 'Đã trả'} ${formatShortK(paid)} / ${formatShortK(orig)}${overpaid > 0 ? ` (Thừa +${formatShortK(overpaid)})` : ''}${list.length > 0 ? ` (${list.length} lần)` : ''}</span>
            <span>${pct}%</span>
          </div>
          <div class="borrow-repay-progress-track" aria-hidden="true">
            <div class="borrow-repay-progress-fill" style="width: ${pct}%;"></div>
          </div>
          ${list.length > 0 ? `
            <div class="borrow-repay-log-list">
              ${list.map((r, idx) => {
                const timeLbl = formatBorrowDateTime(r.date || fallbackDate, r.ts);
                const rNote = (r.note || '').trim();
                return `
                  <div class="borrow-repay-log-row font-tabular">
                    <div class="borrow-repay-log-meta">
                      <span class="borrow-repay-step">Lần ${idx + 1}</span>
                      <span>${escapeHTML(timeLbl)}</span>
                      ${rNote ? `<span class="borrow-repay-log-note">&bull; ${escapeHTML(rNote)}</span>` : ''}
                    </div>
                    <span class="borrow-repay-log-amt">-${formatVND(r.amount)}</span>
                  </div>
                `;
              }).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }

    function buildBorrowCardHTML(item) {
      const { orig, paid, remaining, overpaid, repayments } = getBorrowTotals(item);
      const isSettled = remaining <= 0 && orig > 0;
      const footHtml = buildInstallmentFootHTML(orig, paid, remaining, overpaid, repayments, item.date);

      return `
        <div class="work-job-card${isSettled ? ' is-borrow-settled' : ''}">
          <div class="work-job-top">
            <div style="min-width: 0; flex: 1;">
              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <span class="work-stt-badge">${getLedgerCatLabel('borrow')}</span>
                <span class="font-tabular" style="font-size: 11.5px; color: var(--text-sub);">${escapeHTML(formatBorrowDateTime(item.date, item.ts))}</span>
                ${isSettled ? '<span class="work-borrow-settled-badge">&#10003; Đã trả xong</span>' : ''}
              </div>
              <div class="work-job-cust-name work-ledger-note">${escapeHTML(item.note)}</div>
            </div>
            <div class="work-ledger-right">
              <div class="work-ledger-amt-col font-tabular">
                <span class="work-job-price-val font-tabular${isSettled ? ' is-settled-amt' : ''}">${formatVND(remaining)}</span>
                ${paid > 0 ? `<span class="work-borrow-orig-sub">Gốc ${formatShortK(orig)}${overpaid > 0 ? ` • Thừa +${formatShortK(overpaid)}` : ''}</span>` : ''}
              </div>
              <div class="work-ledger-actions">
                <button type="button" class="btn-ledger-repay${isSettled ? ' is-settled' : ''}" onclick="openRepayBorrowModal(${Number(item.id)})" aria-label="${isSettled ? 'Xem lịch sử trả tiền' : 'Trả tiền'} khoản mượn ${escapeHTML(item.note)}">${isSettled ? 'Lịch sử' : 'Trả tiền'}</button>
                <button type="button" class="btn-job-icon btn-del" onclick="deleteWorkLedger(${Number(item.id)}, { isBorrow: true })" aria-label="Xoá khoản mượn ${escapeHTML(item.note)}">Xoá</button>
              </div>
            </div>
          </div>
          ${footHtml}
        </div>
      `;
    }

    function renderBorrowSummaryButton(summaryOpt) {
      const sum = summaryOpt || getGlobalBorrowSummary();
      const btn = document.getElementById('btn-open-borrow-list');
      const badgeEl = document.getElementById('ledger-borrow-btn-badge');
      const totalEl = document.getElementById('ledger-borrow-btn-total');

      const hasUnpaid = sum.unpaidCount > 0;
      const allSettled = sum.totalCount > 0 && !hasUnpaid;
      if (btn) {
        btn.classList.toggle('is-has-unpaid', hasUnpaid);
        btn.classList.toggle('is-all-settled', allSettled);
      }

      if (badgeEl) {
        badgeEl.classList.toggle('is-has-unpaid', hasUnpaid);
        badgeEl.classList.toggle('is-settled', allSettled);
        if (sum.totalCount === 0) {
          badgeEl.textContent = '0 khoản';
        } else if (allSettled) {
          badgeEl.textContent = '✓ Đã trả xong hết';
        } else {
          badgeEl.textContent = `${sum.unpaidCount} khoản chưa xong`;
        }
      }

      if (totalEl) {
        totalEl.textContent = formatVND(sum.remaining);
      }
    }

    window.setBorrowModalFilter = function (filter) {
      if (!['all', 'unpaid', 'settled'].includes(filter)) filter = 'all';
      workState.borrowFilter = filter;
      renderBorrowListModal();
    };

    window.onBorrowSearchInput = function (val) {
      workState.borrowSearchQuery = String(val || '');
      renderBorrowListModal();
    };

    window.onBorrowSearchKeydown = function (e) {
      if (e.key === 'Escape') {
        const hasText = Boolean((workState.borrowSearchQuery || '').trim() || (e.target && e.target.value));
        if (hasText) {
          e.preventDefault();
          e.stopPropagation();
          window.clearBorrowSearch();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
      }
    };

    window.clearBorrowSearch = function () {
      workState.borrowSearchQuery = '';
      const inputEl = document.getElementById('borrow-search-input');
      if (inputEl) inputEl.value = '';
      renderBorrowListModal();
      if (inputEl) inputEl.focus();
    };

    window.openBorrowListModal = function () {
      workState.borrowSearchQuery = '';
      const inputEl = document.getElementById('borrow-search-input');
      if (inputEl) inputEl.value = '';
      renderBorrowListModal();
      openModal('modal-borrow-list');
    };

    function renderBorrowListModal() {
      const sum = getGlobalBorrowSummary();
      const setTxt = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };

      setTxt('borrow-modal-total-rem', formatVND(sum.remaining));
      setTxt('borrow-modal-total-paid', formatVND(sum.paid));
      setTxt('borrow-modal-total-orig', formatVND(sum.orig));

      const remEl = document.getElementById('borrow-modal-total-rem');
      if (remEl) {
        const isZero = sum.remaining <= 0;
        remEl.classList.toggle('is-paid', isZero);
        remEl.classList.toggle('is-remaining', !isZero);
      }

      syncSearchInputUI('borrow-search-input', 'borrow-search-clear', workState.borrowSearchQuery);

      const sorted = [...sum.items].sort((a, b) => {
        const ra = getBorrowTotals(a).remaining > 0 ? 0 : 1;
        const rb = getBorrowTotals(b).remaining > 0 ? 0 : 1;
        if (ra !== rb) return ra - rb;
        const da = a.date || '';
        const db = b.date || '';
        if (da !== db) return da < db ? 1 : -1;
        return (Number(b.id) || 0) - (Number(a.id) || 0);
      });

      const rawQuery = (workState.borrowSearchQuery || '').trim();
      const queryMatched = rawQuery
        ? sorted.filter(item => matchesTokenizedQuery(rawQuery, [item.note]))
        : sorted;

      let matchedUnpaidCount = 0;
      let matchedSettledCount = 0;
      queryMatched.forEach(item => {
        const { orig, remaining } = getBorrowTotals(item);
        const isSettled = remaining <= 0 && orig > 0;
        if (isSettled) matchedSettledCount++;
        else matchedUnpaidCount++;
      });

      setTxt('borrow-cnt-all', String(queryMatched.length));
      setTxt('borrow-cnt-unpaid', String(matchedUnpaidCount));
      setTxt('borrow-cnt-settled', String(matchedSettledCount));

      const activeFilter = workState.borrowFilter || 'all';
      document.querySelectorAll('#borrow-list-filters .borrow-filter-pill').forEach(btn => {
        const isAct = btn.getAttribute('data-filter') === activeFilter;
        btn.classList.toggle('active', isAct);
        btn.setAttribute('aria-selected', isAct ? 'true' : 'false');
      });

      const filtered = queryMatched.filter(item => {
        const { orig, remaining } = getBorrowTotals(item);
        const isSettled = remaining <= 0 && orig > 0;
        if (activeFilter === 'unpaid') return !isSettled;
        if (activeFilter === 'settled') return isSettled;
        return true;
      });

      const filteredRemaining = filtered.reduce((acc, item) => acc + getBorrowTotals(item).remaining, 0);
      const statusText = filtered.length > 0
        ? `Tìm thấy ${filtered.length} khoản khớp "${rawQuery}" • Còn phải trả ${formatVND(filteredRemaining)}`
        : (queryMatched.length > 0
          ? `Không có khoản khớp "${rawQuery}" trong mục đang chọn`
          : `Không tìm thấy khoản mượn nào khớp "${rawQuery}"`);
      renderSearchStatusBanner(
        'borrow-search-status',
        'borrow-search-live',
        Boolean(rawQuery && sum.totalCount > 0),
        statusText,
        'clearBorrowSearch',
        filtered.length === 0
      );

      const listEl = document.getElementById('borrow-modal-list');
      if (!listEl) return;

      if (filtered.length === 0) {
        if (sum.totalCount === 0) {
          listEl.innerHTML = `
            <div class="empty-state-box">
              Quyền chưa có khoản mượn tiền nào.<br>
              Bấm nút <strong>+ Thêm khoản mượn mới</strong> phía trên để ghi lại.
            </div>`;
        } else if (rawQuery) {
          if (queryMatched.length > 0 && activeFilter !== 'all') {
            const tabLabel = activeFilter === 'unpaid' ? 'Chưa trả' : 'Đã trả xong';
            listEl.innerHTML = `
              <div class="empty-state-box">
                Không có khoản mượn khớp "${escapeHTML(rawQuery)}" ở mục <strong>${tabLabel}</strong>.
                <div class="empty-state-actions">
                  <button type="button" class="btn-search-reset" onclick="setBorrowModalFilter('all')">Xem tất cả (${queryMatched.length})</button>
                  <button type="button" class="btn-search-reset" onclick="clearBorrowSearch()">Xoá tìm kiếm</button>
                </div>
              </div>`;
          } else {
            listEl.innerHTML = `
              <div class="empty-state-box">
                Không tìm thấy khoản mượn nào có tên khớp "${escapeHTML(rawQuery)}".
                <div class="empty-state-actions">
                  <button type="button" class="btn-search-reset" onclick="clearBorrowSearch()">Xoá tìm kiếm</button>
                </div>
              </div>`;
          }
        } else if (activeFilter === 'unpaid') {
          listEl.innerHTML = `<div class="empty-state-box">Tuyệt vời! Tất cả các khoản mượn đều đã trả xong.</div>`;
        } else {
          listEl.innerHTML = `<div class="empty-state-box">Chưa có khoản mượn nào đã trả xong.</div>`;
        }
        return;
      }

      listEl.innerHTML = filtered.map(item => buildBorrowCardHTML(item)).join('');
    }

    function renderWorkLedgerList() {
      const container = document.getElementById('work-ledger-list');
      const titleEl = document.getElementById('ledger-day-list-title');
      const subEl = document.getElementById('ledger-day-list-sub');
      const curDate = workState.date || '';
      // Chỉ hiển thị Chi tiêu / Phát sinh và Trả nợ theo ngày; Nộp quỹ nằm ở tab Quỹ, Mượn nằm trong nút gom toàn thời gian.
      const list = (workState.ledger || []).filter(item => item && item.category !== 'borrow' && !isFundLedgerItem(item));
      const dm = formatDayMonth(curDate);

      if (titleEl) titleEl.textContent = dm ? `Phát sinh ngày ${dm}` : 'Phát sinh trong ngày';
      if (subEl) subEl.textContent = `${list.length} khoản`;
      if (!container) return;

      if (list.length === 0) {
        container.innerHTML = `<div class="empty-state-box">Chưa có khoản chi tiêu nào trong ngày ${dm || formatVNDate(curDate)}.</div>`;
        return;
      }

      container.innerHTML = list.map(item => `
        <div class="work-job-card">
          <div class="work-job-top">
            <div style="min-width: 0; flex: 1;">
              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <span class="work-stt-badge">${getLedgerCatLabel(item.category)}</span>
                <span class="font-tabular" style="font-size: 11.5px; color: var(--text-sub);">${escapeHTML(formatDayMonthTime(item.date || curDate, item.ts))}</span>
              </div>
              <div class="work-job-cust-name work-ledger-note">${escapeHTML(item.note)}</div>
            </div>
            <div class="work-ledger-right">
              <span class="work-job-price-val font-tabular">${formatVND(item.amount)}</span>
              <button type="button" class="btn-job-icon btn-del" onclick="deleteWorkLedger(${Number(item.id)})" aria-label="Xoá khoản mục ${escapeHTML(item.note)}">Xoá</button>
            </div>
          </div>
        </div>
      `).join('');
    }

    // =========================================================================
    // PHÂN KHU 4: QUỸ TIẾT KIỆM ĐA QUỸ (CÀI ĐẶT MỤC TIÊU, ANIMATION, LỊCH SỬ)
    // =========================================================================
    const FUND_CONFIG_DATE = '2000-01-01';
    const FUND_CONFIG_PREFIX = '@FUND:';
    const FUND_COLORS = ['sage', 'emerald', 'sky', 'amber', 'rose', 'violet'];
    const FUND_ICONS = ['piggy', 'shield', 'bike', 'heart', 'home', 'gift'];
    const fundsUIState = {
      activeHistoryFundId: '',
      historyModalScope: 'all',
      lastDepositAnim: null
    };

    function parseFundConfigRow(row) {
      if (!row || row.category !== 'fund_bal' || typeof row.note !== 'string' || !row.note.startsWith(FUND_CONFIG_PREFIX)) {
        return null;
      }
      try {
        const obj = JSON.parse(row.note.slice(FUND_CONFIG_PREFIX.length));
        if (!obj || typeof obj !== 'object') return null;
        const fallbackId = typeof row.uid === 'string' && row.uid.startsWith('fcfg_') ? row.uid.slice(5) : '';
        const id = String(obj.id || fallbackId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 36);
        if (!id) return null;
        const name = String(obj.n || obj.name || '').trim().slice(0, 40) || 'Quỹ tiết kiệm';
        const rawTarget = Number(obj.t || obj.target || row.amount) || 5000000;
        const target = Math.min(500000000, Math.max(1000, Math.round(rawTarget)));
        const color = FUND_COLORS.includes(obj.c) ? obj.c : 'sage';
        const icon = FUND_ICONS.includes(obj.ic) ? obj.ic : 'piggy';
        const sortOrder = Number.isFinite(Number(obj.s)) ? Number(obj.s) : 0;
        return {
          id,
          name,
          target,
          color,
          icon,
          sortOrder,
          isVirtual: false,
          ledgerId: Number(row.id) || 0,
          uid: row.uid || ('fcfg_' + id),
          ts: Number(row.ts) || 0,
          updatedAt: Number(row.updated_at || row.ts) || 0,
          rawRow: row
        };
      } catch (_) {
        return null;
      }
    }

    function encodeFundConfigNote(cfg) {
      const id = String(cfg && cfg.id ? cfg.id : 'default').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 36) || 'default';
      let safeName = String(cfg && cfg.name ? cfg.name : 'Quỹ tiết kiệm').trim().slice(0, 40) || 'Quỹ tiết kiệm';
      const target = Math.min(500000000, Math.max(1000, Math.round(Number(cfg && cfg.target) || 5000000)));
      const color = FUND_COLORS.includes(cfg && cfg.color) ? cfg.color : 'sage';
      const icon = FUND_ICONS.includes(cfg && cfg.icon) ? cfg.icon : 'piggy';
      const sortOrder = Number.isFinite(Number(cfg && cfg.sortOrder)) ? Math.round(Number(cfg.sortOrder)) : 0;

      let encoded = FUND_CONFIG_PREFIX + JSON.stringify({ id, n: safeName, t: target, c: color, ic: icon, s: sortOrder });
      while (encoded.length > 300 && safeName.length > 1) {
        safeName = safeName.slice(0, safeName.length - 1);
        encoded = FUND_CONFIG_PREFIX + JSON.stringify({ id, n: safeName, t: target, c: color, ic: icon, s: sortOrder });
      }
      return encoded;
    }

    function parseFundDepositRow(row) {
      const rawNote = String((row && row.note) || '').trim();
      const match = /^\[Q:([a-zA-Z0-9_-]{1,36})\]\s*(.*)$/.exec(rawNote);
      if (match) {
        return {
          fundId: match[1],
          displayNote: (match[2] || '').trim() || 'Nộp quỹ'
        };
      }
      return {
        fundId: 'default',
        displayNote: rawNote || 'Nộp quỹ'
      };
    }

    function encodeFundDepositNote(fundId, fundName, userNote) {
      const cleanId = String(fundId || 'default').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 36) || 'default';
      const fallback = `Nạp ${String(fundName || 'Quỹ').trim() || 'Quỹ'}`;
      const cleanNote = String(userNote || '').trim() || fallback;
      return (`[Q:${cleanId}] ${cleanNote}`).slice(0, 280);
    }

    function getAllLedgerRowsForFunds() {
      const v = readFinanceVaultSync();
      const rows = (Array.isArray(v.ledger) && v.ledger.length > 0) ? v.ledger : (workState.ledger || []);
      return rows.filter(l => l && !isLedgerPendingDelete(l));
    }

    function computeFundsModel(ledgerInput, monthInput) {
      const allLedger = Array.isArray(ledgerInput) ? ledgerInput : getAllLedgerRowsForFunds();
      const curMonth = monthInput || workState.month || (workState.date || state.today || new Date().toISOString().slice(0, 10)).slice(0, 7);

      const cfgMap = new Map();
      allLedger.forEach(row => {
        const parsed = parseFundConfigRow(row);
        if (!parsed) return;
        const prev = cfgMap.get(parsed.id);
        if (!prev || parsed.updatedAt > prev.updatedAt ||
          (parsed.updatedAt === prev.updatedAt && (parsed.ts > prev.ts || parsed.ledgerId > prev.ledgerId))) {
          cfgMap.set(parsed.id, parsed);
        }
      });

      let funds = Array.from(cfgMap.values()).sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        if (a.ts !== b.ts) return a.ts - b.ts;
        return a.ledgerId - b.ledgerId;
      });

      if (funds.length === 0) {
        funds = [{
          id: 'default',
          name: 'Quỹ tiết kiệm',
          target: 5000000,
          color: 'sage',
          icon: 'piggy',
          sortOrder: 0,
          isVirtual: true,
          ledgerId: 0,
          uid: 'fcfg_default',
          ts: 0,
          updatedAt: 0,
          rawRow: null
        }];
      }

      const byId = new Map();
      funds.forEach(f => {
        f.deposits = [];
        f.saved = 0;
        f.monthSaved = 0;
        byId.set(f.id, f);
      });

      const allDeposits = [];
      allLedger.forEach(row => {
        if (!row || row.category !== 'fund_in') return;
        const amt = Math.max(0, Number(row.amount) || 0);
        if (amt <= 0) return;
        const parsed = parseFundDepositRow(row);
        const owner = byId.get(parsed.fundId) || funds[0];
        const dep = {
          id: Number(row.id) || 0,
          uid: row.uid || '',
          date: row.date || '',
          amount: amt,
          note: row.note || '',
          displayNote: parsed.displayNote,
          fundId: owner.id,
          fundName: owner.name,
          fundColor: owner.color,
          ts: Number(row.ts) || 0
        };
        owner.deposits.push(dep);
        owner.saved += amt;
        if (curMonth && dep.date.startsWith(curMonth + '-')) {
          owner.monthSaved += amt;
        }
        allDeposits.push(dep);
      });

      const sortDepsDesc = (a, b) => {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        if (a.ts !== b.ts) return b.ts - a.ts;
        return b.id - a.id;
      };
      allDeposits.sort(sortDepsDesc);

      let totalSaved = 0;
      let totalTarget = 0;
      let completedCount = 0;

      funds.forEach(f => {
        f.deposits.sort(sortDepsDesc);
        f.depositCount = f.deposits.length;
        f.avgDeposit = f.depositCount > 0 ? Math.round(f.saved / f.depositCount) : 0;
        f.pctRaw = f.target > 0 ? Math.round((f.saved / f.target) * 100) : 0;
        f.pctClamped = f.target > 0 ? Math.min(100, Math.max(0, Math.round((f.saved / f.target) * 100))) : 0;
        f.remaining = Math.max(0, f.target - f.saved);
        f.excess = Math.max(0, f.saved - f.target);
        f.reachedGoal = f.target > 0 && f.saved >= f.target;
        totalSaved += f.saved;
        totalTarget += f.target;
        if (f.reachedGoal) completedCount++;
      });

      const overallPct = totalTarget > 0 ? Math.round((totalSaved / totalTarget) * 100) : 0;
      const overallPctClamped = totalTarget > 0 ? Math.min(100, Math.max(0, overallPct)) : 0;
      const totalRemaining = Math.max(0, totalTarget - totalSaved);

      return {
        funds,
        byId,
        allDeposits,
        totalSaved,
        totalTarget,
        overallPct,
        overallPctClamped,
        totalRemaining,
        fundCount: funds.length,
        completedCount
      };
    }

    function fundIconSVG(iconKey, size = 18) {
      const paths = {
        piggy: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6"/><path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/>',
        shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
        bike: '<circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm-3 11.5V14l-3-3 4-3 2 3h2"/>',
        heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
        home: '<path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1V9.5z"/>',
        gift: '<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>'
      };
      const body = paths[iconKey] || paths.piggy;
      return `<svg class="ui-inline-svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
    }

    function animateCountUp(el, fromVal, toVal, durationMs, fmtFn) {
      if (!el || typeof fmtFn !== 'function') return;
      if (prefersReducedMotion() || typeof window.requestAnimationFrame !== 'function' || fromVal === toVal) {
        el.textContent = fmtFn(toVal);
        return;
      }
      const startT = (window.performance && typeof window.performance.now === 'function')
        ? window.performance.now()
        : Date.now();
      const step = () => {
        const now = (window.performance && typeof window.performance.now === 'function')
          ? window.performance.now()
          : Date.now();
        const t = Math.min(1, Math.max(0, (now - startT) / durationMs));
        const eased = 1 - Math.pow(1 - t, 3);
        const cur = Math.round(fromVal + (toVal - fromVal) * eased);
        el.textContent = fmtFn(cur);
        if (t < 1) {
          window.requestAnimationFrame(step);
        } else {
          el.textContent = fmtFn(toVal);
        }
      };
      window.requestAnimationFrame(step);
    }

    function triggerFundCelebration(cardEl, addedAmount, crossedGoal) {
      if (!cardEl || prefersReducedMotion()) return;
      const badge = document.createElement('span');
      badge.className = 'fund-deposit-float font-tabular';
      badge.textContent = `+${formatShortK(addedAmount)}`;
      cardEl.appendChild(badge);
      setTimeout(() => badge.remove(), 950);

      const vectors = crossedGoal
        ? [[-26, -24], [24, -28], [-38, 4], [34, 8], [-16, 26], [20, 24], [0, -34], [-40, -10]]
        : [[-22, -20], [20, -24], [-28, 8], [26, 10], [0, -28]];
      vectors.forEach(([sx, sy]) => {
        const dot = document.createElement('span');
        dot.className = crossedGoal ? 'fund-sparkle-dot is-gold' : 'fund-sparkle-dot';
        dot.style.right = '44px';
        dot.style.top = '34px';
        dot.style.setProperty('--sx', `${sx}px`);
        dot.style.setProperty('--sy', `${sy}px`);
        cardEl.appendChild(dot);
        setTimeout(() => dot.remove(), 900);
      });
    }

    function buildFundHistoryRowHTML(dep) {
      const safeNote = escapeHTML(dep.displayNote || 'Nộp quỹ');
      const timeLabel = formatDayMonthTime(dep.date, dep.ts) || formatVNDate(dep.date);
      return `
        <div class="work-job-card fund-history-item-card">
          <div class="work-job-top">
            <div style="min-width: 0; flex: 1;">
              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <span class="font-tabular" style="font-size: 11.5px; color: var(--text-sub);">${escapeHTML(timeLabel)}</span>
              </div>
              <div class="work-job-cust-name work-ledger-note">${safeNote}</div>
            </div>
            <div class="work-ledger-right">
              <span class="work-job-price-val is-settled-amt font-tabular">+${formatVND(dep.amount)}</span>
              <button type="button" class="btn-job-icon btn-del" onclick="deleteFundDepositWithUndo(${Number(dep.id)})"
                aria-label="Xoá lần nạp ${safeNote} ${formatVND(dep.amount)}">Xoá</button>
            </div>
          </div>
        </div>
      `;
    }

    function renderFundsScreen() {
      const cardsList = document.getElementById('funds-cards-list');
      if (!cardsList) return;

      const model = computeFundsModel();

      const setTxt = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };

      setTxt('funds-count-sub', `${model.fundCount} quỹ`);

      const RING_CIRC = 213.63;
      cardsList.innerHTML = model.funds.map(f => {
        const safeName = escapeHTML(f.name);
        const offset = (RING_CIRC * (1 - f.pctClamped / 100)).toFixed(2);

        return `
          <div class="fund-goal-card fund-theme-${escapeHTML(f.color)}${f.reachedGoal ? ' is-goal-reached' : ''}" data-fund-card="${escapeHTML(f.id)}">
            <div class="fund-card-bg" aria-hidden="true">
              <span class="fund-card-grid-bg"></span>
              <span class="fund-card-glow"></span>
              <span class="fund-card-sheen"></span>
              <span class="fund-motes">
                <span class="fund-mote m-1"></span>
                <span class="fund-mote m-2"></span>
                <span class="fund-mote m-3"></span>
                <span class="fund-mote m-4"></span>
              </span>
            </div>
            <div class="fund-card-body">
              <div class="fund-card-top">
                <div class="fund-card-identity">
                  <div class="fund-card-icon-badge">${fundIconSVG(f.icon, 24)}</div>
                  <div class="fund-card-title-wrap">
                    <div class="fund-card-name-row">
                      <span class="fund-card-name">${safeName}</span>
                      ${f.reachedGoal ? `<span class="fund-goal-done-badge">${workIconSVG('check', 11)} Đạt đích</span>` : ''}
                    </div>
                    <div class="fund-target-pill font-tabular">
                      <svg class="fund-target-pill-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="9" />
                        <circle cx="12" cy="12" r="4" />
                      </svg>
                      <span>Mục tiêu ${formatVND(f.target)}</span>
                    </div>
                  </div>
                </div>
                <button type="button" class="btn-fund-edit-gear" onclick="openFundEditorModal('${escapeHTML(f.id)}')"
                  aria-label="Cài đặt quỹ ${safeName}" title="Cài đặt tên & mục tiêu quỹ">
                  <svg class="ui-inline-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                </button>
              </div>

              <div class="fund-hero-showcase">
                <div class="fund-hero-numbers">
                  <span class="fund-saved-eyebrow">Đã tích luỹ</span>
                  <strong class="fund-saved-val font-tabular">${formatVND(f.saved)}</strong>
                </div>
                <div class="fund-dial-wrap" aria-label="Tiến độ quỹ ${safeName}: ${f.pctRaw}%">
                  <span class="fund-dial-halo" aria-hidden="true"></span>
                  <svg class="fund-dial-svg" viewBox="0 0 88 88" aria-hidden="true">
                    <circle class="fund-dial-orbit" cx="44" cy="44" r="41" />
                    <circle class="fund-ring-track" cx="44" cy="44" r="34" />
                    <circle class="fund-ring-fill" cx="44" cy="44" r="34"
                      stroke-dasharray="${RING_CIRC}" stroke-dashoffset="${offset}" />
                  </svg>
                  <div class="fund-dial-center font-tabular">
                    <span class="fund-ring-pct">${f.pctRaw}%</span>
                    <span class="fund-dial-sub">mục tiêu</span>
                  </div>
                </div>
              </div>

              <div class="fund-card-actions">
                <button type="button" class="btn-fund-deposit-sm" onclick="openFundDepositModal('${escapeHTML(f.id)}')">
                  + Nạp quỹ
                </button>
                <button type="button" class="btn-fund-history-sm font-tabular" onclick="openFundHistoryModal('${escapeHTML(f.id)}')">
                  Lịch sử (${f.depositCount})
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('');

      // Hiệu ứng động ăn mừng vừa nạp quỹ (từ vị trí % cũ -> mới + đếm số + pháo sáng)
      const anim = fundsUIState.lastDepositAnim;
      if (anim && (Date.now() - anim.at) < 2500) {
        fundsUIState.lastDepositAnim = null;
        const targetFund = model.byId.get(anim.fundId);
        const cardEl = Array.from(cardsList.querySelectorAll('.fund-goal-card'))
          .find(el => el.getAttribute('data-fund-card') === anim.fundId);
        if (targetFund && cardEl) {
          const crossedGoal = anim.prevSaved < targetFund.target && targetFund.saved >= targetFund.target;
          if (!prefersReducedMotion()) {
            const prevPctRaw = targetFund.target > 0
              ? Math.max(0, Math.round((anim.prevSaved / targetFund.target) * 100))
              : 0;
            const prevPct = Math.min(100, prevPctRaw);
            const prevOffset = (RING_CIRC * (1 - prevPct / 100)).toFixed(2);
            const newOffset = (RING_CIRC * (1 - targetFund.pctClamped / 100)).toFixed(2);
            const ringEl = cardEl.querySelector('.fund-ring-fill');
            if (ringEl) ringEl.style.strokeDashoffset = prevOffset;
            void cardEl.offsetWidth;
            if (ringEl) ringEl.style.strokeDashoffset = newOffset;

            const savedValEl = cardEl.querySelector('.fund-saved-val');
            animateCountUp(savedValEl, anim.prevSaved, targetFund.saved, 480, formatVND);
            const pctEl = cardEl.querySelector('.fund-ring-pct');
            animateCountUp(pctEl, prevPctRaw, targetFund.pctRaw, 480, v => `${v}%`);
            cardEl.classList.add('is-just-deposited');
            setTimeout(() => cardEl.classList.remove('is-just-deposited'), 900);
          }
          triggerFundCelebration(cardEl, anim.added, crossedGoal);
        }
      }

      const histModalEl = document.getElementById('modal-fund-history');
      if (histModalEl && histModalEl.classList.contains('open') && fundsUIState.activeHistoryFundId) {
        renderFundHistoryModal();
      }
    }

    window.closeFundsFabMenu = function (opts = {}) {
      const menuEl = document.getElementById('funds-fab-menu');
      const backdropEl = document.getElementById('funds-fab-backdrop');
      const fabEl = document.getElementById('btn-fab-funds');
      const wasOpen = Boolean(menuEl && menuEl.classList.contains('open'));
      if (menuEl) {
        menuEl.classList.remove('open');
        menuEl.hidden = true;
      }
      if (backdropEl) {
        backdropEl.classList.remove('open');
      }
      if (fabEl) {
        fabEl.classList.remove('is-open');
        fabEl.setAttribute('aria-expanded', 'false');
        fabEl.setAttribute('aria-label', 'Mở tuỳ chọn thêm quỹ hoặc nạp tiền');
      }
      if (wasOpen && opts && opts.restoreFocus && fabEl && state.activeTab === 'funds') {
        fabEl.focus();
      }
    };

    window.openFundsFabMenu = function () {
      if (state.activeTab !== 'funds') return;
      const menuEl = document.getElementById('funds-fab-menu');
      const backdropEl = document.getElementById('funds-fab-backdrop');
      const fabEl = document.getElementById('btn-fab-funds');
      if (!menuEl || !fabEl) return;
      if (backdropEl) backdropEl.classList.add('open');
      menuEl.hidden = false;
      menuEl.classList.add('open');
      fabEl.classList.add('is-open');
      fabEl.setAttribute('aria-expanded', 'true');
      fabEl.setAttribute('aria-label', 'Đóng tuỳ chọn quỹ');

      const scheduleFocus = typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : (fn) => setTimeout(fn, 10);
      scheduleFocus(() => {
        const focusTarget = menuEl.querySelector('.funds-fab-item.is-primary') || menuEl.querySelector('[role="menuitem"]');
        if (focusTarget && typeof focusTarget.focus === 'function') {
          focusTarget.focus();
        }
      });
    };

    window.toggleFundsFabMenu = function () {
      const menuEl = document.getElementById('funds-fab-menu');
      if (menuEl && menuEl.classList.contains('open')) {
        window.closeFundsFabMenu();
      } else {
        window.openFundsFabMenu();
      }
    };

    window.onFundsFabMenuKeydown = function (e) {
      if (!e) return;
      const menuEl = document.getElementById('funds-fab-menu');
      if (!menuEl || !menuEl.classList.contains('open')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        window.closeFundsFabMenu({ restoreFocus: true });
        return;
      }
      if (e.key === 'Tab') {
        window.closeFundsFabMenu();
        return;
      }
      const items = Array.from(menuEl.querySelectorAll('[role="menuitem"]'));
      if (items.length === 0) return;
      const curIdx = items.indexOf(document.activeElement);
      let nextIdx = -1;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        nextIdx = curIdx >= 0 ? (curIdx + 1) % items.length : 0;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        nextIdx = curIdx >= 0 ? (curIdx - 1 + items.length) % items.length : items.length - 1;
      } else if (e.key === 'Home') {
        e.preventDefault();
        nextIdx = 0;
      } else if (e.key === 'End') {
        e.preventDefault();
        nextIdx = items.length - 1;
      }
      if (nextIdx >= 0 && items[nextIdx]) {
        items[nextIdx].focus();
      }
    };

    // --- POPUP NẠP TIỀN VÀO QUỸ ---
    function renderDepositFundChips(selectedId) {
      const wrap = document.getElementById('fund-deposit-fund-chips');
      const hidden = document.getElementById('fund-deposit-fund-id');
      const model = computeFundsModel();
      const chosen = (selectedId && model.byId.has(selectedId)) ? selectedId : model.funds[0].id;
      if (hidden) hidden.value = chosen;
      if (!wrap) return;
      wrap.innerHTML = model.funds.map(f => {
        const active = f.id === chosen;
        return `<button type="button" class="fund-filter-pill${active ? ' active' : ''}" role="radio" aria-checked="${active ? 'true' : 'false'}" onclick="selectDepositFund('${escapeHTML(f.id)}')">${escapeHTML(f.name)} (${formatShortK(f.saved)}/${formatShortK(f.target)})</button>`;
      }).join('');
    }

    window.selectDepositFund = function (fundId) {
      renderDepositFundChips(fundId);
      window.updateFundDepositPreview();
    };

    window.openFundDepositModal = function (fundId) {
      const model = computeFundsModel();
      const defaultId = (fundId && model.byId.has(fundId)) ? fundId : model.funds[0].id;

      renderDepositFundChips(defaultId);
      const dateInput = document.getElementById('fund-deposit-date');
      const amtInput = document.getElementById('fund-deposit-amount');
      const noteInput = document.getElementById('fund-deposit-note');
      if (dateInput) dateInput.value = workState.date || state.today || new Date().toISOString().slice(0, 10);
      if (amtInput) amtInput.value = '';
      if (noteInput) noteInput.value = '';
      window.updateFundDepositPreview();
      openModal('modal-fund-deposit');
      setTimeout(() => {
        if (amtInput) amtInput.focus();
      }, 80);
    };

    window.fillFundDepositToGoal = function () {
      const hidden = document.getElementById('fund-deposit-fund-id');
      const model = computeFundsModel();
      const f = (hidden && model.byId.get(hidden.value)) || model.funds[0];
      if (!f || f.remaining <= 0) return;
      const amtInput = document.getElementById('fund-deposit-amount');
      if (amtInput) {
        amtInput.value = formatMoneyInputVal(f.remaining);
      }
      window.updateFundDepositPreview();
    };

    window.setFundDepositNote = function (text) {
      const noteInput = document.getElementById('fund-deposit-note');
      if (noteInput) noteInput.value = text;
    };

    window.updateFundDepositPreview = function () {
      const hidden = document.getElementById('fund-deposit-fund-id');
      const amtInput = document.getElementById('fund-deposit-amount');
      const prevEl = document.getElementById('fund-deposit-amount-preview');
      const afterEl = document.getElementById('fund-deposit-after-preview');
      const fillWrap = document.getElementById('fund-deposit-fill-wrap');
      const fillBtn = document.getElementById('btn-fund-deposit-fill-goal');

      const model = computeFundsModel();
      const f = (hidden && model.byId.get(hidden.value)) || model.funds[0];
      const showFill = Boolean(f && f.remaining >= 1000 && f.remaining <= 500000000);

      if (fillWrap) fillWrap.hidden = !showFill;
      if (fillBtn) {
        if (showFill) {
          fillBtn.hidden = false;
          fillBtn.textContent = `Đủ mục tiêu (${formatShortK(f.remaining)})`;
        } else {
          fillBtn.hidden = true;
        }
      }

      const vnd = parseMoneyInputVND(amtInput ? amtInput.value : '');
      if (prevEl) prevEl.textContent = vnd > 0 ? ('= ' + formatVND(vnd)) : '';
      if (fillBtn && showFill) {
        fillBtn.classList.toggle('active', vnd > 0 && vnd === f.remaining);
      }
      if (afterEl && f) {
        if (vnd > 0) {
          const nextSaved = f.saved + vnd;
          const nextPct = f.target > 0 ? Math.round((nextSaved / f.target) * 100) : 0;
          afterEl.textContent = `Sau khi nạp: ${formatShortK(nextSaved)} / ${formatShortK(f.target)} (${nextPct}%)`;
        } else {
          afterEl.textContent = `Hiện có: ${formatVND(f.saved)} / ${formatVND(f.target)} (${f.pctRaw}%)`;
        }
      }
    };

    window.submitFundDeposit = async function (e) {
      e.preventDefault();
      const hidden = document.getElementById('fund-deposit-fund-id');
      const dateInput = document.getElementById('fund-deposit-date');
      const amtInput = document.getElementById('fund-deposit-amount');
      const noteInput = document.getElementById('fund-deposit-note');

      const model = computeFundsModel();
      const fund = (hidden && model.byId.get(hidden.value)) || model.funds[0];
      const amount = parseMoneyInputVND(amtInput ? amtInput.value : '');

      if (!amount || amount < 1000 || amount > 500000000) {
        showToast('Số tiền nạp phải từ 1.000đ đến 500.000.000đ (nhập 1 – 500.000)', true);
        if (amtInput) amtInput.focus();
        return;
      }

      const depositDate = (dateInput && dateInput.value) || workState.date || state.today || new Date().toISOString().slice(0, 10);
      const userNote = noteInput ? noteInput.value.trim() : '';
      const encodedNote = encodeFundDepositNote(fund.id, fund.name, userNote);
      const clientUid = genClientUID('ldg');
      const nowTs = Math.floor(Date.now() / 1000);

      fundsUIState.lastDepositAnim = {
        fundId: fund.id,
        prevSaved: fund.saved,
        added: amount,
        at: Date.now()
      };

      const bodyPayload = {
        uid: clientUid,
        date: depositDate,
        category: 'fund_in',
        amount,
        note: encodedNote,
        ts: nowTs
      };

      try {
        const res = await api('/api/work/ledger', {
          method: 'POST',
          deferQueueToast: true,
          body: JSON.stringify(bodyPayload)
        });
        if (res && typeof res.work_rev === 'number') {
          syncState.workRev = Math.max(syncState.workRev, res.work_rev);
        }
        closeModal('modal-fund-deposit');
        const reachedNow = fund.saved < fund.target && (fund.saved + amount) >= fund.target;
        showToast(reachedNow ? `Chúc mừng! "${fund.name}" đã đạt mục tiêu!` : `Đã nạp ${formatShortK(amount)} vào ${fund.name}`);
        await loadWorkData(workState.date || depositDate, { month: workState.calendarMonth });
      } catch (err) {
        if (!isQueueableSyncError(err)) return;
        const v = readFinanceVaultSync();
        v.ledger.push({
          id: Date.now(),
          uid: clientUid,
          date: depositDate,
          category: 'fund_in',
          amount,
          note: encodedNote,
          ts: nowTs,
          updated_at: nowTs
        });
        saveFinanceVaultToDevice(v);
        enqueueSyncOp({
          domain: 'work',
          op: 'work_ledger_add',
          payload: bodyPayload
        });
        closeModal('modal-fund-deposit');
        showToast(`Đã nạp ${formatShortK(amount)} vào ${fund.name} (chờ đồng bộ)`);
        computeWorkFromLocalVault(workState.date || depositDate, workState.calendarMonth);
      }
    };

    // --- POPUP TẠO / CÀI ĐẶT / XOÁ QUỸ ---
    window.updateFundTargetPreview = function () {
      const targetInp = document.getElementById('fund-edit-target');
      const prevEl = document.getElementById('fund-edit-target-preview');
      if (!prevEl) return;
      const vnd = parseMoneyInputVND(targetInp ? targetInp.value : '');
      prevEl.textContent = vnd > 0 ? ('= ' + formatVND(vnd)) : '';
    };

    window.setFundEditColor = function (color) {
      const chosen = FUND_COLORS.includes(color) ? color : 'sage';
      const hidden = document.getElementById('fund-edit-color');
      if (hidden) hidden.value = chosen;
      document.querySelectorAll('#fund-edit-color-grid .fund-color-swatch').forEach(btn => {
        const active = btn.getAttribute('data-fund-color') === chosen;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    };

    window.setFundEditIcon = function (icon) {
      const chosen = FUND_ICONS.includes(icon) ? icon : 'piggy';
      const hidden = document.getElementById('fund-edit-icon');
      if (hidden) hidden.value = chosen;
      document.querySelectorAll('#fund-edit-icon-grid .fund-icon-opt').forEach(btn => {
        const active = btn.getAttribute('data-fund-icon') === chosen;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    };

    window.openFundEditorModal = function (fundId) {
      const model = computeFundsModel();
      const existing = fundId ? model.byId.get(fundId) : null;
      const isEdit = Boolean(existing);

      const titleEl = document.getElementById('modal-fund-editor-title');
      const submitEl = document.getElementById('btn-fund-editor-submit');
      const idEl = document.getElementById('fund-edit-id');
      const nameEl = document.getElementById('fund-edit-name');
      const targetEl = document.getElementById('fund-edit-target');
      const dangerEl = document.getElementById('fund-editor-danger-zone');

      if (titleEl) titleEl.textContent = isEdit ? `Cài đặt: ${existing.name}` : 'Tạo quỹ mới';
      if (submitEl) submitEl.textContent = isEdit ? 'Lưu thay đổi' : 'Tạo quỹ mới';
      if (idEl) idEl.value = isEdit ? existing.id : '';

      if (isEdit) {
        if (nameEl) nameEl.value = existing.name;
        if (targetEl) targetEl.value = formatMoneyInputVal(existing.target);
        window.setFundEditColor(existing.color);
        window.setFundEditIcon(existing.icon);
      } else {
        if (nameEl) nameEl.value = '';
        if (targetEl) targetEl.value = '';
        const usedColors = new Set(model.funds.map(f => f.color));
        const nextColor = FUND_COLORS.find(c => !usedColors.has(c)) || FUND_COLORS[model.funds.length % FUND_COLORS.length];
        const nextIcon = FUND_ICONS[model.funds.length % FUND_ICONS.length];
        window.setFundEditColor(nextColor);
        window.setFundEditIcon(nextIcon);
      }

      if (dangerEl) {
        dangerEl.hidden = !isEdit || (existing.isVirtual && model.funds.length === 1);
      }

      window.updateFundTargetPreview();
      openModal('modal-fund-editor');
      setTimeout(() => {
        if (nameEl) nameEl.focus();
      }, 80);
    };

    window.submitFundEditor = async function (e) {
      e.preventDefault();
      const idEl = document.getElementById('fund-edit-id');
      const nameEl = document.getElementById('fund-edit-name');
      const targetEl = document.getElementById('fund-edit-target');
      const colorEl = document.getElementById('fund-edit-color');
      const iconEl = document.getElementById('fund-edit-icon');

      const name = nameEl ? nameEl.value.trim() : '';
      const target = parseMoneyInputVND(targetEl ? targetEl.value : '');

      if (!name) {
        showToast('Nhập tên quỹ trước khi lưu', true);
        if (nameEl) nameEl.focus();
        return;
      }
      if (!target || target < 1000 || target > 500000000) {
        showToast('Mục tiêu quỹ phải từ 1.000đ đến 500.000.000đ (nhập 1 – 500.000)', true);
        if (targetEl) targetEl.focus();
        return;
      }

      const model = computeFundsModel();
      const editId = idEl ? idEl.value.trim() : '';
      const existing = editId ? model.byId.get(editId) : null;
      const fundId = existing ? existing.id : ('f_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 5));
      const color = colorEl ? colorEl.value : 'sage';
      const icon = iconEl ? iconEl.value : 'piggy';
      const sortOrder = existing
        ? existing.sortOrder
        : (model.funds.reduce((mx, x) => Math.max(mx, x.sortOrder || 0), -1) + 1);
      const nowSec = Math.floor(Date.now() / 1000);
      const prevUpd = existing ? Math.max(existing.updatedAt || 0, existing.ts || 0) : 0;
      const updatedAt = Math.max(prevUpd + 1, nowSec);
      const cfgUid = (existing && existing.uid) || ('fcfg_' + fundId);
      const encodedNote = encodeFundConfigNote({ id: fundId, name, target, color, icon, sortOrder });

      const cfgRow = {
        uid: cfgUid,
        date: FUND_CONFIG_DATE,
        category: 'fund_bal',
        amount: target,
        note: encodedNote,
        ts: (existing && existing.ts > 0) ? existing.ts : nowSec,
        updated_at: updatedAt
      };

      try {
        const res = await api('/api/work/vault', {
          method: 'POST',
          deferQueueToast: true,
          body: JSON.stringify({
            mode: 'merge',
            jobs: [],
            ledger: [cfgRow],
            tombstones: []
          })
        });
        if (res && typeof res.work_rev === 'number') {
          syncState.workRev = Math.max(syncState.workRev, res.work_rev);
        }
        const curVault = readFinanceVaultSync();
        saveFinanceVaultToDevice({
          db_id: res.db_id || curVault.db_id,
          dirty: false,
          jobs: Array.isArray(res.jobs) ? res.jobs : curVault.jobs,
          ledger: Array.isArray(res.ledger) ? res.ledger : curVault.ledger,
          tombstones: Array.isArray(res.tombstones) ? res.tombstones : curVault.tombstones
        });
        closeModal('modal-fund-editor');
        showToast(existing ? `Đã cập nhật quỹ "${name}"` : `Đã tạo quỹ "${name}"`);
        computeWorkFromLocalVault(workState.date, workState.calendarMonth);
      } catch (err) {
        if (!isQueueableSyncError(err)) return;
        const v = readFinanceVaultSync();
        const idx = (v.ledger || []).findIndex(l => l && l.uid === cfgUid);
        const localRow = Object.assign({ id: (existing && existing.ledgerId) || Date.now() }, cfgRow);
        if (idx >= 0) v.ledger[idx] = Object.assign({}, v.ledger[idx], localRow);
        else v.ledger.push(localRow);
        saveFinanceVaultToDevice(v);
        enqueueSyncOp({
          domain: 'work',
          op: 'work_fund_upsert',
          payload: cfgRow
        });
        closeModal('modal-fund-editor');
        showToast(existing ? `Đã cập nhật "${name}" (chờ đồng bộ)` : `Đã tạo "${name}" trên máy này (chờ đồng bộ)`);
        computeWorkFromLocalVault(workState.date, workState.calendarMonth);
      }
    };

    window.deleteFundFromEditor = async function () {
      const idEl = document.getElementById('fund-edit-id');
      const fundId = idEl ? idEl.value.trim() : '';
      if (!fundId) return;

      const model = computeFundsModel();
      const fund = model.byId.get(fundId);
      if (!fund || (fund.isVirtual && model.funds.length === 1)) return;

      const msg = fund.depositCount > 0
        ? `Xoá quỹ "${fund.name}" cùng ${fund.depositCount} lần nạp (${formatVND(fund.saved)})? Thao tác này không thể hoàn tác.`
        : `Xoá quỹ "${fund.name}"? Thao tác này không thể hoàn tác.`;
      if (!confirm(msg)) return;

      const targets = [];
      fund.deposits.forEach(dep => {
        const raw = findLedgerItemById(dep.id);
        targets.push(raw || {
          id: dep.id,
          uid: dep.uid,
          date: dep.date,
          category: 'fund_in',
          amount: dep.amount,
          note: dep.note,
          ts: dep.ts
        });
      });
      if (!fund.isVirtual && fund.rawRow) {
        targets.push(fund.rawRow);
      }

      targets.forEach(item => {
        const key = item.uid || ('id:' + item.id);
        const pending = pendingLedgerDeletes.get(key);
        if (pending) {
          pending.committed = true;
          pendingLedgerDeletes.delete(key);
          if (pending.toastHandle && typeof pending.toastHandle.dismiss === 'function') {
            pending.toastHandle.dismiss('commit');
          }
        }
      });

      let queuedCount = 0;
      for (const item of targets) {
        const ldgId = Number(item.id) || 0;
        const ldgUid = item.uid || '';
        const ldgSig = computeWorkLedgerSig(item);
        const qs = `?uid=${encodeURIComponent(ldgUid)}&sig=${encodeURIComponent(ldgSig)}`;
        removeLedgerFromLocalVault(ldgId, { dirty: false, tombstone: true });
        try {
          const res = await api('/api/work/ledger/' + ldgId + qs, { method: 'DELETE', deferQueueToast: true, silent: true });
          if (res && typeof res.work_rev === 'number') {
            syncState.workRev = Math.max(syncState.workRev, res.work_rev);
          }
        } catch (err) {
          if (isQueueableSyncError(err)) {
            queuedCount++;
            enqueueSyncOp({
              domain: 'work',
              op: 'work_ledger_del',
              target_id: ldgId,
              target_uid: ldgUid,
              sig: ldgSig
            });
          }
        }
      }

      closeModal('modal-fund-editor');
      if (fundsUIState.activeHistoryFundId === fund.id) {
        fundsUIState.activeHistoryFundId = '';
        closeModal('modal-fund-history');
      }
      showToast(queuedCount > 0 ? `Đã xoá quỹ "${fund.name}" (chờ đồng bộ)` : `Đã xoá quỹ "${fund.name}"`);
      if (queuedCount === 0) {
        await loadWorkData(workState.date, { silent: true });
      } else {
        computeWorkFromLocalVault(workState.date, workState.calendarMonth);
      }
    };

    // --- POPUP LỊCH SỬ NẠP CỦA TỪNG QUỸ ---
    function renderFundHistoryModal() {
      const model = computeFundsModel();
      const fund = model.byId.get(fundsUIState.activeHistoryFundId) || model.funds[0];
      if (!fund) return;
      fundsUIState.activeHistoryFundId = fund.id;

      const titleEl = document.getElementById('fund-history-modal-title');
      if (titleEl) titleEl.textContent = `Lịch sử: ${fund.name}`;

      const curMonth = workState.month || (workState.date || state.today || new Date().toISOString().slice(0, 10)).slice(0, 7);
      const monthDeps = fund.deposits.filter(d => curMonth && d.date.startsWith(curMonth + '-'));
      const scope = fundsUIState.historyModalScope === 'month' ? 'month' : 'all';

      const setTxt = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };
      setTxt('fund-hist-cnt-all', String(fund.deposits.length));
      setTxt('fund-hist-cnt-month', String(monthDeps.length));

      document.querySelectorAll('#fund-history-scope-tabs .borrow-filter-pill').forEach(btn => {
        const act = btn.getAttribute('data-scope') === scope;
        btn.classList.toggle('active', act);
        btn.setAttribute('aria-selected', act ? 'true' : 'false');
      });

      const summaryEl = document.getElementById('fund-history-modal-summary');
      if (summaryEl) {
        summaryEl.innerHTML = `
          <div class="work-bank-header-row" style="margin-bottom: 6px;">
            <span style="font-size: 13px; font-weight: 800; color: var(--text-main);">Đã tích luỹ: <span class="font-tabular">${formatVND(fund.saved)}</span></span>
            <span class="work-job-count-pill font-tabular">${fund.pctRaw}%</span>
          </div>
          <div class="fund-progress-track" style="margin-bottom: 8px;" aria-hidden="true">
            <div class="fund-progress-fill" style="width: ${fund.pctClamped}%;"></div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; color: var(--text-sub);">
            <span class="font-tabular">Mục tiêu ${formatShortK(fund.target)} &bull; Trung bình ${formatShortK(fund.avgDeposit)}/lần</span>
            <button type="button" class="btn-green-pill btn-sm" onclick="closeModal('modal-fund-history'); openFundDepositModal('${escapeHTML(fund.id)}')">+ Nạp thêm</button>
          </div>
        `;
      }

      const listEl = document.getElementById('fund-history-modal-list');
      if (!listEl) return;
      const items = scope === 'month' ? monthDeps : fund.deposits;
      if (items.length === 0) {
        listEl.innerHTML = `<div class="empty-state-box">${scope === 'month' ? 'Tháng này chưa có lần nạp nào cho quỹ này.' : 'Chưa có lần nạp nào cho quỹ này.'}</div>`;
        return;
      }
      listEl.innerHTML = items.map(dep => buildFundHistoryRowHTML(dep)).join('');
    }

    window.setFundHistoryModalScope = function (scope) {
      fundsUIState.historyModalScope = scope === 'month' ? 'month' : 'all';
      renderFundHistoryModal();
    };

    window.openFundHistoryModal = function (fundId) {
      fundsUIState.activeHistoryFundId = fundId || '';
      fundsUIState.historyModalScope = 'all';
      renderFundHistoryModal();
      openModal('modal-fund-history');
    };

    let activeRepayLedgerId = null;
    let repaySubmitting = false;

    function setInstallmentError(inputId, errId, afterId, msg) {
      const errEl = document.getElementById(errId);
      const amtInput = document.getElementById(inputId);
      if (errEl) {
        if (msg) {
          errEl.textContent = msg;
          errEl.style.display = 'block';
        } else {
          errEl.textContent = '';
          errEl.style.display = 'none';
        }
      }
      if (amtInput) {
        if (msg) {
          amtInput.setAttribute('aria-invalid', 'true');
          amtInput.setAttribute('aria-describedby', errId);
        } else {
          amtInput.removeAttribute('aria-invalid');
          amtInput.setAttribute('aria-describedby', afterId);
        }
      }
    }

    function setRepayAmountError(msg) {
      setInstallmentError('repay-amount', 'repay-amount-error', 'repay-amount-after', msg);
    }

    function buildInstallmentChipsHTML(remaining, onClickFnName) {
      if (remaining <= 0) return '';
      return `<button type="button" class="btn-price-chip is-pay-all" data-vnd="${remaining}" onclick="${onClickFnName}(${remaining})">Trả hết (${escapeHTML(formatShortK(remaining))})</button>`;
    }

    function computeInstallmentAfterText(amount, remaining) {
      if (amount > remaining) {
        return `Sau khi trả: Đã trả xong (trả thừa +${formatVND(amount - remaining)})`;
      }
      if (amount === remaining) {
        return 'Trả đủ — cập nhật trạng thái: Đã trả xong (còn nợ 0đ)';
      }
      return `Sau khi trả sẽ còn nợ: ${formatVND(remaining - amount)}`;
    }

    function applyInstallmentQuickAmount(inputId, vnd, previewFn) {
      const input = document.getElementById(inputId);
      if (!input) return;
      const formatted = formatMoneyInputVal(vnd);
      if (!formatted) return;
      input.value = formatted;
      previewFn();
    }

    function updateInstallmentPreview({ inputId, previewId, afterId, errId, chipsSelector, remaining }) {
      const amtInput = document.getElementById(inputId);
      const previewEl = document.getElementById(previewId);
      const afterEl = document.getElementById(afterId);
      const rawStr = amtInput ? amtInput.value.trim() : '';
      const chips = document.querySelectorAll(chipsSelector);

      if (!rawStr) {
        if (previewEl) previewEl.textContent = '';
        if (afterEl) afterEl.textContent = '';
        setInstallmentError(inputId, errId, afterId, '');
        chips.forEach(c => c.classList.remove('active'));
        return 0;
      }

      const amount = parseMoneyInputVND(rawStr);
      chips.forEach(c => {
        c.classList.toggle('active', Number(c.getAttribute('data-vnd')) === amount);
      });

      if (amount <= 0 || (amount < 1000 && !(remaining > 0 && remaining < 1000 && amount === remaining))) {
        if (previewEl) previewEl.textContent = amount > 0 ? ('= ' + formatVND(amount)) : '';
        if (afterEl) afterEl.textContent = '';
        setInstallmentError(inputId, errId, afterId, 'Số tiền trả phải từ 1.000đ trở lên.');
        return 0;
      }

      if (previewEl) previewEl.textContent = '= ' + formatVND(amount);
      setInstallmentError(inputId, errId, afterId, '');
      if (afterEl) afterEl.textContent = computeInstallmentAfterText(amount, remaining);
      return amount;
    }

    function buildInstallmentHistoryHTML(installments, fallbackDate, deleteFnName, targetId, emptyMsg) {
      const list = Array.isArray(installments) ? installments : [];
      if (list.length === 0) {
        return `<div class="repay-history-empty">${escapeHTML(emptyMsg)}</div>`;
      }
      return list.map((r, idx) => {
        const dateLabel = formatDayMonthTime(r.date || fallbackDate || workState.date, r.ts);
        const rNote = (r.note || '').trim();
        return `
          <div class="repay-history-row">
            <div class="repay-history-info">
              <div class="repay-history-date font-tabular">Lần ${idx + 1} &bull; ${escapeHTML(dateLabel)}</div>
              ${rNote ? `<div class="repay-history-note">${escapeHTML(rNote)}</div>` : ''}
            </div>
            <div class="repay-history-right font-tabular">
              <span class="repay-history-amt">-${formatVND(r.amount)}</span>
              <button type="button" class="btn-job-icon btn-del" onclick="${deleteFnName}(${Number(r.id)}, ${Number(targetId)})" aria-label="Xoá lần trả ${idx + 1} ngày ${escapeHTML(formatDayMonth(r.date))}">Xoá</button>
            </div>
          </div>
        `;
      }).join('');
    }

    function renderRepayBorrowModal(item) {
      const { orig, paid, remaining, overpaid, repayments } = getBorrowTotals(item);
      const isSettled = remaining <= 0 && orig > 0;

      const setTxt = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };

      activeRepayLedgerId = Number(item.id);
      const hiddenId = document.getElementById('repay-ledger-id');
      if (hiddenId) hiddenId.value = String(item.id);

      setTxt('repay-borrow-note', item.note || 'Khoản mượn');
      setTxt('repay-borrow-date', `Mượn ngày ${formatVNDate(item.date || workState.date)}`);
      setTxt('repay-orig-amount', formatVND(orig));
      setTxt('repay-paid-amount', formatVND(paid));
      setTxt('repay-rem-amount', formatVND(remaining));

      const remEl = document.getElementById('repay-rem-amount');
      if (remEl) {
        remEl.classList.toggle('is-paid', isSettled);
        remEl.classList.toggle('is-remaining', !isSettled);
      }

      const settledBanner = document.getElementById('repay-settled-banner');
      const settledTxt = document.getElementById('repay-settled-text');
      const formEl = document.getElementById('borrow-repay-form');
      if (settledBanner) settledBanner.style.display = isSettled ? 'flex' : 'none';
      if (settledTxt) {
        settledTxt.textContent = overpaid > 0
          ? `Khoản mượn này đã trả xong (trả thừa +${formatVND(overpaid)}).`
          : 'Khoản mượn này đã trả xong.';
      }
      if (formEl) formEl.style.display = isSettled ? 'none' : 'block';

      const chipsEl = document.getElementById('repay-quick-chips');
      if (chipsEl) {
        chipsEl.hidden = isSettled;
        chipsEl.innerHTML = isSettled ? '' : buildInstallmentChipsHTML(remaining, 'setBorrowRepayAmount');
      }

      const countEl = document.getElementById('repay-history-count');
      if (countEl) countEl.textContent = `${repayments.length} lần`;

      const histEl = document.getElementById('repay-history-list');
      if (histEl) {
        histEl.innerHTML = buildInstallmentHistoryHTML(
          repayments,
          item.date,
          'deleteBorrowRepayment',
          item.id,
          'Chưa có lần trả tiền nào cho khoản mượn này.'
        );
      }
    }

    window.openRepayBorrowModal = function (ledgerId) {
      const item = findBorrowLedgerItem(ledgerId);
      if (!item) {
        showToast('Không tìm thấy khoản mượn này', true);
        return;
      }

      const amtInput = document.getElementById('repay-amount');
      const dateInput = document.getElementById('repay-date');
      const noteInput = document.getElementById('repay-note');
      const previewEl = document.getElementById('repay-amount-preview');
      const afterEl = document.getElementById('repay-amount-after');

      if (amtInput) amtInput.value = '';
      if (noteInput) noteInput.value = '';
      if (dateInput) dateInput.value = workState.date || state.today || new Date().toISOString().slice(0, 10);
      if (previewEl) previewEl.textContent = '';
      if (afterEl) afterEl.textContent = '';
      setRepayAmountError('');

      renderRepayBorrowModal(item);
      openModal('modal-repay-borrow');

      const { remaining } = getBorrowTotals(item);
      if (remaining > 0 && amtInput) {
        setTimeout(() => amtInput.focus(), 80);
      } else {
        const closeBtn = document.querySelector('#modal-repay-borrow .modal-close');
        if (closeBtn) setTimeout(() => closeBtn.focus(), 80);
      }
    };

    window.setBorrowRepayAmount = function (vnd) {
      applyInstallmentQuickAmount('repay-amount', vnd, window.updateBorrowRepayPreview);
    };

    window.updateBorrowRepayPreview = function () {
      const idEl = document.getElementById('repay-ledger-id');
      const ledgerId = Number((idEl && idEl.value) || activeRepayLedgerId);
      const item = findBorrowLedgerItem(ledgerId);
      const remaining = item ? getBorrowTotals(item).remaining : 0;

      return updateInstallmentPreview({
        inputId: 'repay-amount',
        previewId: 'repay-amount-preview',
        afterId: 'repay-amount-after',
        errId: 'repay-amount-error',
        chipsSelector: '#repay-quick-chips .btn-price-chip',
        remaining
      });
    };

    window.submitBorrowRepayment = async function (e) {
      e.preventDefault();
      if (repaySubmitting) return;

      const idEl = document.getElementById('repay-ledger-id');
      const ledgerId = Number((idEl && idEl.value) || activeRepayLedgerId);
      const item = findBorrowLedgerItem(ledgerId);
      if (!item) {
        showToast('Không tìm thấy khoản mượn', true);
        return;
      }

      const { remaining } = getBorrowTotals(item);
      const amtInput = document.getElementById('repay-amount');
      const amount = updateBorrowRepayPreview();
      if (!amount || amount <= 0) {
        if (amtInput && !amtInput.value.trim()) {
          setRepayAmountError('Nhập số tiền trả lần này (ví dụ: 500 = 500.000đ).');
        }
        if (amtInput) amtInput.focus();
        return;
      }

      const repayDate = ((document.getElementById('repay-date') || {}).value || '').trim()
        || workState.date
        || state.today
        || new Date().toISOString().slice(0, 10);
      const note = ((document.getElementById('repay-note') || {}).value || '').trim();

      const submitBtn = document.getElementById('btn-repay-submit');
      repaySubmitting = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Đang lưu...';
      }

      const resetFormFields = () => {
        if (amtInput) amtInput.value = '';
        const noteEl = document.getElementById('repay-note');
        if (noteEl) noteEl.value = '';
        const prevEl = document.getElementById('repay-amount-preview');
        if (prevEl) prevEl.textContent = '';
        const afterEl = document.getElementById('repay-amount-after');
        if (afterEl) afterEl.textContent = '';
        setRepayAmountError('');
      };

      const overAmt = Math.max(0, amount - remaining);
      const borrowItem = findBorrowLedgerItem(ledgerId);
      const ledgerUid = borrowItem && borrowItem.uid ? borrowItem.uid : '';
      const repUid = genClientUID('lrep');
      const nowTs = Math.floor(Date.now() / 1000);
      const bodyPayload = {
        uid: repUid,
        ledger_uid: ledgerUid || undefined,
        date: repayDate,
        amount,
        note,
        ts: nowTs
      };
      const qs = ledgerUid ? `?ledger_uid=${encodeURIComponent(ledgerUid)}` : '';
      try {
        const res = await api(`/api/work/ledger/${ledgerId}/repay${qs}`, {
          method: 'POST',
          deferQueueToast: true,
          body: JSON.stringify(bodyPayload)
        });
        if (res && typeof res.work_rev === 'number') {
          syncState.workRev = Math.max(syncState.workRev, res.work_rev);
        }
        if (res && res.repayment) {
          addRepaymentToLocalVault(ledgerId, res.repayment, { dirty: false });
        }
        resetFormFields();
        const nextRem = typeof (res && res.remaining_amount) === 'number'
          ? res.remaining_amount
          : Math.max(0, remaining - amount);
        const srvOver = typeof (res && res.overpaid_amount) === 'number' ? res.overpaid_amount : overAmt;
        showToast(nextRem === 0
          ? (srvOver > 0 ? `Đã trả xong (thừa +${formatShortK(srvOver)})` : `Đã trả xong (${formatShortK(amount)})`)
          : `Đã trả ${formatShortK(amount)} • Còn nợ ${formatShortK(nextRem)}`);
        await loadWorkData(workState.date);
        const refreshed = findBorrowLedgerItem(ledgerId);
        if (refreshed) {
          renderRepayBorrowModal(refreshed);
          if (getBorrowTotals(refreshed).remaining <= 0) {
            const closeBtn = document.querySelector('#modal-repay-borrow .modal-close');
            if (closeBtn) closeBtn.focus();
          }
        }
      } catch (err) {
        if (!isQueueableSyncError(err)) {
          setRepayAmountError(err.message || 'Không thể lưu lần trả tiền này');
          return;
        }
        const offlineRep = {
          id: Date.now(),
          uid: repUid,
          ledger_id: ledgerId,
          date: repayDate,
          amount,
          note,
          ts: nowTs
        };
        addRepaymentToLocalVault(ledgerId, offlineRep, { dirty: false });
        enqueueSyncOp({
          domain: 'work',
          op: 'work_repay_add',
          ledger_id: Number(ledgerId) || 0,
          ledger_uid: ledgerUid,
          payload: bodyPayload
        });
        resetFormFields();
        const nextRem = Math.max(0, remaining - amount);
        showToast(nextRem === 0
          ? (overAmt > 0 ? `Đã trả xong, thừa +${formatShortK(overAmt)} (chờ đồng bộ)` : 'Đã trả xong (lưu trên máy, chờ đồng bộ)')
          : `Đã lưu trả ${formatShortK(amount)} trên máy (chờ đồng bộ)`);
        computeWorkFromLocalVault(workState.date);
        const refreshed = findBorrowLedgerItem(ledgerId);
        if (refreshed) {
          renderRepayBorrowModal(refreshed);
          if (getBorrowTotals(refreshed).remaining <= 0) {
            const closeBtn = document.querySelector('#modal-repay-borrow .modal-close');
            if (closeBtn) closeBtn.focus();
          }
        }
      } finally {
        repaySubmitting = false;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Xác nhận trả tiền';
        }
      }
    };

    window.deleteBorrowRepayment = async function (repaymentId, ledgerId) {
      if (!confirm('Hoàn tác lần trả tiền này? Số tiền nợ còn lại sẽ được cộng lại tương ứng.')) return;
      const targetLedgerId = Number(ledgerId || activeRepayLedgerId);
      const borrowItem = targetLedgerId ? findBorrowLedgerItem(targetLedgerId) : null;
      const repItem = borrowItem && Array.isArray(borrowItem.repayments)
        ? borrowItem.repayments.find(r => Number(r.id) === Number(repaymentId))
        : null;
      const repUid = repItem && repItem.uid ? repItem.uid : '';
      const repSig = computeInstallmentSig(repItem);
      const qs = `?uid=${encodeURIComponent(repUid)}&sig=${encodeURIComponent(repSig)}`;
      try {
        const res = await api('/api/work/repayment/' + repaymentId + qs, { method: 'DELETE', deferQueueToast: true });
        if (res && typeof res.work_rev === 'number') {
          syncState.workRev = Math.max(syncState.workRev, res.work_rev);
        }
        removeRepaymentFromLocalVault(repaymentId, { dirty: false, tombstone: true });
        showToast('Đã xoá lần trả tiền');
        await loadWorkData(workState.date);
      } catch (err) {
        if (!isQueueableSyncError(err)) return;
        removeRepaymentFromLocalVault(repaymentId, { dirty: false, tombstone: true });
        enqueueSyncOp({
          domain: 'work',
          op: 'work_repay_del',
          target_id: Number(repaymentId) || 0,
          target_uid: repUid,
          sig: repSig
        });
        showToast('Đã xoá lần trả tiền trên máy (chờ đồng bộ)');
        computeWorkFromLocalVault(workState.date);
      }

      const modalEl = document.getElementById('modal-repay-borrow');
      if (modalEl && modalEl.classList.contains('open') && targetLedgerId) {
        const refreshed = findBorrowLedgerItem(targetLedgerId);
        if (refreshed) renderRepayBorrowModal(refreshed);
      }
    };

    window.deleteBorrowFromRepayModal = async function () {
      const idEl = document.getElementById('repay-ledger-id');
      const ledgerId = Number((idEl && idEl.value) || activeRepayLedgerId);
      if (!ledgerId) return;
      await window.deleteWorkLedger(ledgerId, { isBorrow: true, closeRepayModal: true });
    };

    window.deleteWorkLedger = async function (id, opts = {}) {
      const msg = opts.isBorrow
        ? 'Xoá toàn bộ khoản mượn này và tất cả các lần trả tiền đã lưu?'
        : 'Xoá khoản mục thu chi này?';
      if (!confirm(msg)) return;
      const existing = findLedgerItemById(id);
      const ldgUid = existing && existing.uid ? existing.uid : '';
      const ldgSig = computeWorkLedgerSig(existing);
      const qs = `?uid=${encodeURIComponent(ldgUid)}&sig=${encodeURIComponent(ldgSig)}`;
      try {
        const res = await api('/api/work/ledger/' + id + qs, { method: 'DELETE', deferQueueToast: true });
        if (res && typeof res.work_rev === 'number') {
          syncState.workRev = Math.max(syncState.workRev, res.work_rev);
        }
        removeLedgerFromLocalVault(id, { dirty: false, tombstone: true });
        if (opts.closeRepayModal) closeModal('modal-repay-borrow');
        showToast(opts.isBorrow ? 'Đã xoá khoản mượn' : 'Đã xoá khoản mục');
        await loadWorkData(workState.date);
      } catch (err) {
        if (!isQueueableSyncError(err)) return;
        removeLedgerFromLocalVault(id, { dirty: false, tombstone: true });
        enqueueSyncOp({
          domain: 'work',
          op: 'work_ledger_del',
          target_id: Number(id) || 0,
          target_uid: ldgUid,
          sig: ldgSig
        });
        if (opts.closeRepayModal) closeModal('modal-repay-borrow');
        showToast(opts.isBorrow ? 'Đã xoá khoản mượn trên máy (chờ đồng bộ)' : 'Đã xoá khoản mục trên máy (chờ đồng bộ)');
        computeWorkFromLocalVault(workState.date);
      }
    };

    // ================= TRẢ NHIỀU LẦN & LỊCH SỬ CHO SỔ NỢ KHÁCH HÀNG =================
    let activeDebtJobId = null;
    let debtPaySubmitting = false;

    function setDebtPayAmountError(msg) {
      setInstallmentError('debt-pay-amount', 'debt-pay-amount-error', 'debt-pay-amount-after', msg);
    }

    function renderDebtPayModal(job) {
      const { orig, paid, remaining, overpaid, payments } = getDebtJobTotals(job);
      const isSettled = remaining <= 0 && orig > 0;

      const setTxt = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };

      activeDebtJobId = Number(job.id);
      const hiddenId = document.getElementById('debt-pay-job-id');
      if (hiddenId) hiddenId.value = String(job.id);

      setTxt('debt-pay-job-title', `${job.customer || 'Khách hàng'} — ${job.service || 'Đơn nợ'}`);
      setTxt('debt-pay-job-date', `Đơn ngày ${formatVNDate(job.date || workState.date)}`);
      setTxt('debt-pay-orig-amount', formatVND(orig));
      setTxt('debt-pay-paid-amount', formatVND(paid));
      setTxt('debt-pay-rem-amount', formatVND(remaining));

      const remEl = document.getElementById('debt-pay-rem-amount');
      if (remEl) {
        remEl.classList.toggle('is-paid', isSettled);
        remEl.classList.toggle('is-remaining', !isSettled);
      }

      const settledBanner = document.getElementById('debt-pay-settled-banner');
      const settledTxt = document.getElementById('debt-pay-settled-text');
      const formEl = document.getElementById('debt-job-pay-form');
      if (settledBanner) settledBanner.style.display = isSettled ? 'flex' : 'none';
      if (settledTxt) {
        settledTxt.textContent = overpaid > 0
          ? `Đơn nợ này đã trả xong (trả thừa +${formatVND(overpaid)}).`
          : 'Đơn nợ này đã trả xong.';
      }
      if (formEl) formEl.style.display = isSettled ? 'none' : 'block';

      const chipsEl = document.getElementById('debt-pay-quick-chips');
      if (chipsEl) {
        chipsEl.hidden = isSettled;
        chipsEl.innerHTML = isSettled ? '' : buildInstallmentChipsHTML(remaining, 'setDebtPayAmount');
      }

      const countEl = document.getElementById('debt-pay-history-count');
      if (countEl) countEl.textContent = `${payments.length} lần`;

      const histEl = document.getElementById('debt-pay-history-list');
      if (histEl) {
        histEl.innerHTML = buildInstallmentHistoryHTML(
          payments,
          job.date,
          'deleteDebtJobPayment',
          job.id,
          'Chưa có lần trả tiền nào cho đơn nợ này.'
        );
      }
    }

    window.openDebtJobPayModal = function (jobId) {
      const job = findDebtJobById(jobId);
      if (!job) {
        showToast('Không tìm thấy đơn nợ này', true);
        return;
      }

      const amtInput = document.getElementById('debt-pay-amount');
      const dateInput = document.getElementById('debt-pay-date');
      const noteInput = document.getElementById('debt-pay-note');
      const previewEl = document.getElementById('debt-pay-amount-preview');
      const afterEl = document.getElementById('debt-pay-amount-after');

      if (amtInput) amtInput.value = '';
      if (noteInput) noteInput.value = '';
      if (dateInput) dateInput.value = workState.date || state.today || new Date().toISOString().slice(0, 10);
      if (previewEl) previewEl.textContent = '';
      if (afterEl) afterEl.textContent = '';
      setDebtPayAmountError('');

      renderDebtPayModal(job);
      openModal('modal-pay-debt-job');

      const { remaining } = getDebtJobTotals(job);
      if (remaining > 0 && amtInput) {
        setTimeout(() => amtInput.focus(), 80);
      } else {
        const closeBtn = document.querySelector('#modal-pay-debt-job .modal-close');
        if (closeBtn) setTimeout(() => closeBtn.focus(), 80);
      }
    };

    window.setDebtPayAmount = function (vnd) {
      applyInstallmentQuickAmount('debt-pay-amount', vnd, window.updateDebtPayPreview);
    };

    window.updateDebtPayPreview = function () {
      const idEl = document.getElementById('debt-pay-job-id');
      const jobId = Number((idEl && idEl.value) || activeDebtJobId);
      const job = findDebtJobById(jobId);
      const remaining = job ? getDebtJobTotals(job).remaining : 0;

      return updateInstallmentPreview({
        inputId: 'debt-pay-amount',
        previewId: 'debt-pay-amount-preview',
        afterId: 'debt-pay-amount-after',
        errId: 'debt-pay-amount-error',
        chipsSelector: '#debt-pay-quick-chips .btn-price-chip',
        remaining
      });
    };

    window.submitDebtJobPayment = async function (e) {
      e.preventDefault();
      if (debtPaySubmitting) return;

      const idEl = document.getElementById('debt-pay-job-id');
      const jobId = Number((idEl && idEl.value) || activeDebtJobId);
      const job = findDebtJobById(jobId);
      if (!job) {
        showToast('Không tìm thấy đơn nợ này', true);
        return;
      }

      const { remaining } = getDebtJobTotals(job);
      const amtInput = document.getElementById('debt-pay-amount');
      const amount = updateDebtPayPreview();
      if (!amount || amount <= 0) {
        if (amtInput && !amtInput.value.trim()) {
          setDebtPayAmountError('Nhập số tiền trả lần này (ví dụ: 500 = 500.000đ).');
        }
        if (amtInput) amtInput.focus();
        return;
      }

      const payDate = ((document.getElementById('debt-pay-date') || {}).value || '').trim()
        || workState.date
        || state.today
        || new Date().toISOString().slice(0, 10);
      const note = ((document.getElementById('debt-pay-note') || {}).value || '').trim();

      const submitBtn = document.getElementById('btn-debt-pay-submit');
      debtPaySubmitting = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Đang lưu...';
      }

      const resetFormFields = () => {
        if (amtInput) amtInput.value = '';
        const noteEl = document.getElementById('debt-pay-note');
        if (noteEl) noteEl.value = '';
        const prevEl = document.getElementById('debt-pay-amount-preview');
        if (prevEl) prevEl.textContent = '';
        const afterEl = document.getElementById('debt-pay-amount-after');
        if (afterEl) afterEl.textContent = '';
        setDebtPayAmountError('');
      };

      const overAmt = Math.max(0, amount - remaining);
      const debtJob = findDebtJobById(jobId);
      const jobUid = debtJob && debtJob.uid ? debtJob.uid : '';
      const payUid = genClientUID('jpay');
      const nowTs = Math.floor(Date.now() / 1000);
      const bodyPayload = {
        uid: payUid,
        job_uid: jobUid || undefined,
        date: payDate,
        amount,
        note,
        ts: nowTs
      };
      const qs = jobUid ? `?job_uid=${encodeURIComponent(jobUid)}` : '';
      try {
        const res = await api(`/api/work/job/${jobId}/pay${qs}`, {
          method: 'POST',
          deferQueueToast: true,
          body: JSON.stringify(bodyPayload)
        });
        if (res && typeof res.work_rev === 'number') {
          syncState.workRev = Math.max(syncState.workRev, res.work_rev);
        }
        if (res && res.payment) {
          addJobPaymentToLocalVault(jobId, res.payment, { dirty: false });
        }
        resetFormFields();
        const nextRem = typeof (res && res.remaining_amount) === 'number'
          ? res.remaining_amount
          : Math.max(0, remaining - amount);
        const srvOver = typeof (res && res.overpaid_amount) === 'number' ? res.overpaid_amount : overAmt;
        showToast(nextRem === 0
          ? (srvOver > 0 ? `Đã trả xong đơn nợ (thừa +${formatShortK(srvOver)})` : `Đã trả xong đơn nợ (${formatShortK(amount)})`)
          : `Đã trả ${formatShortK(amount)} • Còn nợ ${formatShortK(nextRem)}`);
        await loadWorkData(workState.date);
        const refreshed = findDebtJobById(jobId);
        if (refreshed) {
          renderDebtPayModal(refreshed);
          if (getDebtJobTotals(refreshed).remaining <= 0) {
            const closeBtn = document.querySelector('#modal-pay-debt-job .modal-close');
            if (closeBtn) closeBtn.focus();
          }
        }
      } catch (err) {
        if (!isQueueableSyncError(err)) {
          setDebtPayAmountError(err.message || 'Không thể lưu lần trả tiền này');
          return;
        }
        const offlinePay = {
          id: Date.now(),
          uid: payUid,
          job_id: jobId,
          date: payDate,
          amount,
          note,
          ts: nowTs
        };
        addJobPaymentToLocalVault(jobId, offlinePay, { dirty: false });
        enqueueSyncOp({
          domain: 'work',
          op: 'work_job_pay',
          job_id: Number(jobId) || 0,
          job_uid: jobUid,
          payload: bodyPayload
        });
        resetFormFields();
        const nextRem = Math.max(0, remaining - amount);
        showToast(nextRem === 0
          ? (overAmt > 0 ? `Đã trả xong, thừa +${formatShortK(overAmt)} (chờ đồng bộ)` : 'Đã trả xong đơn nợ trên máy (chờ đồng bộ)')
          : `Đã lưu trả ${formatShortK(amount)} trên máy (chờ đồng bộ)`);
        computeWorkFromLocalVault(workState.date);
        const refreshed = findDebtJobById(jobId);
        if (refreshed) {
          renderDebtPayModal(refreshed);
          if (getDebtJobTotals(refreshed).remaining <= 0) {
            const closeBtn = document.querySelector('#modal-pay-debt-job .modal-close');
            if (closeBtn) closeBtn.focus();
          }
        }
      } finally {
        debtPaySubmitting = false;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Xác nhận trả tiền';
        }
      }
    };

    window.deleteDebtJobPayment = async function (paymentId, jobId) {
      if (!confirm('Hoàn tác lần trả tiền này? Số tiền nợ còn lại sẽ được cộng lại tương ứng.')) return;
      const targetJobId = Number(jobId || activeDebtJobId);
      const debtJob = targetJobId ? findDebtJobById(targetJobId) : null;
      const payItem = debtJob && Array.isArray(debtJob.payments)
        ? debtJob.payments.find(p => Number(p.id) === Number(paymentId))
        : null;
      const payUid = payItem && payItem.uid ? payItem.uid : '';
      const paySig = computeInstallmentSig(payItem);
      const qs = `?uid=${encodeURIComponent(payUid)}&sig=${encodeURIComponent(paySig)}`;
      try {
        const res = await api('/api/work/job-payment/' + paymentId + qs, { method: 'DELETE', deferQueueToast: true });
        if (res && typeof res.work_rev === 'number') {
          syncState.workRev = Math.max(syncState.workRev, res.work_rev);
        }
        removeJobPaymentFromLocalVault(paymentId, { dirty: false, tombstone: true });
        showToast('Đã xoá lần trả tiền');
        await loadWorkData(workState.date);
      } catch (err) {
        if (!isQueueableSyncError(err)) return;
        removeJobPaymentFromLocalVault(paymentId, { dirty: false, tombstone: true });
        enqueueSyncOp({
          domain: 'work',
          op: 'work_job_pay_del',
          target_id: Number(paymentId) || 0,
          target_uid: payUid,
          sig: paySig
        });
        showToast('Đã xoá lần trả tiền trên máy (chờ đồng bộ)');
        computeWorkFromLocalVault(workState.date);
      }

      const modalEl = document.getElementById('modal-pay-debt-job');
      if (modalEl && modalEl.classList.contains('open') && targetJobId) {
        const refreshed = findDebtJobById(targetJobId);
        if (refreshed) renderDebtPayModal(refreshed);
      }
    };

    window.deleteDebtJobFromModal = async function () {
      const idEl = document.getElementById('debt-pay-job-id');
      const jobId = Number((idEl && idEl.value) || activeDebtJobId);
      if (!jobId) return;
      await window.deleteWorkJob(jobId, { fromDebt: true, closePayModal: true });
    };

    window.exportWorkExcel = function () {
      const fallbackDate = new Date().toISOString().slice(0, 10);
      const month = workState.month || (workState.date || state.today || fallbackDate).slice(0, 7);
      window.location.href = `/api/work/export?month=${encodeURIComponent(month)}`;
    };

    // =========================================================================
    // MÃ QR BANKING (VIETQR OFFLINE + COPY ẢNH 1 CHẠM)
    // =========================================================================
    const BANK_QR_CONFIG = {
      rawPayload: '00020101021138540010A00000072701240006970418011088673509440208QRIBFTTA53037045802VN6304C4F0',
      bankShort: 'BIDV',
      accountNo: '8867350944',
      accountName: 'PHÙNG VĂN QUYỀN',
      fileName: 'QR-Banking-BIDV-8867350944.png'
    };

    const bankQrCache = {
      matrix: null,
      dataUrl: '',
      blob: null,
      blobPromise: null,
      accountName: '',
      resetTimer: null,
      modalResetTimer: null
    };

    // ISO/IEC 18004 ECC-M block table for versions 1..10:
    // [totalDataCodewords, ecPerBlock, g1Blocks, g1DataLen, g2Blocks, g2DataLen]
    const QR_ECC_M_TABLE = {
      1: [16, 10, 1, 16, 0, 0],
      2: [28, 16, 1, 28, 0, 0],
      3: [44, 26, 1, 44, 0, 0],
      4: [64, 18, 2, 32, 0, 0],
      5: [86, 24, 2, 43, 0, 0],
      6: [108, 16, 4, 27, 0, 0],
      7: [124, 18, 4, 31, 0, 0],
      8: [154, 22, 2, 38, 2, 39],
      9: [182, 22, 3, 36, 2, 37],
      10: [216, 26, 4, 43, 1, 44]
    };

    const QR_ALIGN_CENTERS = {
      2: [6, 18],
      3: [6, 22],
      4: [6, 26],
      5: [6, 30],
      6: [6, 34],
      7: [6, 22, 38],
      8: [6, 24, 42],
      9: [6, 26, 46],
      10: [6, 28, 50]
    };

    const QR_GF_EXP = new Uint8Array(512);
    const QR_GF_LOG = new Uint8Array(256);
    (function initQrGfTables() {
      let x = 1;
      for (let i = 0; i < 255; i++) {
        QR_GF_EXP[i] = x;
        QR_GF_LOG[x] = i;
        x <<= 1;
        if (x & 0x100) x ^= 0x11d;
      }
      for (let i = 255; i < 512; i++) {
        QR_GF_EXP[i] = QR_GF_EXP[i - 255];
      }
    })();

    function qrGfMul(a, b) {
      if (a === 0 || b === 0) return 0;
      return QR_GF_EXP[QR_GF_LOG[a] + QR_GF_LOG[b]];
    }

    function qrRsRemainder(dataBytes, ecLen) {
      let gen = [1];
      for (let i = 0; i < ecLen; i++) {
        const next = new Array(gen.length + 1).fill(0);
        const factor = QR_GF_EXP[i];
        for (let j = 0; j < gen.length; j++) {
          next[j] ^= gen[j];
          next[j + 1] ^= qrGfMul(gen[j], factor);
        }
        gen = next;
      }
      const rem = new Uint8Array(ecLen);
      for (let i = 0; i < dataBytes.length; i++) {
        const lead = dataBytes[i] ^ rem[0];
        for (let j = 0; j < ecLen - 1; j++) {
          rem[j] = rem[j + 1];
        }
        rem[ecLen - 1] = 0;
        if (lead !== 0) {
          for (let j = 0; j < ecLen; j++) {
            rem[j] ^= qrGfMul(gen[j + 1], lead);
          }
        }
      }
      return rem;
    }

    function qrFormatBits(maskIdx) {
      // ECC Level M indicator = 0b00
      const data = maskIdx & 7;
      let d = data << 10;
      for (let i = 4; i >= 0; i--) {
        if ((d >>> (i + 10)) & 1) {
          d ^= 0x537 << i;
        }
      }
      return (((data << 10) | d) ^ 0x5412) & 0x7fff;
    }

    function qrVersionBits(version) {
      let d = version << 12;
      for (let i = 5; i >= 0; i--) {
        if ((d >>> (i + 12)) & 1) {
          d ^= 0x1f25 << i;
        }
      }
      return ((version << 12) | d) & 0x3ffff;
    }

    function qrMaskPredicate(maskIdx, r, c) {
      switch (maskIdx) {
        case 0: return ((r + c) & 1) === 0;
        case 1: return (r & 1) === 0;
        case 2: return (c % 3) === 0;
        case 3: return ((r + c) % 3) === 0;
        case 4: return (((r >> 1) + Math.floor(c / 3)) & 1) === 0;
        case 5: return (((r * c) & 1) + ((r * c) % 3)) === 0;
        case 6: return ((((r * c) & 1) + ((r * c) % 3)) & 1) === 0;
        case 7: return ((((r + c) & 1) + ((r * c) % 3)) & 1) === 0;
        default: return false;
      }
    }

    function qrEvaluatePenalty(modules, size) {
      let penalty = 0;
      for (let r = 0; r < size; r++) {
        let runColor = modules[r][0];
        let runLen = 1;
        for (let c = 1; c < size; c++) {
          if (modules[r][c] === runColor) {
            runLen++;
          } else {
            if (runLen >= 5) penalty += 3 + (runLen - 5);
            runColor = modules[r][c];
            runLen = 1;
          }
        }
        if (runLen >= 5) penalty += 3 + (runLen - 5);
      }
      for (let c = 0; c < size; c++) {
        let runColor = modules[0][c];
        let runLen = 1;
        for (let r = 1; r < size; r++) {
          if (modules[r][c] === runColor) {
            runLen++;
          } else {
            if (runLen >= 5) penalty += 3 + (runLen - 5);
            runColor = modules[r][c];
            runLen = 1;
          }
        }
        if (runLen >= 5) penalty += 3 + (runLen - 5);
      }
      for (let r = 0; r < size - 1; r++) {
        for (let c = 0; c < size - 1; c++) {
          const v = modules[r][c];
          if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) {
            penalty += 3;
          }
        }
      }
      const hasPatternAt = (getFn, idx) => (
        getFn(idx) && !getFn(idx + 1) && getFn(idx + 2) && getFn(idx + 3) && getFn(idx + 4) && !getFn(idx + 5) && getFn(idx + 6)
      );
      const isFourWhite = (getFn, start) => (
        !getFn(start) && !getFn(start + 1) && !getFn(start + 2) && !getFn(start + 3)
      );
      for (let r = 0; r < size; r++) {
        const getRow = (i) => modules[r][i];
        for (let c = 0; c <= size - 11; c++) {
          if (isFourWhite(getRow, c) && hasPatternAt(getRow, c + 4)) penalty += 40;
          if (hasPatternAt(getRow, c) && isFourWhite(getRow, c + 7)) penalty += 40;
        }
      }
      for (let c = 0; c < size; c++) {
        const getCol = (i) => modules[i][c];
        for (let r = 0; r <= size - 11; r++) {
          if (isFourWhite(getCol, r) && hasPatternAt(getCol, r + 4)) penalty += 40;
          if (hasPatternAt(getCol, r) && isFourWhite(getCol, r + 7)) penalty += 40;
        }
      }
      let darkCount = 0;
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (modules[r][c]) darkCount++;
        }
      }
      const darkPct = (darkCount * 100) / (size * size);
      penalty += Math.floor(Math.abs(darkPct - 50) / 5) * 10;
      return penalty;
    }

    /** Encodes UTF-8 text into a deterministic ISO/IEC 18004 QR matrix (Byte mode, ECC-M, Versions 1..10). */
    function encodeQrMatrix(text) {
      const payloadBytes = new TextEncoder().encode(String(text || ''));
      let version = 0;
      for (let v = 1; v <= 10; v++) {
        const totalDataBytes = QR_ECC_M_TABLE[v][0];
        const countBits = v <= 9 ? 8 : 16;
        if (totalDataBytes * 8 >= 4 + countBits + payloadBytes.length * 8) {
          version = v;
          break;
        }
      }
      if (!version) {
        throw new Error('Dữ liệu QR vượt quá dung lượng phiên bản 10-M');
      }

      const [totalDataBytes, ecLen, g1Blocks, g1Len, g2Blocks, g2Len] = QR_ECC_M_TABLE[version];
      const countBits = version <= 9 ? 8 : 16;

      const bits = [];
      const pushBits = (val, n) => {
        for (let i = n - 1; i >= 0; i--) {
          bits.push((val >>> i) & 1);
        }
      };
      pushBits(0b0100, 4);
      pushBits(payloadBytes.length, countBits);
      for (let i = 0; i < payloadBytes.length; i++) {
        pushBits(payloadBytes[i], 8);
      }
      const capacityBits = totalDataBytes * 8;
      const terminatorLen = Math.min(4, capacityBits - bits.length);
      for (let i = 0; i < terminatorLen; i++) bits.push(0);
      while (bits.length % 8 !== 0) bits.push(0);

      const dataCodewords = new Uint8Array(totalDataBytes);
      let byteIdx = 0;
      for (let i = 0; i < bits.length; i += 8) {
        let b = 0;
        for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k];
        dataCodewords[byteIdx++] = b;
      }
      let padToggle = 0;
      while (byteIdx < totalDataBytes) {
        dataCodewords[byteIdx++] = padToggle === 0 ? 0xec : 0x11;
        padToggle ^= 1;
      }

      const dataBlocks = [];
      const ecBlocks = [];
      let offset = 0;
      for (let b = 0; b < g1Blocks; b++) {
        const blk = dataCodewords.slice(offset, offset + g1Len);
        offset += g1Len;
        dataBlocks.push(blk);
        ecBlocks.push(qrRsRemainder(blk, ecLen));
      }
      for (let b = 0; b < g2Blocks; b++) {
        const blk = dataCodewords.slice(offset, offset + g2Len);
        offset += g2Len;
        dataBlocks.push(blk);
        ecBlocks.push(qrRsRemainder(blk, ecLen));
      }

      const interleaved = [];
      const maxDataLen = Math.max(g1Len, g2Len);
      for (let i = 0; i < maxDataLen; i++) {
        for (let b = 0; b < dataBlocks.length; b++) {
          if (i < dataBlocks[b].length) interleaved.push(dataBlocks[b][i]);
        }
      }
      for (let i = 0; i < ecLen; i++) {
        for (let b = 0; b < ecBlocks.length; b++) {
          interleaved.push(ecBlocks[b][i]);
        }
      }

      const size = 17 + 4 * version;
      const base = Array.from({ length: size }, () => new Array(size).fill(false));
      const isFunc = Array.from({ length: size }, () => new Array(size).fill(false));

      const setFunc = (r, c, dark) => {
        if (r < 0 || r >= size || c < 0 || c >= size) return;
        base[r][c] = Boolean(dark);
        isFunc[r][c] = true;
      };

      const drawFinder = (top, left) => {
        for (let dr = -1; dr <= 7; dr++) {
          for (let dc = -1; dc <= 7; dc++) {
            const r = top + dr;
            const c = left + dc;
            if (r < 0 || r >= size || c < 0 || c >= size) continue;
            const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
            const isBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
            const isCenter = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
            setFunc(r, c, inOuter && (isBorder || isCenter));
          }
        }
      };

      drawFinder(0, 0);
      drawFinder(0, size - 7);
      drawFinder(size - 7, 0);

      for (let i = 8; i <= size - 9; i++) {
        const dark = (i & 1) === 0;
        setFunc(6, i, dark);
        setFunc(i, 6, dark);
      }

      if (version >= 2) {
        const centers = QR_ALIGN_CENTERS[version] || [];
        for (let i = 0; i < centers.length; i++) {
          for (let j = 0; j < centers.length; j++) {
            const cr = centers[i];
            const cc = centers[j];
            const nearTL = cr <= 8 && cc <= 8;
            const nearTR = cr <= 8 && cc >= size - 8;
            const nearBL = cr >= size - 8 && cc <= 8;
            if (nearTL || nearTR || nearBL) continue;
            for (let dr = -2; dr <= 2; dr++) {
              for (let dc = -2; dc <= 2; dc++) {
                const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
                setFunc(cr + dr, cc + dc, dark);
              }
            }
          }
        }
      }

      setFunc(size - 8, 8, true);
      for (let i = 0; i <= 8; i++) {
        if (i !== 6) {
          setFunc(8, i, false);
          setFunc(i, 8, false);
        }
      }
      for (let i = 0; i < 8; i++) {
        setFunc(8, size - 1 - i, false);
      }
      for (let i = 0; i < 7; i++) {
        setFunc(size - 1 - i, 8, false);
      }

      if (version >= 7) {
        const vBits = qrVersionBits(version);
        for (let k = 0; k < 18; k++) {
          const dark = ((vBits >>> k) & 1) === 1;
          const a = Math.floor(k / 3);
          const b = size - 11 + (k % 3);
          setFunc(a, b, dark);
          setFunc(b, a, dark);
        }
      }

      const totalBits = interleaved.length * 8;
      let bitCursor = 0;
      let dirUp = true;
      for (let col = size - 1; col >= 1; col -= 2) {
        if (col === 6) col--;
        for (let step = 0; step < size; step++) {
          const r = dirUp ? (size - 1 - step) : step;
          for (let dx = 0; dx < 2; dx++) {
            const c = col - dx;
            if (!isFunc[r][c]) {
              if (bitCursor < totalBits) {
                const cw = interleaved[bitCursor >> 3];
                const bit = (cw >>> (7 - (bitCursor & 7))) & 1;
                base[r][c] = bit === 1;
                bitCursor++;
              } else {
                base[r][c] = false;
              }
            }
          }
        }
        dirUp = !dirUp;
      }

      const writeFormatTo = (mat, maskIdx) => {
        const fmt = qrFormatBits(maskIdx);
        for (let i = 0; i <= 5; i++) mat[i][8] = ((fmt >>> i) & 1) === 1;
        mat[7][8] = ((fmt >>> 6) & 1) === 1;
        mat[8][8] = ((fmt >>> 7) & 1) === 1;
        mat[8][7] = ((fmt >>> 8) & 1) === 1;
        for (let i = 9; i < 15; i++) mat[8][14 - i] = ((fmt >>> i) & 1) === 1;

        for (let i = 0; i < 8; i++) mat[8][size - 1 - i] = ((fmt >>> i) & 1) === 1;
        for (let i = 8; i < 15; i++) mat[size - 15 + i][8] = ((fmt >>> i) & 1) === 1;
      };

      let bestPenalty = Infinity;
      let bestModules = null;
      let bestMask = 0;

      for (let maskIdx = 0; maskIdx < 8; maskIdx++) {
        const candidate = base.map((row, r) => row.map((val, c) => (
          isFunc[r][c] ? val : (qrMaskPredicate(maskIdx, r, c) ? !val : val)
        )));
        writeFormatTo(candidate, maskIdx);
        const p = qrEvaluatePenalty(candidate, size);
        if (p < bestPenalty) {
          bestPenalty = p;
          bestModules = candidate;
          bestMask = maskIdx;
        }
      }

      return { version, size, mask: bestMask, modules: bestModules };
    }

    function getBankQrAccountName() {
      const raw = state && state.settings && state.settings.name
        ? String(state.settings.name).trim()
        : '';
      return raw ? raw.toLocaleUpperCase('vi-VN') : BANK_QR_CONFIG.accountName;
    }

    function drawRoundedRectPath(ctx, x, y, w, h, r) {
      const radius = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + w - radius, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
      ctx.lineTo(x + w, y + h - radius);
      ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
      ctx.lineTo(x + radius, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
    }

    function renderBankQrCardCanvas() {
      if (!bankQrCache.matrix) {
        bankQrCache.matrix = encodeQrMatrix(BANK_QR_CONFIG.rawPayload);
      }
      const qr = bankQrCache.matrix;
      const acctName = getBankQrAccountName();

      const W = 720;
      const H = 900;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');

      // Pure white background so all QR scanners read high-contrast dark modules
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, H);

      ctx.save();
      drawRoundedRectPath(ctx, 200, 44, 320, 42, 21);
      ctx.fillStyle = '#EDF7E7';
      ctx.fill();
      ctx.strokeStyle = '#CBE4BC';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#254516';
      ctx.font = '700 18px "Plus Jakarta Sans", system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('VietQR  •  Chuyển nhanh 24/7', W / 2, 65);
      ctx.restore();

      ctx.fillStyle = '#1C1F1B';
      ctx.font = '800 30px "Plus Jakarta Sans", system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`Chuyển khoản ${BANK_QR_CONFIG.bankShort}`, W / 2, 120);

      const boxX = 92;
      const boxY = 162;
      const boxW = 536;
      const boxH = 512;
      drawRoundedRectPath(ctx, boxX, boxY, boxW, boxH, 28);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.strokeStyle = '#DCE8D9';
      ctx.lineWidth = 2;
      ctx.stroke();

      const modPx = Math.floor(420 / qr.size);
      const qrPx = modPx * qr.size;
      const qrOriginX = Math.floor((W - qrPx) / 2);
      const qrOriginY = Math.floor(boxY + (boxH - qrPx) / 2);

      ctx.fillStyle = '#000000';
      for (let r = 0; r < qr.size; r++) {
        for (let c = 0; c < qr.size; c++) {
          if (qr.modules[r][c]) {
            ctx.fillRect(qrOriginX + c * modPx, qrOriginY + r * modPx, modPx, modPx);
          }
        }
      }

      ctx.fillStyle = '#1C1F1B';
      ctx.font = '800 26px "Plus Jakarta Sans", system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(acctName, W / 2, 720);

      drawRoundedRectPath(ctx, 166, 756, 388, 54, 27);
      ctx.fillStyle = '#EDF7E7';
      ctx.fill();
      ctx.strokeStyle = '#CBE4BC';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#1E3B13';
      ctx.font = '800 24px "Plus Jakarta Sans", system-ui, -apple-system, sans-serif';
      ctx.fillText(`${BANK_QR_CONFIG.bankShort}  •  ${BANK_QR_CONFIG.accountNo}`, W / 2, 783);

      ctx.fillStyle = '#5C6659';
      ctx.font = '600 16px "Plus Jakarta Sans", system-ui, -apple-system, sans-serif';
      ctx.fillText('Quét mã bằng ứng dụng Ngân hàng hoặc Ví điện tử', W / 2, 846);

      return canvas;
    }

    function dataUrlToPngBlob(dataUrl) {
      const parts = String(dataUrl || '').split(',');
      const bstr = atob(parts[1] || '');
      const bytes = new Uint8Array(bstr.length);
      for (let i = 0; i < bstr.length; i++) {
        bytes[i] = bstr.charCodeAt(i);
      }
      return new Blob([bytes], { type: 'image/png' });
    }

    function ensureBankQrAssets() {
      const acctName = getBankQrAccountName();
      if (bankQrCache.dataUrl && bankQrCache.accountName === acctName) {
        return bankQrCache;
      }
      const canvas = renderBankQrCardCanvas();
      bankQrCache.accountName = acctName;
      bankQrCache.dataUrl = canvas.toDataURL('image/png');
      bankQrCache.blob = null;
      bankQrCache.blobPromise = new Promise((resolve) => {
        if (typeof canvas.toBlob === 'function') {
          canvas.toBlob((blob) => {
            const finalBlob = blob || dataUrlToPngBlob(bankQrCache.dataUrl);
            bankQrCache.blob = finalBlob;
            resolve(finalBlob);
          }, 'image/png');
        } else {
          const finalBlob = dataUrlToPngBlob(bankQrCache.dataUrl);
          bankQrCache.blob = finalBlob;
          resolve(finalBlob);
        }
      });
      return bankQrCache;
    }

    function ensureBankQrBlob() {
      ensureBankQrAssets();
      return bankQrCache.blob || bankQrCache.blobPromise;
    }

    function schedulePrewarmBankQr() {
      const run = () => {
        try { ensureBankQrAssets(); } catch (_) { }
      };
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(run, { timeout: 1200 });
      } else {
        setTimeout(run, 150);
      }
    }

    function setBankQrCopiedFeedback(fromModal) {
      const cardBtn = document.getElementById('btn-work-copy-qr');
      const cardLabel = document.getElementById('work-qr-copy-label');
      if (cardBtn) cardBtn.classList.add('is-copied');
      if (cardLabel) cardLabel.textContent = 'Đã copy';
      if (bankQrCache.resetTimer) clearTimeout(bankQrCache.resetTimer);
      bankQrCache.resetTimer = setTimeout(() => {
        if (cardBtn) cardBtn.classList.remove('is-copied');
        if (cardLabel) cardLabel.textContent = 'Copy QR';
        bankQrCache.resetTimer = null;
      }, 2200);

      if (fromModal) {
        const modalBtn = document.getElementById('btn-modal-copy-qr');
        if (modalBtn) {
          modalBtn.textContent = 'Đã copy ảnh QR!';
          if (bankQrCache.modalResetTimer) clearTimeout(bankQrCache.modalResetTimer);
          bankQrCache.modalResetTimer = setTimeout(() => {
            modalBtn.textContent = 'Copy ảnh QR';
            bankQrCache.modalResetTimer = null;
          }, 2200);
        }
      }

      const liveEl = document.getElementById('work-qr-live');
      if (liveEl) {
        liveEl.textContent = 'Đã sao chép ảnh mã QR Banking BIDV 8867350944 vào bộ nhớ tạm';
      }
    }

    function handleBankQrClipboardFallback(fromModal) {
      if (!fromModal) {
        openBankQrModal();
      }
      const liveEl = document.getElementById('work-qr-live');
      if (liveEl) {
        liveEl.textContent = 'Trình duyệt không hỗ trợ copy ảnh tự động, đã mở mã QR để chia sẻ hoặc lưu ảnh';
      }
      showToast('Trình duyệt không cho copy ảnh tự động — Dùng Chia sẻ hoặc giữ vào ảnh QR để gửi!');
    }

    // Keep ClipboardItem & clipboard.write() synchronous inside click handler for Safari/iOS PWA gesture activation.
    window.copyBankQrImage = function (opts = {}) {
      const fromModal = Boolean(opts && opts.fromModal);
      const canWriteImage = Boolean(
        navigator.clipboard &&
        typeof navigator.clipboard.write === 'function' &&
        typeof window.ClipboardItem === 'function'
      );

      if (!canWriteImage) {
        handleBankQrClipboardFallback(fromModal);
        return;
      }

      try {
        const pngItem = ensureBankQrBlob();
        const item = new window.ClipboardItem({ 'image/png': pngItem });
        navigator.clipboard.write([item]).then(() => {
          setBankQrCopiedFeedback(fromModal);
          showToast(
            'Đã copy ảnh QR Banking — Dán gửi Zalo/FB ngay!',
            fromModal ? false : { actionLabel: 'Xem QR', onAction: () => openBankQrModal() }
          );
        }).catch(() => {
          handleBankQrClipboardFallback(fromModal);
        });
      } catch (_) {
        handleBankQrClipboardFallback(fromModal);
      }
    };

    window.openBankQrModal = function () {
      const assets = ensureBankQrAssets();
      const imgEl = document.getElementById('bank-qr-modal-img');
      if (imgEl) {
        imgEl.src = assets.dataUrl;
      }
      const acctEl = document.querySelector('#modal-bank-qr .bank-qr-acct-name');
      if (acctEl) {
        acctEl.textContent = getBankQrAccountName();
      }
      const shareBtn = document.getElementById('btn-modal-share-qr');
      if (shareBtn) {
        let canSharePng = false;
        try {
          if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && typeof File === 'function') {
            const probeBlob = assets.blob || dataUrlToPngBlob(assets.dataUrl);
            const probeFile = new File([probeBlob], BANK_QR_CONFIG.fileName, { type: 'image/png' });
            canSharePng = navigator.canShare({ files: [probeFile] });
          }
        } catch (_) {
          canSharePng = false;
        }
        shareBtn.hidden = !canSharePng;
      }
      openModal('modal-bank-qr');
    };

    window.copyBankAccountNumber = async function () {
      const text = BANK_QR_CONFIG.accountNo;
      let copied = false;
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(text);
          copied = true;
        }
      } catch (_) {
        copied = false;
      }
      if (!copied) {
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          copied = document.execCommand('copy');
          ta.remove();
        } catch (_) {
          copied = false;
        }
      }
      if (copied) {
        const liveEl = document.getElementById('work-qr-live');
        if (liveEl) {
          liveEl.textContent = `Đã sao chép số tài khoản BIDV ${text}`;
        }
        showToast(`Đã copy số tài khoản ${BANK_QR_CONFIG.bankShort}: ${text}`);
      } else {
        showToast('Không thể copy tự động trên trình duyệt này', true);
      }
    };

    window.shareBankQrImage = async function () {
      try {
        const blob = await ensureBankQrBlob();
        const file = new File([blob], BANK_QR_CONFIG.fileName, { type: 'image/png' });
        await navigator.share({
          files: [file],
          title: `Mã QR Banking - ${BANK_QR_CONFIG.bankShort}`,
          text: `${BANK_QR_CONFIG.bankShort} ${BANK_QR_CONFIG.accountNo} - ${getBankQrAccountName()}`
        });
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        showToast('Không thể mở chia sẻ trên trình duyệt này, hãy dùng Tải ảnh hoặc nhấn giữ ảnh QR', true);
      }
    };

    window.downloadBankQrImage = function () {
      const assets = ensureBankQrAssets();
      const link = document.createElement('a');
      link.href = assets.dataUrl;
      link.download = BANK_QR_CONFIG.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      showToast(`Đã tải ảnh ${BANK_QR_CONFIG.fileName}`);
    };

    // Khởi động ứng dụng
    init();
  }) ();
