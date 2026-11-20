// Quyền Anh - Ultra-fast, minimal Vanilla JS App
// Styled 100% like the Sage Green Clean Mockup Interface - Thuần Tiếng Việt
(function () {
  'use strict';

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
    activeTab: 'today'
  };

  // Utility Toast
  window.showToast = function (msg, isErr = false) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = isErr ? 'toast toast-error' : 'toast';
    toast.setAttribute('role', isErr ? 'alert' : 'status');
    const iconSvg = isErr
      ? '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12.5"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
      : '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
    toast.innerHTML = `
      <span class="toast-icon-badge" aria-hidden="true">${iconSvg}</span>
      <span class="toast-msg">${escapeHtml(String(msg == null ? '' : msg))}</span>
      <button type="button" class="toast-close-btn" aria-label="Đóng thông báo" onclick="const t=this.parentElement;if(t){t.classList.add('is-leaving');setTimeout(()=>t.remove(),180);}">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;
    container.appendChild(toast);
    const stayMs = isErr ? 4500 : 3400;
    setTimeout(() => {
      toast.classList.add('is-leaving');
      setTimeout(() => toast.remove(), 180);
    }, stayMs);
  };

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
        if (state.activeTab === 'work' || state.activeTab === 'ledger') {
          await loadWorkData(workState.date, { silent: true });
        }
      } else if (workChanged) {
        if (state.activeTab === 'work' || state.activeTab === 'ledger') {
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
    }
    bindSyncLifecycleListeners();
    startSyncWatcher();
    await flushPendingSyncQueues({ silent: true });
    await loadToday({ silent: true });
    await syncFinanceVaultOnBoot();
    await checkRemoteSyncState({ silent: true, force: true });
  }

  // Khởi tạo & Kiểm tra đăng nhập
  async function init() {
    registerServiceWorker();
    setupHeroGreetingWatcher();
    renderDynamicGreeting();
    setupRouting();
    setupTabSwipeGesture();
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
    showLoginView();
  };

  // Quản lý Tab: hôm nay, công việc, thu chi, cài đặt
  const MAIN_TAB_ORDER = ['today', 'work', 'ledger', 'settings'];
  const MAIN_TAB_LABELS = {
    today: 'Hôm nay',
    work: 'Công việc',
    ledger: 'Thu chi',
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
  }

  window.switchTab = function (tabId, opts = {}) {
    if (tabId === 'records' || tabId === 'meals') tabId = 'today';
    if (tabId === 'overview' || !document.getElementById('tab-' + tabId)) {
      tabId = 'today';
    }

    if (typeof cancelSwipeSessionFn === 'function' && !(opts && opts.fromSwipeFlush)) {
      cancelSwipeSessionFn();
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

    state.activeTab = tabId;
    document.querySelectorAll('.tab-pane').forEach(el => {
      clearPaneSwipeStyles(el);
      el.classList.remove('active');
      el.removeAttribute('data-slide-dir');
    });

    const targetPane = document.getElementById('tab-' + tabId);
    if (targetPane) {
      clearPaneSwipeStyles(targetPane);
      if (dir) targetPane.setAttribute('data-slide-dir', dir);
      targetPane.classList.add('active');
    }

    updateNavPillSelection(tabId, Boolean(opts && opts.focusNavBtn));

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

    if (tabId === 'work' || tabId === 'ledger') {
      if (!workState.date && typeof computeWorkFromLocalVault === 'function') {
        computeWorkFromLocalVault(workState.date || state.today);
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
    } else if ((tabId === 'work' || tabId === 'ledger') && (now - lastWorkSyncAt >= 3000 || !workState.date)) {
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
    if (['today', 'work', 'ledger', 'settings'].includes(hash)) {
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
    }

    const appView = document.getElementById('app-view');
    if (!appView || appView.dataset.swipeBound) return;
    appView.dataset.swipeBound = '1';

    const EDGE_ZONE_PX = 36;
    const SWIPE_MAX_DURATION_MS = 680;
    const FLICK_MAX_DURATION_MS = 280;
    const FLICK_MIN_VELOCITY = 0.28;
    const MAX_VERTICAL_DRIFT_PX = 84;
    const SETTLE_DURATION_MS = 220;
    const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"]';
    const HORIZ_IGNORE_SELECTOR = '.motivation-thumbs-strip, .work-chips-scroll, .calendar-days-strip, [data-no-tab-swipe]';

    const scheduleFrame = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (fn) => setTimeout(fn, 0);
    const cancelFrame = typeof window.cancelAnimationFrame === 'function'
      ? window.cancelAnimationFrame.bind(window)
      : clearTimeout;

    let gesture = null;
    let rafId = 0;
    let pendingDrag = null;
    let pendingSettle = null;

    function getActivePane() {
      return document.getElementById('tab-' + state.activeTab);
    }

    function getOrCreateEdgePill() {
      let pill = document.getElementById('tab-swipe-edge-pill');
      if (!pill && typeof document.createElement === 'function' && document.body) {
        pill = document.createElement('div');
        pill.id = 'tab-swipe-edge-pill';
        pill.className = 'tab-swipe-edge-pill';
        pill.setAttribute('aria-hidden', 'true');
        document.body.appendChild(pill);
      }
      return pill;
    }

    function hideEdgePill() {
      const pill = document.getElementById('tab-swipe-edge-pill');
      if (!pill) return;
      pill.classList.remove('is-visible', 'is-ready');
    }

    function updateEdgePill(side, label, isReady) {
      const pill = getOrCreateEdgePill();
      if (!pill) return;
      pill.setAttribute('data-side', side);
      pill.textContent = side === 'left' ? `← ${label}` : `${label} →`;
      pill.classList.add('is-visible');
      pill.classList.toggle('is-ready', Boolean(isReady));
    }

    function cancelPendingFrame() {
      if (rafId) {
        cancelFrame(rafId);
        rafId = 0;
      }
      pendingDrag = null;
    }

    function flushPendingSettle() {
      if (!pendingSettle) return;
      const s = pendingSettle;
      pendingSettle = null;
      if (s.timerId) clearTimeout(s.timerId);
      if (s.isSwitch && s.targetTab) {
        switchTab(s.targetTab, { viaSwipeSettled: true, fromSwipeFlush: true });
      } else {
        clearPaneSwipeStyles(s.activePane);
        if (s.previewPane) clearPaneSwipeStyles(s.previewPane);
      }
    }

    cancelSwipeSessionFn = function () {
      cancelPendingFrame();
      hideEdgePill();
      if (pendingSettle) {
        if (pendingSettle.timerId) clearTimeout(pendingSettle.timerId);
        clearPaneSwipeStyles(pendingSettle.activePane);
        if (pendingSettle.previewPane) clearPaneSwipeStyles(pendingSettle.previewPane);
        pendingSettle = null;
      }
      if (gesture && gesture.previewPane) {
        clearPaneSwipeStyles(gesture.previewPane);
      }
      gesture = null;
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

    function getSwipeThresholds(isEdgeSwipe) {
      return isEdgeSwipe
        ? { lockThreshold: 6, lockRatio: 1.15, minDistance: 40, flickMinDistance: 28, endRatio: 1.2 }
        : { lockThreshold: 10, lockRatio: 1.35, minDistance: 52, flickMinDistance: 38, endRatio: 1.4 };
    }

    function applyDragFrame(dx, isEdgeSwipe) {
      if (!gesture || gesture.axis !== 'x') return;
      const curIdx = MAIN_TAB_ORDER.indexOf(state.activeTab);
      if (curIdx === -1) return;

      const activePane = getActivePane();
      if (!activePane) return;

      const stride = Math.max(240, appView.clientWidth || window.innerWidth || 390);
      const targetIdx = dx < 0 ? curIdx + 1 : (dx > 0 ? curIdx - 1 : -1);
      const hasTarget = targetIdx >= 0 && targetIdx < MAIN_TAB_ORDER.length;
      const targetTab = hasTarget ? MAIN_TAB_ORDER[targetIdx] : '';
      const previewPane = targetTab ? document.getElementById('tab-' + targetTab) : null;

      if (gesture.previewPane && gesture.previewPane !== previewPane) {
        clearPaneSwipeStyles(gesture.previewPane);
        gesture.previewPane = null;
      }

      const cfg = getSwipeThresholds(isEdgeSwipe);
      const absX = Math.abs(dx);
      gesture.stride = stride;

      if (!prefersReducedMotion()) {
        if (hasTarget && previewPane) {
          if ((targetTab === 'work' || targetTab === 'ledger') && !workState.date && typeof computeWorkFromLocalVault === 'function') {
            computeWorkFromLocalVault(workState.date || state.today);
          }
          const clampedDx = Math.max(-stride, Math.min(stride, dx));
          const previewX = clampedDx < 0 ? (stride + clampedDx) : (-stride + clampedDx);

          activePane.classList.add('is-swipe-dragging');
          activePane.style.transform = `translate3d(${clampedDx.toFixed(1)}px, 0, 0)`;

          if (!previewPane.classList.contains('is-swipe-preview')) {
            previewPane.style.setProperty('--swipe-scroll-y', `${gesture.scrollY}px`);
            previewPane.classList.add('is-swipe-preview');
          }
          previewPane.classList.add('is-swipe-dragging');
          previewPane.style.transform = `translate3d(${previewX.toFixed(1)}px, 0, 0)`;

          gesture.previewPane = previewPane;
          gesture.lastClampedDx = clampedDx;
        } else {
          const dampedDx = Math.max(-44, Math.min(44, dx * 0.22));
          activePane.classList.add('is-swipe-dragging');
          activePane.style.transform = `translate3d(${dampedDx.toFixed(1)}px, 0, 0)`;
          gesture.lastClampedDx = dampedDx;
        }
      }

      if (hasTarget) {
        const side = dx < 0 ? 'right' : 'left';
        updateEdgePill(side, MAIN_TAB_LABELS[targetTab] || targetTab, absX >= cfg.minDistance);
      } else {
        hideEdgePill();
      }
    }

    function startRebound(activePane, previewPane, clampedDx, stride) {
      if (prefersReducedMotion() || !activePane) {
        clearPaneSwipeStyles(activePane);
        if (previewPane) clearPaneSwipeStyles(previewPane);
        return;
      }
      const hasDrag = activePane.classList.contains('is-swipe-dragging') || Boolean(previewPane);
      if (!hasDrag) {
        clearPaneSwipeStyles(activePane);
        if (previewPane) clearPaneSwipeStyles(previewPane);
        return;
      }

      activePane.classList.remove('is-swipe-dragging');
      activePane.classList.add('is-swipe-settling');
      activePane.style.transform = 'translate3d(0, 0, 0)';

      if (previewPane) {
        const outX = clampedDx < 0 ? stride : -stride;
        previewPane.classList.remove('is-swipe-dragging');
        previewPane.classList.add('is-swipe-settling');
        previewPane.style.transform = `translate3d(${outX}px, 0, 0)`;
      }

      pendingSettle = {
        isSwitch: false,
        activePane,
        previewPane,
        timerId: setTimeout(flushPendingSettle, SETTLE_DURATION_MS + 10)
      };
    }

    function cancelAndRebound() {
      cancelPendingFrame();
      hideEdgePill();
      if (!gesture) return;
      const g = gesture;
      gesture = null;
      if (g.axis === 'x') {
        startRebound(getActivePane(), g.previewPane, g.lastClampedDx || 0, g.stride || 390);
      }
    }

    appView.addEventListener('touchstart', (e) => {
      flushPendingSettle();
      cancelAndRebound();
      if (!document.body.classList.contains('is-logged-in')) return;
      if (!e.touches || e.touches.length !== 1) return;
      if (document.querySelector('.modal-overlay.open')) return;

      const touch = e.touches[0];
      const rect = typeof appView.getBoundingClientRect === 'function'
        ? appView.getBoundingClientRect()
        : { left: 0, right: window.innerWidth || 390 };
      const leftBoundary = Math.max(0, rect.left || 0);
      const rightBoundary = rect.right && rect.right > 0 ? rect.right : (window.innerWidth || 390);
      const distLeft = touch.clientX - leftBoundary;
      const distRight = rightBoundary - touch.clientX;
      const viewportWidth = window.innerWidth || rightBoundary;
      const isEdgeSwipe = distLeft <= EDGE_ZONE_PX || distRight <= EDGE_ZONE_PX ||
        touch.clientX <= EDGE_ZONE_PX || touch.clientX >= viewportWidth - EDGE_ZONE_PX;

      const targetEl = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement);
      if (targetEl && targetEl.closest && targetEl.closest(EDITABLE_SELECTOR)) return;
      if (!isEdgeSwipe) {
        if (targetEl && targetEl.closest && targetEl.closest(HORIZ_IGNORE_SELECTOR)) return;
        if (hasHorizontalScrollableAncestor(targetEl)) return;
      }

      const scrollY = (window.scrollY || window.pageYOffset || 0) + (appView.scrollTop || 0);
      gesture = {
        startX: touch.clientX,
        startY: touch.clientY,
        lastX: touch.clientX,
        lastY: touch.clientY,
        startTime: Date.now(),
        scrollY,
        isEdgeSwipe,
        axis: null,
        previewPane: null,
        lastClampedDx: 0,
        stride: Math.max(240, appView.clientWidth || viewportWidth || 390)
      };
    }, { passive: true });

    appView.addEventListener('touchmove', (e) => {
      if (!gesture) return;
      if (!e.touches || e.touches.length !== 1) {
        cancelAndRebound();
        return;
      }

      const touch = e.touches[0];
      gesture.lastX = touch.clientX;
      gesture.lastY = touch.clientY;

      const dx = touch.clientX - gesture.startX;
      const dy = touch.clientY - gesture.startY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      const cfg = getSwipeThresholds(gesture.isEdgeSwipe);

      if (gesture.axis === null) {
        if (absX < cfg.lockThreshold && absY < cfg.lockThreshold) {
          return;
        }
        if (absY >= absX * 0.85) {
          gesture.axis = 'y';
          gesture = null;
          return;
        }
        if (absX >= absY * cfg.lockRatio) {
          gesture.axis = 'x';
          const pane = getActivePane();
          if (pane) {
            clearPaneSwipeStyles(pane);
            pane.removeAttribute('data-slide-dir');
          }
        } else {
          return;
        }
      }

      if (gesture.axis !== 'x') return;

      if (absY > MAX_VERTICAL_DRIFT_PX && absY > absX * 0.85) {
        cancelAndRebound();
        return;
      }

      if (e.cancelable && typeof e.preventDefault === 'function') {
        e.preventDefault();
      }

      pendingDrag = { dx, isEdgeSwipe: gesture.isEdgeSwipe };
      if (!rafId) {
        rafId = scheduleFrame(() => {
          rafId = 0;
          if (!pendingDrag || !gesture) return;
          const frame = pendingDrag;
          pendingDrag = null;
          applyDragFrame(frame.dx, frame.isEdgeSwipe);
        });
      }
    }, { passive: false });

    appView.addEventListener('touchend', (e) => {
      if (!gesture) return;
      const touch = (e.changedTouches && e.changedTouches[0]) || null;
      const endX = touch ? touch.clientX : gesture.lastX;
      const endY = touch ? touch.clientY : gesture.lastY;
      const dx = endX - gesture.startX;
      const dy = endY - gesture.startY;

      if (pendingDrag) {
        const frame = pendingDrag;
        cancelPendingFrame();
        if (gesture.axis === 'x') {
          applyDragFrame(frame.dx, frame.isEdgeSwipe);
        }
      } else {
        cancelPendingFrame();
      }

      const g = gesture;
      gesture = null;
      hideEdgePill();

      const activePane = getActivePane();
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      const dt = Math.max(1, Date.now() - g.startTime);
      const cfg = getSwipeThresholds(g.isEdgeSwipe);
      const stride = g.stride || Math.max(240, appView.clientWidth || window.innerWidth || 390);

      if (g.axis !== 'x' || !document.body.classList.contains('is-logged-in') || document.querySelector('.modal-overlay.open')) {
        startRebound(activePane, g.previewPane, g.lastClampedDx || 0, stride);
        return;
      }

      if (absX <= absY * cfg.endRatio || absY > MAX_VERTICAL_DRIFT_PX) {
        startRebound(activePane, g.previewPane, g.lastClampedDx || 0, stride);
        return;
      }

      const isNormalSwipe = absX >= cfg.minDistance && dt <= SWIPE_MAX_DURATION_MS;
      const isFlick = absX >= cfg.flickMinDistance && dt <= FLICK_MAX_DURATION_MS && (absX / dt) >= FLICK_MIN_VELOCITY;
      if (!isNormalSwipe && !isFlick) {
        startRebound(activePane, g.previewPane, g.lastClampedDx || 0, stride);
        return;
      }

      const curIdx = MAIN_TAB_ORDER.indexOf(state.activeTab);
      if (curIdx === -1) {
        startRebound(activePane, g.previewPane, g.lastClampedDx || 0, stride);
        return;
      }

      const targetTab = (dx < 0 && curIdx < MAIN_TAB_ORDER.length - 1)
        ? MAIN_TAB_ORDER[curIdx + 1]
        : ((dx > 0 && curIdx > 0) ? MAIN_TAB_ORDER[curIdx - 1] : '');
      const dir = dx < 0 ? 'next' : 'prev';

      if (!targetTab) {
        startRebound(activePane, g.previewPane, g.lastClampedDx || 0, stride);
        return;
      }

      if (prefersReducedMotion()) {
        clearPaneSwipeStyles(activePane);
        if (g.previewPane) clearPaneSwipeStyles(g.previewPane);
        switchTab(targetTab, { direction: dir, viaSwipe: true });
        return;
      }

      const previewPane = document.getElementById('tab-' + targetTab);
      if (!activePane || !previewPane) {
        switchTab(targetTab, { direction: dir, viaSwipe: true });
        return;
      }

      if ((targetTab === 'work' || targetTab === 'ledger') && !workState.date && typeof computeWorkFromLocalVault === 'function') {
        computeWorkFromLocalVault(workState.date || state.today);
      }

      if (g.previewPane && g.previewPane !== previewPane) {
        clearPaneSwipeStyles(g.previewPane);
      }

      if (!previewPane.classList.contains('is-swipe-preview')) {
        const clampedDx = Math.max(-stride, Math.min(stride, dx));
        const startPreviewX = dir === 'next' ? (stride + clampedDx) : (-stride + clampedDx);
        previewPane.style.setProperty('--swipe-scroll-y', `${g.scrollY}px`);
        previewPane.classList.add('is-swipe-preview', 'is-swipe-dragging');
        previewPane.style.transform = `translate3d(${startPreviewX.toFixed(1)}px, 0, 0)`;
        void previewPane.offsetWidth;
      }

      updateNavPillSelection(targetTab);

      const activeOutX = dir === 'next' ? -stride : stride;
      activePane.classList.remove('is-swipe-dragging');
      activePane.classList.add('is-swipe-settling');
      activePane.style.transform = `translate3d(${activeOutX}px, 0, 0)`;

      previewPane.classList.remove('is-swipe-dragging');
      previewPane.classList.add('is-swipe-settling');
      previewPane.style.transform = 'translate3d(0, 0, 0)';

      pendingSettle = {
        isSwitch: true,
        activePane,
        previewPane,
        targetTab,
        timerId: setTimeout(flushPendingSettle, SETTLE_DURATION_MS + 10)
      };
    }, { passive: true });

    appView.addEventListener('touchcancel', cancelAndRebound, { passive: true });
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
        let dotColor = '#687363';
        let textColor = '#545D50';

        if (score >= 90) {
          badgeText = 'Xuất sắc';
          dotColor = '#2B5719';
          textColor = '#2B5719';
        } else if (score >= 70) {
          badgeText = 'Tốt';
          dotColor = '#3D6E26';
          textColor = '#3D6E26';
        } else if (score >= 40) {
          badgeText = 'Khá';
          dotColor = '#4D7C0F';
          textColor = '#3F6B0B';
        } else if (score > 0) {
          badgeText = 'Đang cải thiện';
          dotColor = '#D97706';
          textColor = '#B45309';
        }

        badgeEl.textContent = badgeText;
        if (statusRowEl) statusRowEl.style.color = textColor;
        if (statusDotEl) statusDotEl.style.backgroundColor = dotColor;
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
        if (medCount >= medTarget) {
          medSummary.textContent = `Đủ ${medTarget}/${medTarget} lần`;
          medSummary.style.color = '#2B5719';
        } else if (medCount > 0) {
          medSummary.textContent = `${medCount}/${medTarget} lần`;
          medSummary.style.color = '#9E4707';
        } else {
          medSummary.textContent = `0/${medTarget} lần`;
          medSummary.style.color = '#B23A09';
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
        if (doneMealsCount >= mealsTarget) {
          mealsSummary.textContent = `Đủ ${mealsTarget}/${mealsTarget} bữa`;
          mealsSummary.style.color = '#2B5719';
        } else if (doneMealsCount > 0) {
          mealsSummary.textContent = `${doneMealsCount}/${mealsTarget} bữa`;
          mealsSummary.style.color = '#9A4A08';
        } else {
          mealsSummary.textContent = `0/${mealsTarget} bữa`;
          mealsSummary.style.color = '#9A4A08';
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
          <div style="background: #F9FBF8; border: 1px solid var(--border-subtle); border-radius: 14px; padding: 12px 14px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="font-weight: 700; font-size: 13.5px; color: var(--text-main); display: inline-flex; align-items: center; gap: 6px;">
                <svg class="ui-inline-svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#38A3A5" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>
                <span>Uống nước lọc</span>
              </span>
              <span style="font-weight: 800; color: ${waterPts > 0 ? 'var(--color-score-ring)' : 'var(--text-muted)'};" class="font-tabular">${waterPts}/40 đ</span>
            </div>
            <div style="font-size: 12.5px; color: var(--text-sub);">
              Đã uống <strong class="font-tabular">${curWater.toLocaleString('vi-VN')}</strong> / ${minWater.toLocaleString('vi-VN')} ml (${Math.min(100, Math.round(waterRatio * 100))}%)
            </div>
          </div>

          <div style="background: #F9FBF8; border: 1px solid var(--border-subtle); border-radius: 14px; padding: 12px 14px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="font-weight: 700; font-size: 13.5px; color: var(--text-main); display: inline-flex; align-items: center; gap: 6px;">
                <svg class="ui-inline-svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#5E9447" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/></svg>
                <span>Thuốc bổ gan</span>
              </span>
              <span style="font-weight: 800; color: ${medPts ? 'var(--color-score-ring)' : 'var(--text-muted)'};" class="font-tabular">${medPts}/30 đ</span>
            </div>
            <div style="font-size: 12.5px;">
              ${medCount >= medTarget
            ? `<span style="color: #2B5719; font-weight: 600;">Đã uống đủ ${medCount}/${medTarget} lần theo lịch nhắc hôm nay</span>`
            : `<span style="color: #C2410C;">Đã uống <strong class="font-tabular">${medCount}/${medTarget}</strong> lần (bấm ô Thuốc bổ gan để đánh dấu)</span>`}
            </div>
          </div>

          <div style="background: #F9FBF8; border: 1px solid var(--border-subtle); border-radius: 14px; padding: 12px 14px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="font-weight: 700; font-size: 13.5px; color: var(--text-main); display: inline-flex; align-items: center; gap: 6px;">
                <svg class="ui-inline-svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#E55B6C" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                <span>Cân sáng sớm</span>
              </span>
              <span style="font-weight: 800; color: ${weightPts ? 'var(--color-score-ring)' : 'var(--text-muted)'};" class="font-tabular">${weightPts}/15 đ</span>
            </div>
            <div style="font-size: 12.5px;">
              ${hasWeight ? `<span style="color: #2B5719; font-weight: 600;">Đã ghi nhận: ${state.todayWeight.toFixed(1)} kg</span>` : '<span style="color: #C2410C;">Chưa cân sáng nay (bấm ô Cân nặng để nhập)</span>'}
            </div>
          </div>

          <div style="background: #F9FBF8; border: 1px solid var(--border-subtle); border-radius: 14px; padding: 12px 14px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="font-weight: 700; font-size: 13.5px; color: var(--text-main); display: inline-flex; align-items: center; gap: 6px;">
                <svg class="ui-inline-svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#2B5719" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
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
            diffHtml = `<span style="color: #B91C1C; font-weight: 700; font-size: 12px;">+${diff.toFixed(1)} kg</span>`;
          } else if (diff < 0) {
            diffHtml = `<span style="color: #2B5719; font-weight: 700; font-size: 12px;">${diff.toFixed(1)} kg</span>`;
          } else {
            diffHtml = '<span style="color: var(--text-sub); font-size: 12px;">0.0 kg</span>';
          }
        }
        const dm = formatDayMonth(item.date);
        const hm = item.ts ? formatTimeHM(item.ts) : '';
        const baseDate = item.date === state.today ? `Hôm nay (${dm})` : `Ngày ${dm}`;
        const dateLabel = hm ? `${baseDate} • ${hm}` : baseDate;
        html += `
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 10px; background: ${item.date === state.today ? '#EEF7E8' : '#F9FBF8'}; border: 1px solid var(--border-subtle);">
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

    // ================= 5. MODAL HELPERS =================
    window.openModal = function (id) {
      const el = document.getElementById(id);
      if (el) {
        el._prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        el.classList.add('open');
        const firstInput = el.querySelector('input:not([type=hidden]):not([disabled]), button:not(.modal-close):not([disabled])');
        if (firstInput) setTimeout(() => firstInput.focus(), 50);
      }
    };

    window.closeModal = function (id) {
      const el = document.getElementById(id);
      if (!el) return;
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
          else el.classList.remove('open');
        }
      });
    });

    // =========================================================================
    // KHU VỰC ĐỘNG LỰC: NGƯỜI CON GÁI PHÙNG VĂN QUYỀN YÊU
    // =========================================================================
    const ALI_PHOTOS = [
      'igexport-Daasz15CSO_-2.webp', 'igexport-Daasz15CSO_-3.webp', 'igexport-Daasz15CSO_-4.webp',
      'igexport-Daasz15CSO_-5.webp', 'igexport-Daasz15CSO_-6.webp', 'igexport-Daasz15CSO_-7.webp',
      'igexport-Daasz15CSO_.webp', 'igexport-Dae9kAVCbKL-10.webp', 'igexport-Dae9kAVCbKL-11.webp',
      'igexport-Dae9kAVCbKL-2.webp', 'igexport-Dae9kAVCbKL-3.webp', 'igexport-Dae9kAVCbKL-4.webp',
      'igexport-Dae9kAVCbKL-5.webp', 'igexport-Dae9kAVCbKL-6.webp', 'igexport-Dae9kAVCbKL-7.webp',
      'igexport-Dae9kAVCbKL-8.webp', 'igexport-Dae9kAVCbKL-9.webp', 'igexport-Dae9kAVCbKL.webp',
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
        if (openModals.length === 0) return;
        const topModal = openModals[openModals.length - 1];
        if (topModal.id) window.closeModal(topModal.id);
        else topModal.classList.remove('open');
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
      const allJobs = v.jobs || [];
      const allLedger = v.ledger || [];

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
          const priceLabel = item.price ? ` (${formatShortK(item.price)})` : '';
          return `<button type="button" class="work-suggest-chip font-tabular" data-svc="${safeSvc}" data-price="${item.price || 0}" onclick="pickWorkService(this.getAttribute('data-svc'), Number(this.getAttribute('data-price')))">${safeSvc.trim()}${priceLabel}</button>`;
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

    window.pickWorkService = function (svcName, defaultPrice) {
      const input = document.getElementById('work-job-service');
      if (input) {
        input.value = svcName;
        input.focus();
        try {
          input.setSelectionRange(svcName.length, svcName.length);
        } catch (e) { }
      }
      const priceInput = document.getElementById('work-job-price');
      if (defaultPrice > 0 && priceInput && !priceInput.value) {
        setWorkJobPrice(defaultPrice);
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

    window.setWorkJobPrice = function (vnd) {
      const input = document.getElementById('work-job-price');
      if (input) {
        input.value = vnd / 1000;
        updateWorkPricePreview(input.value);
      }
      document.querySelectorAll('#work-job-form .btn-price-chip').forEach(btn => {
        const match = btn.textContent.trim() === (vnd / 1000) + 'k';
        btn.classList.toggle('active', match);
      });
    };

    window.updateWorkPricePreview = function (rawVal) {
      const preview = document.getElementById('work-job-price-preview');
      if (!preview) return;
      let n = parseInt(rawVal, 10);
      if (!n || n <= 0) {
        preview.textContent = '';
        return;
      }
      if (n < 1000) n = n * 1000;
      preview.textContent = '= ' + formatVND(n);
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
      const rawPrice = parseInt(document.getElementById('work-job-price').value, 10);
      const channel = document.getElementById('work-job-channel').value || 'ZL';
      const status = document.getElementById('work-job-status').value || 'TT';

      if (!customer || !service || !rawPrice || rawPrice <= 0) {
        showToast('Nhập đầy đủ tên khách, dịch vụ và giá tiền', true);
        return;
      }

      const price = rawPrice < 1000 ? rawPrice * 1000 : rawPrice;
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
        document.querySelectorAll('#work-job-form .btn-price-chip').forEach(b => b.classList.remove('active'));
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
        document.querySelectorAll('#work-job-form .btn-price-chip').forEach(b => b.classList.remove('active'));
        closeModal('modal-add-work-job');
        showToast(`Đã lưu đơn ${customer} vào máy này (sẽ tự đồng bộ lên Cloud)`);
        workState.calendarMonth = jobDate.slice(0, 7);
        computeWorkFromLocalVault(jobDate, workState.calendarMonth);
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

        return `
        <div class="work-job-card ${isCTT ? 'is-unpaid' : ''}">
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
              <button type="button" class="btn-job-icon btn-del" onclick="deleteWorkJob(${j.id})" aria-label="Xoá đơn ${escapeHTML(j.customer)}">Xoá</button>
            </div>
          </div>
        </div>
      `;
      }).join('');
    }

    window.toggleWorkJobStatus = async function (jobId, nextStatus) {
      const existing = findDebtJobById(jobId);
      const jobUid = existing && existing.uid ? existing.uid : '';
      const payload = { uid: jobUid || undefined, status: nextStatus };
      const qs = jobUid ? `?uid=${encodeURIComponent(jobUid)}` : '';
      try {
        const res = await api('/api/work/job/' + jobId + qs, {
          method: 'PUT',
          deferQueueToast: true,
          body: JSON.stringify(payload)
        });
        if (res && typeof res.work_rev === 'number') {
          syncState.workRev = Math.max(syncState.workRev, res.work_rev);
        }
        showToast(nextStatus === 'TT' ? 'Đã chuyển sang Đã thu tiền (TT)' : 'Đã chuyển sang Khách nợ (CTT)');
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
        showToast(nextStatus === 'TT' ? 'Đã đánh dấu Đã thu (TT) • chờ đồng bộ' : 'Đã đánh dấu Khách nợ (CTT) • chờ đồng bộ');
        computeWorkFromLocalVault(workState.date);
      }
    };

    window.openEditWorkJobModal = function (jobId) {
      const job = findDebtJobById(jobId);
      if (!job) return;

      document.getElementById('edit-job-id').value = job.id;
      document.getElementById('edit-job-date').value = job.date;
      document.getElementById('edit-job-channel').value = job.channel || 'ZL';
      document.getElementById('edit-job-customer').value = job.customer;
      document.getElementById('edit-job-service').value = job.service;
      document.getElementById('edit-job-price').value = job.price;
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
      const rawPrice = parseInt(document.getElementById('edit-job-price').value, 10);
      const status = document.getElementById('edit-job-status').value;

      const price = rawPrice < 1000 ? rawPrice * 1000 : rawPrice;
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
        if (!item || !item.date || item.category === 'borrow') return;
        if (!item.date.startsWith(monthStr + '-')) return;
        if (!map[item.date]) {
          map[item.date] = { date: item.date, count: 0, expense: 0, fund_in: 0, repay: 0 };
        }
        const row = map[item.date];
        const amt = Number(item.amount) || 0;
        row.count++;
        if (item.category === 'expense') row.expense += amt;
        if (item.category === 'fund_in') row.fund_in += amt;
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
      if (brief.fund_in > 0) parts.push(`nộp quỹ ${formatVND(brief.fund_in)}`);
      if (brief.repay > 0) parts.push(`trả nợ ${formatVND(brief.repay)}`);
      return parts.join(', ');
    }

    function getTimedMonthLedgerForMonth(monthStr) {
      const vault = readFinanceVaultSync();
      const allLedger = Array.isArray(vault.ledger) && vault.ledger.length > 0
        ? vault.ledger
        : (workState.ledger || []);
      return monthStr
        ? allLedger.filter(l => l && l.category !== 'borrow' && (l.date || '').startsWith(monthStr + '-'))
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
          <span style="color: #2B5719;">${workIconSVG('shield_ok', 28)}</span>
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

    window.setWorkLedgerAmount = function (vnd) {
      const input = document.getElementById('work-ledger-amount');
      if (input) input.value = vnd / 1000;
    };

    window.setWorkLedgerNote = function (noteText, defaultVnd) {
      const noteInput = document.getElementById('work-ledger-note');
      if (noteInput) noteInput.value = noteText;
      if (defaultVnd > 0) {
        const amtInput = document.getElementById('work-ledger-amount');
        if (amtInput && !amtInput.value) {
          amtInput.value = defaultVnd / 1000;
        }
      }
      if (noteText.toLowerCase().includes('nộp quỹ')) {
        setWorkLedgerCategory('fund_in');
      } else {
        setWorkLedgerCategory('expense');
      }
    };

    window.openAddWorkLedgerModal = function (presetCategory) {
      const hidden = document.getElementById('work-ledger-category');
      if (presetCategory && ['expense', 'fund_in', 'borrow'].includes(presetCategory)) {
        setWorkLedgerCategory(presetCategory);
      } else if (hidden && !['expense', 'fund_in', 'borrow'].includes(hidden.value)) {
        setWorkLedgerCategory('expense');
      }
      openModal('modal-add-work-ledger');
      setTimeout(() => {
        const amtInp = document.getElementById('work-ledger-amount');
        if (amtInp) amtInp.focus();
      }, 80);
    };

    window.submitWorkLedger = async function (e) {
      e.preventDefault();
      const category = document.getElementById('work-ledger-category').value || 'expense';
      const rawAmt = parseInt(document.getElementById('work-ledger-amount').value, 10);
      const note = document.getElementById('work-ledger-note').value.trim();

      if (!rawAmt || rawAmt <= 0 || !note) {
        showToast('Nhập số tiền và nội dung chi tiết', true);
        return;
      }

      const amount = rawAmt < 1000 ? rawAmt * 1000 : rawAmt;
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
      const timedDayLedger = dayLedger.filter(l => l && l.category !== 'borrow');
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
      setTxt('ledger-stat-fund-in', formatShortK(activeSum.fund_in || 0));
      setTxt('ledger-stat-borrow', formatShortK(globalBorrow.remaining));
      setTxt('ledger-stat-repay', formatShortK(activeSum.repay_amount || 0));

      const fundBalRow = document.getElementById('ledger-stat-fund-bal-row');
      if (fundBalRow) {
        if ((activeSum.fund_bal || 0) > 0) {
          fundBalRow.style.display = 'flex';
          fundBalRow.innerHTML = `<span class="work-extra-pill font-tabular">${workIconSVG('fund_bal', 13)} <span>Số quỹ: ${formatShortK(activeSum.fund_bal)}</span></span>`;
        } else {
          fundBalRow.style.display = 'none';
          fundBalRow.innerHTML = '';
        }
      }

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

      const allSettled = sum.totalCount > 0 && sum.unpaidCount === 0;
      if (btn) btn.classList.toggle('is-all-settled', allSettled);

      if (badgeEl) {
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
      // Chỉ hiển thị Chi tiêu / Phát sinh, Nộp Quỹ (và mục phát sinh theo thời gian tạo); riêng Mượn nằm cố định trong nút gom toàn thời gian.
      const list = (workState.ledger || []).filter(item => item && item.category !== 'borrow');
      const dm = formatDayMonth(curDate);

      if (titleEl) titleEl.textContent = dm ? `Phát sinh ngày ${dm}` : 'Phát sinh trong ngày';
      if (subEl) subEl.textContent = `${list.length} khoản`;
      if (!container) return;

      if (list.length === 0) {
        container.innerHTML = `<div class="empty-state-box">Chưa có khoản chi tiêu hay nộp quỹ nào trong ngày ${dm || formatVNDate(curDate)}.</div>`;
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

    let activeRepayLedgerId = null;
    let repaySubmitting = false;

    function parseInstallmentInput(rawVal, remaining) {
      const num = Number(String(rawVal == null ? '' : rawVal).trim());
      if (!Number.isFinite(num) || num <= 0) return 0;
      const rounded = Math.round(num);
      if (remaining > 0 && remaining < 1000 && rounded === remaining) {
        return remaining;
      }
      if (num < 1000) {
        return Math.round(num * 1000);
      }
      return rounded;
    }

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
      const presets = [100000, 200000, 500000, 1000000].filter(v => v < remaining);
      const chipBtns = presets.map(v =>
        `<button type="button" class="btn-price-chip" data-vnd="${v}" onclick="${onClickFnName}(${v})">${escapeHTML(formatShortK(v))}</button>`
      );
      chipBtns.push(
        `<button type="button" class="btn-price-chip is-pay-all" data-vnd="${remaining}" onclick="${onClickFnName}(${remaining})">Trả hết (${escapeHTML(formatShortK(remaining))})</button>`
      );
      return chipBtns.join('');
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
      const val = Number(vnd) || 0;
      if (val <= 0) return;
      // Values >= 1.000.000 or non-multiples of 1000 must stay in full VND to avoid the <1000 multiplier trap.
      input.value = (val >= 1000 && val < 1000000 && val % 1000 === 0)
        ? String(val / 1000)
        : String(val);
      previewFn();
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
      const amtInput = document.getElementById('repay-amount');
      const previewEl = document.getElementById('repay-amount-preview');
      const afterEl = document.getElementById('repay-amount-after');
      const idEl = document.getElementById('repay-ledger-id');
      const ledgerId = Number((idEl && idEl.value) || activeRepayLedgerId);
      const item = findBorrowLedgerItem(ledgerId);
      const remaining = item ? getBorrowTotals(item).remaining : 0;

      const rawStr = amtInput ? amtInput.value.trim() : '';
      const chips = document.querySelectorAll('#repay-quick-chips .btn-price-chip');

      if (!rawStr) {
        if (previewEl) previewEl.textContent = '';
        if (afterEl) afterEl.textContent = '';
        setRepayAmountError('');
        chips.forEach(c => c.classList.remove('active'));
        return 0;
      }

      const amount = parseInstallmentInput(rawStr, remaining);
      chips.forEach(c => {
        c.classList.toggle('active', Number(c.getAttribute('data-vnd')) === amount);
      });

      if (amount <= 0 || (amount < 1000 && !(remaining > 0 && remaining < 1000 && amount === remaining))) {
        if (previewEl) previewEl.textContent = amount > 0 ? ('= ' + formatVND(amount)) : '';
        if (afterEl) afterEl.textContent = '';
        setRepayAmountError('Số tiền trả phải từ 1.000đ trở lên.');
        return 0;
      }

      if (previewEl) previewEl.textContent = '= ' + formatVND(amount);
      setRepayAmountError('');
      if (afterEl) afterEl.textContent = computeInstallmentAfterText(amount, remaining);
      return amount;
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
          setRepayAmountError('Vui lòng nhập số tiền trả lần này (ví dụ: 500 = 500.000đ).');
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
      const amtInput = document.getElementById('debt-pay-amount');
      const previewEl = document.getElementById('debt-pay-amount-preview');
      const afterEl = document.getElementById('debt-pay-amount-after');
      const idEl = document.getElementById('debt-pay-job-id');
      const jobId = Number((idEl && idEl.value) || activeDebtJobId);
      const job = findDebtJobById(jobId);
      const remaining = job ? getDebtJobTotals(job).remaining : 0;

      const rawStr = amtInput ? amtInput.value.trim() : '';
      const chips = document.querySelectorAll('#debt-pay-quick-chips .btn-price-chip');

      if (!rawStr) {
        if (previewEl) previewEl.textContent = '';
        if (afterEl) afterEl.textContent = '';
        setDebtPayAmountError('');
        chips.forEach(c => c.classList.remove('active'));
        return 0;
      }

      const amount = parseInstallmentInput(rawStr, remaining);
      chips.forEach(c => {
        c.classList.toggle('active', Number(c.getAttribute('data-vnd')) === amount);
      });

      if (amount <= 0 || (amount < 1000 && !(remaining > 0 && remaining < 1000 && amount === remaining))) {
        if (previewEl) previewEl.textContent = amount > 0 ? ('= ' + formatVND(amount)) : '';
        if (afterEl) afterEl.textContent = '';
        setDebtPayAmountError('Số tiền trả phải từ 1.000đ trở lên.');
        return 0;
      }

      if (previewEl) previewEl.textContent = '= ' + formatVND(amount);
      setDebtPayAmountError('');
      if (afterEl) afterEl.textContent = computeInstallmentAfterText(amount, remaining);
      return amount;
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
          setDebtPayAmountError('Vui lòng nhập số tiền trả lần này (ví dụ: 500 = 500.000đ).');
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

    // Khởi động ứng dụng
    init();
  }) ();
