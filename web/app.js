// QuyenHealth - Ultra-fast, minimal Vanilla JS App
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
    toast.className = 'toast';
    toast.style.borderLeft = isErr ? '4px solid #ef4444' : '4px solid #5E9447';
    toast.innerHTML = `<span>${msg}</span><button style="background:none;border:none;color:#8A9185;font-size:16px;cursor:pointer;" onclick="this.parentElement.remove()">&times;</button>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  };

  // API wrapper
  async function api(path, opts = {}) {
    opts.headers = Object.assign({
      'Content-Type': 'application/json'
    }, opts.headers || {});
    try {
      const resp = await fetch(path, opts);
      if (resp.status === 401) {
        showLoginView();
        throw new Error('Chưa đăng nhập');
      }
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.error || 'Có lỗi xảy ra');
      }
      return data;
    } catch (err) {
      if (err.message !== 'Chưa đăng nhập') {
        showToast(err.message, true);
      }
      throw err;
    }
  }

  // Khởi tạo & Kiểm tra đăng nhập
  async function init() {
    registerServiceWorker();
    setupRouting();
    try {
      const me = await api('/api/me');
      if (me && me.ok) {
        if (me.user) {
          state.currentUser = me.user;
          localStorage.setItem('qh_user', me.user);
        }
        showAppView();
        initMotivationSection();
        await loadToday();
        syncFinanceVaultOnBoot();
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
          await loadToday();
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
      await api('/api/logout', { method: 'POST' });
    } catch (e) { }
    localStorage.removeItem('qh_user');
    state.currentUser = 'quyen';
    showLoginView();
  };

  // Quản lý Tab: hôm nay, công việc, thu chi, cài đặt
  window.switchTab = function (tabId) {
    if (tabId === 'records' || tabId === 'meals') tabId = 'today';
    if (tabId === 'overview' || !document.getElementById('tab-' + tabId)) {
      tabId = 'today';
    }
    state.activeTab = tabId;
    document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-pill-btn').forEach(el => {
      el.classList.remove('active');
      el.setAttribute('aria-selected', 'false');
    });

    const targetPane = document.getElementById('tab-' + tabId);
    if (targetPane) targetPane.classList.add('active');

    const navBtn = document.getElementById('nav-btn-' + tabId);
    if (navBtn) {
      navBtn.classList.add('active');
      navBtn.setAttribute('aria-selected', 'true');
    }

    if (tabId === 'work' || tabId === 'ledger') loadWorkData();
    if (tabId === 'settings') {
      loadSettingsData();
      renderFinanceVaultStatus();
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
    const scrollContainer = document.querySelector('.app-content-area');
    if (scrollContainer) {
      scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  function setupRouting() {
    const hash = window.location.hash.replace('#', '');
    if (['today', 'work', 'ledger', 'settings'].includes(hash)) {
      switchTab(hash);
    }
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

    function reconcileMedDosesTaken(target, serverCount) {
      pruneOldMedDoseStorage(state.today);
      const count = Math.min(target, Math.max(0, serverCount || 0));
      let doses = null;
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
            body: JSON.stringify({ remind_med_times: '08:00,12:30,20:00', t_med: '08:00', t_med2: '12:30' })
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
      reconcileMedDosesTaken(state.medTargetCount, state.medTakenCount);
      state.medTakenCount = state.medDosesTaken.filter(Boolean).length;
      state.medTaken = state.medTakenCount >= state.medTargetCount;
    }

    // ================= 1. HÔM NAY =================
    async function loadToday() {
      try {
        const data = await api('/api/today');
        if (data.user) {
          state.currentUser = data.user;
          localStorage.setItem('qh_user', data.user);
        }
        state.today = data.date;
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

    function renderTodayHeader() {
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
        let dotColor = '#8A9185';
        let textColor = '#6E756B';

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
          dotColor = '#65A30D';
          textColor = '#4D7C0F';
        } else if (score > 0) {
          badgeText = 'Đang cải thiện';
          dotColor = '#D97706';
          textColor = '#B45309';
        }

        badgeEl.textContent = badgeText;
        if (statusRowEl) statusRowEl.style.color = textColor;
        if (statusDotEl) statusDotEl.style.backgroundColor = dotColor;
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
      const medSummary = document.getElementById('summary-med-display');
      if (medSummary) {
        if (medCount >= medTarget) {
          medSummary.textContent = `Đủ ${medTarget}/${medTarget} lần`;
          medSummary.style.color = '#2B5719';
        } else if (medCount > 0) {
          medSummary.textContent = `${medCount}/${medTarget} lần`;
          medSummary.style.color = '#B45309';
        } else {
          medSummary.textContent = `0/${medTarget} lần`;
          medSummary.style.color = '#C2410C';
        }
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
      state.waterTotal += ml;
      renderWaterWidget();

      try {
        const cid = 'w_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        const res = await api('/api/water', {
          method: 'POST',
          body: JSON.stringify({ ml, cid, ts: Math.floor(Date.now() / 1000) })
        });
        state.waterTotal = res.total;
        state.waterEntries = res.entries || [];
        renderWaterWidget();
        showToast(`+${ml}ml nước lọc`);
      } catch (e) {
        state.waterTotal -= ml;
        renderWaterWidget();
      }
    };

    window.undoLastWater = async function () {
      if (state.waterEntries.length === 0) return;
      const last = state.waterEntries[state.waterEntries.length - 1];
      try {
        const res = await api('/api/water/' + last.id, { method: 'DELETE' });
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
      const clamped = Math.min(target, Math.max(0, nextCount));
      state.medTakenCount = clamped;
      state.medTaken = clamped >= target;
      renderMedWidget();
      try {
        const res = await api('/api/med', {
          method: 'PUT',
          body: JSON.stringify({ date: state.today, taken_count: clamped, taken: clamped >= target })
        });
        if (res && typeof res.taken_count === 'number') {
          state.medTakenCount = res.taken_count;
        }
        if (res && typeof res.target_count === 'number') {
          state.medTargetCount = res.target_count;
        }
        if (state.medDosesTaken.filter(Boolean).length !== state.medTakenCount) {
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
      try {
        const res = await api('/api/weight', {
          method: 'POST',
          body: JSON.stringify({ kg, date: state.today })
        });
        if (res && Array.isArray(res.rows)) {
          state.weights = res.rows;
        }
        state.todayWeight = kg;
        state.currentWeight = kg;
        renderWeightStepper();
        closeModal('modal-weight');
        showToast(`Đã lưu cân nặng hôm nay: ${kg.toFixed(1)} kg`);
      } catch (err) { }
    };

    // --- CHECKLIST 3 BỮA ĂN HEALTHY HÔM NAY (GIỐNG THUỐC BỔ GAN: ĐÃ ĂN / CHƯA ĂN) ---
    const MEAL_SLOT_ORDER = ['breakfast', 'lunch', 'dinner'];
    const MEAL_SLOT_META = {
      breakfast: { label: 'Bữa sáng Healthy', hint: '06:30 – 08:30', order: 1 },
      lunch: { label: 'Bữa trưa Healthy', hint: '11:30 – 13:00', order: 2 },
      dinner: { label: 'Bữa tối Healthy', hint: '18:00 – 19:30', order: 3 }
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

    function renderMealsWidget() {
      const mealsList = normalizeTodayHealthyMeals();
      state.todayMeals = mealsList;
      const target = mealsList.length;
      const doneCount = mealsList.filter(m => m.status === 'done').length;
      const pct = Math.min(100, Math.round((doneCount / target) * 100));

      const curEl = document.getElementById('meal-cur-count');
      if (curEl) curEl.textContent = String(doneCount);

      const targetEl = document.getElementById('meal-target-count');
      if (targetEl) targetEl.textContent = `${target} bữa`;

      const pctEl = document.getElementById('meal-percent-badge');
      if (pctEl) pctEl.textContent = `${pct}%`;

      const fillEl = document.getElementById('meal-progress-fill');
      if (fillEl) fillEl.style.width = `${pct}%`;

      const grid = document.getElementById('today-meal-checklist-grid');
      if (grid) {
        const firstPendingIdx = mealsList.findIndex(m => m.status !== 'done');
        grid.innerHTML = mealsList.map((m, i) => {
          const meta = MEAL_SLOT_META[m.slot] || { label: m.slot, hint: '' };
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
              <span class="med-dose-time">${escapeHtml(meta.hint)}</span>
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

      meal.status = nextStatus;
      meal.note = '';
      renderMealsWidget();
      renderDailyHealthScore();

      try {
        const res = await api('/api/meals/check', {
          method: 'POST',
          body: JSON.stringify({ date: state.today, slot, status: nextStatus, note: '' })
        });
        meal.status = res.status;
        meal.note = res.note || '';
        renderMealsWidget();
        renderDailyHealthScore();

        const target = MEAL_SLOT_ORDER.length;
        const doneCount = state.todayMeals.filter(m => m.status === 'done').length;
        const meta = MEAL_SLOT_META[slot] || { label: slot };
        if (res.status === 'done') {
          showToast(doneCount >= target
            ? `Đã ăn đủ ${doneCount}/${target} bữa Healthy hôm nay!`
            : `Đã đánh dấu ${meta.label} (${doneCount}/${target} bữa)`);
        } else {
          showToast(`Đã bỏ đánh dấu ${meta.label} (${doneCount}/${target} bữa)`);
        }
      } catch (e) {
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

    async function loadSettingsData() {
      try {
        const data = await api('/api/settings');
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
        el.classList.add('open');
        const firstInput = el.querySelector('input:not([type=hidden]), button:not(.modal-close)');
        if (firstInput) setTimeout(() => firstInput.focus(), 50);
      }
    };

    window.closeModal = function (id) {
      const el = document.getElementById(id);
      if (el) el.classList.remove('open');
    };

    document.querySelectorAll('.modal-overlay').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target === el) el.classList.remove('open');
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
        document.querySelectorAll('.modal-overlay.open').forEach(el => {
          el.classList.remove('open');
        });
      }
    });

    // =========================================================================
    // 6. SỔ CÔNG VIỆC CỦA QUYỀN (THAY THẾ BẢNG EXCEL TRÊN ĐIỆN THOẠI)
    // =========================================================================
    let workState = {
      date: '',
      month: '',
      today: '',
      heroScope: 'day', // 'day' | 'month'
      ledgerScope: 'day', // 'day' | 'month'
      subTab: 'jobs', // 'jobs' | 'unpaid' | 'month'
      jobs: [],
      ledger: [],
      daySummary: {},
      monthSummary: {},
      unpaidGroups: [],
      totalUnpaidAll: 0,
      totalUnpaidJobs: 0,
      recentDays: [],
      suggestions: { customers: [], services: [] }
    };

    function escapeHTML(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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
        if (!raw) return { db_id: '', updated_at: 0, dirty: false, jobs: [], ledger: [] };
        const parsed = JSON.parse(raw);
        return {
          db_id: parsed.db_id || '',
          updated_at: parsed.updated_at || 0,
          dirty: Boolean(parsed.dirty),
          jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
          ledger: Array.isArray(parsed.ledger) ? parsed.ledger : []
        };
      } catch (e) {
        return { db_id: '', updated_at: 0, dirty: false, jobs: [], ledger: [] };
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
          try {
            localStorage.setItem(FINANCE_VAULT_KEY, JSON.stringify(idbVault));
          } catch (e) { }
          return idbVault;
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
        version: 1,
        db_id: vaultInput.db_id !== undefined ? vaultInput.db_id : cur.db_id,
        updated_at: Date.now(),
        dirty: Boolean(vaultInput.dirty),
        jobs: Array.isArray(vaultInput.jobs) ? vaultInput.jobs : cur.jobs,
        ledger: Array.isArray(vaultInput.ledger) ? vaultInput.ledger : cur.ledger
      };
      try {
        localStorage.setItem(FINANCE_VAULT_KEY, JSON.stringify(payload));
      } catch (e) { }
      idbSet('vault_main', payload);
      writeToLinkedDiskFile(payload);
      renderFinanceVaultStatus(payload);
      return payload;
    }

    function removeJobFromLocalVault(jobId) {
      const cur = readFinanceVaultSync();
      cur.jobs = (cur.jobs || []).filter(j => Number(j.id) !== Number(jobId));
      saveFinanceVaultToDevice(cur);
    }

    function removeLedgerFromLocalVault(ledgerId) {
      const cur = readFinanceVaultSync();
      cur.ledger = (cur.ledger || []).filter(l => Number(l.id) !== Number(ledgerId));
      saveFinanceVaultToDevice(cur);
    }

    function updateLinkDiskButtonUI() {
      const lbl = document.getElementById('work-link-disk-label');
      const btn = document.getElementById('btn-work-link-disk');
      if (!lbl || !btn) return;
      if (linkedFinanceFileHandle) {
        lbl.textContent = 'Đã gắn ổ cứng';
        btn.classList.add('is-linked');
      } else if ('showSaveFilePicker' in window) {
        lbl.textContent = 'Gắn file ổ cứng';
        btn.classList.remove('is-linked');
      } else {
        lbl.textContent = 'Đồng bộ két';
        btn.classList.remove('is-linked');
      }
    }

    function renderFinanceVaultStatus(vaultOpt) {
      const v = vaultOpt || readFinanceVaultSync();
      const badgeEl = document.getElementById('work-vault-badge');
      const subEl = document.getElementById('work-vault-sub');
      const jobCount = (v.jobs || []).length;
      const ledgerCount = (v.ledger || []).length;

      if (badgeEl) {
        badgeEl.textContent = `Đã lưu ${jobCount} đơn • ${ledgerCount} thu chi`;
      }
      if (subEl) {
        const timeStr = v.updated_at
          ? new Date(v.updated_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
          : '';
        if (linkedFinanceFileHandle) {
          subEl.textContent = `Đang tự động lưu kép vào trình duyệt & file ổ cứng máy cá nhân${timeStr ? ' (lúc ' + timeStr + ')' : ''}. Không lo mất dữ liệu khi redeploy.`;
        } else {
          subEl.textContent = `Đã khóa an toàn trên máy cá nhân${timeStr ? ' (cập nhật ' + timeStr + ')' : ''} — tự động khôi phục 100% mỗi khi redeploy web.`;
        }
      }
      updateLinkDiskButtonUI();
    }

    async function syncFinanceVaultOnBoot() {
      try {
        const localVault = await hydrateVaultFromIDB();
        renderFinanceVaultStatus(localVault);
        const localHasData = (localVault.jobs && localVault.jobs.length > 0) || (localVault.ledger && localVault.ledger.length > 0);
        const srv = await api('/api/work/vault');
        const srvJobs = srv.jobs || [];
        const srvLedger = srv.ledger || [];
        const srvEmpty = srvJobs.length === 0 && srvLedger.length === 0;
        const dbChanged = Boolean(localVault.db_id && srv.db_id && localVault.db_id !== srv.db_id);

        if (localHasData && (srvEmpty || dbChanged || localVault.dirty)) {
          const synced = await api('/api/work/vault', {
            method: 'POST',
            body: JSON.stringify({
              mode: localVault.dirty ? 'replace' : 'merge',
              jobs: localVault.jobs,
              ledger: localVault.ledger
            })
          });
          saveFinanceVaultToDevice({
            db_id: synced.db_id || srv.db_id,
            dirty: false,
            jobs: synced.jobs || localVault.jobs,
            ledger: synced.ledger || localVault.ledger
          });
          showToast('Đã tự động khôi phục dữ liệu tài chính từ máy cá nhân sau khi redeploy');
        } else if (srvJobs.length > 0 || srvLedger.length > 0) {
          saveFinanceVaultToDevice({
            db_id: srv.db_id,
            dirty: false,
            jobs: srvJobs,
            ledger: srvLedger
          });
        }
      } catch (e) { }
    }

    function computeWorkFromLocalVault(targetDate) {
      const v = readFinanceVaultSync();
      const date = targetDate || workState.date || state.today || new Date().toISOString().slice(0, 10);
      const month = date.slice(0, 7);
      const allJobs = v.jobs || [];
      const allLedger = v.ledger || [];

      const dayJobs = allJobs.filter(j => j.date === date);
      const dayLedger = allLedger.filter(l => l.date === date);

      const calcSum = (jobsArr, ledgerArr) => {
        const s = {
          total_jobs: 0, paid_jobs: 0, unpaid_jobs: 0,
          total_revenue: 0, paid_amount: 0, unpaid_amount: 0,
          expense_amount: 0, net_cash: 0, fund_in: 0, fund_bal: 0,
          borrow_amount: 0, repay_amount: 0
        };
        jobsArr.forEach(j => {
          const p = Number(j.price) || 0;
          s.total_jobs++;
          s.total_revenue += p;
          if (j.status === 'CTT') {
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
          if (l.category === 'borrow') s.borrow_amount += a;
          if (l.category === 'repay') s.repay_amount += a;
        });
        s.net_cash = s.paid_amount - s.expense_amount;
        return s;
      };

      const monthJobs = allJobs.filter(j => (j.date || '').startsWith(month + '-'));
      const monthLedger = allLedger.filter(l => (l.date || '').startsWith(month + '-'));

      const byCust = {};
      let totalUnpaidAll = 0;
      let totalUnpaidJobs = 0;
      allJobs.filter(j => j.status === 'CTT').forEach(j => {
        const key = (j.customer || '').trim().toLowerCase();
        if (!byCust[key]) {
          byCust[key] = { customer: j.customer, channel: j.channel || 'ZL', job_count: 0, total_amount: 0, jobs: [] };
        }
        byCust[key].job_count++;
        byCust[key].total_amount += Number(j.price) || 0;
        byCust[key].jobs.push(j);
        totalUnpaidAll += Number(j.price) || 0;
        totalUnpaidJobs++;
      });

      const byDate = {};
      monthJobs.forEach(j => {
        if (!byDate[j.date]) {
          byDate[j.date] = { date: j.date, job_count: 0, total_revenue: 0, paid_amount: 0, unpaid_amount: 0, expense_amount: 0 };
        }
        byDate[j.date].job_count++;
        byDate[j.date].total_revenue += Number(j.price) || 0;
        if (j.status === 'CTT') byDate[j.date].unpaid_amount += Number(j.price) || 0;
        else byDate[j.date].paid_amount += Number(j.price) || 0;
      });
      monthLedger.filter(l => l.category === 'expense').forEach(l => {
        if (!byDate[l.date]) {
          byDate[l.date] = { date: l.date, job_count: 0, total_revenue: 0, paid_amount: 0, unpaid_amount: 0, expense_amount: 0 };
        }
        byDate[l.date].expense_amount += Number(l.amount) || 0;
      });

      workState.date = date;
      workState.month = month;
      workState.today = state.today || date;
      workState.jobs = dayJobs;
      workState.ledger = dayLedger;
      workState.daySummary = calcSum(dayJobs, dayLedger);
      workState.monthSummary = calcSum(monthJobs, monthLedger);
      workState.unpaidGroups = Object.values(byCust).sort((a, b) => b.total_amount - a.total_amount);
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

        saveFinanceVaultToDevice({
          dirty: true,
          jobs,
          ledger
        });

        const synced = await api('/api/work/vault', {
          method: 'POST',
          body: JSON.stringify({
            mode: 'replace',
            jobs,
            ledger
          })
        });

        saveFinanceVaultToDevice({
          db_id: synced.db_id || '',
          dirty: false,
          jobs: synced.jobs || jobs,
          ledger: synced.ledger || ledger
        });

        showToast(`Đã nạp thành công ${jobs.length} đơn & ${ledger.length} khoản thu chi!`);
        await loadWorkData(workState.date);
      } catch (err) {
        showToast('Lỗi nạp file: ' + (err.message || 'File không hợp lệ'), true);
      }
      e.target.value = '';
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

      await syncFinanceVaultOnBoot();
      const v = readFinanceVaultSync();
      showToast(`Đã đồng bộ & lưu an toàn ${(v.jobs || []).length} đơn, ${(v.ledger || []).length} thu chi trên máy này`);
    };

    async function loadWorkData(targetDate) {
      await hydrateVaultFromIDB();
      const dateParam = targetDate || workState.date || state.today || '';
      const monthParam = dateParam ? dateParam.slice(0, 7) : '';
      const qs = dateParam ? `?date=${encodeURIComponent(dateParam)}&month=${encodeURIComponent(monthParam)}` : '';
      try {
        let data = await api('/api/work' + qs);
        const localVault = readFinanceVaultSync();
        const localHasData = (localVault.jobs && localVault.jobs.length > 0) || (localVault.ledger && localVault.ledger.length > 0);
        const srvJobs = data.vault_jobs || [];
        const srvLedger = data.vault_ledger || [];
        const srvEmpty = srvJobs.length === 0 && srvLedger.length === 0;
        const dbChanged = Boolean(localVault.db_id && data.db_id && localVault.db_id !== data.db_id);

        // Nếu server vừa bị reset do Redeploy (hoặc đang có dữ liệu lưu trên máy cá nhân chưa đẩy lên), tự động khôi phục ngay lập tức
        if (localHasData && (srvEmpty || dbChanged || localVault.dirty)) {
          await api('/api/work/vault', {
            method: 'POST',
            body: JSON.stringify({
              mode: localVault.dirty ? 'replace' : 'merge',
              jobs: localVault.jobs,
              ledger: localVault.ledger
            })
          });
          data = await api('/api/work' + qs);
          showToast('Đã tự động khôi phục dữ liệu tài chính từ máy cá nhân');
        }

        saveFinanceVaultToDevice({
          db_id: data.db_id || localVault.db_id,
          dirty: false,
          jobs: data.vault_jobs || [],
          ledger: data.vault_ledger || []
        });

        workState.date = data.date || state.today;
        workState.month = data.month || workState.date.slice(0, 7);
        workState.today = data.today || state.today;
        workState.jobs = data.jobs || [];
        workState.ledger = data.ledger || [];
        workState.daySummary = data.day_summary || {};
        workState.monthSummary = data.month_summary || {};
        workState.unpaidGroups = data.unpaid_groups || [];
        workState.totalUnpaidAll = data.total_unpaid_all || 0;
        workState.totalUnpaidJobs = data.total_unpaid_jobs || 0;
        workState.recentDays = data.recent_days || [];
        workState.suggestions = data.suggestions || { customers: [], services: [] };

        renderWorkScreen();
      } catch (e) {
        // Nếu server đang khởi động lại trong lúc Redeploy, hiển thị trực tiếp từ bộ nhớ máy cá nhân
        computeWorkFromLocalVault(dateParam);
      }
    }

    function renderWorkScreen() {
      // 1. Date bar
      const dateInput = document.getElementById('work-date-input');
      if (dateInput) dateInput.value = workState.date;

      const humanEl = document.getElementById('work-date-human');
      if (humanEl) {
        if (workState.date === workState.today) {
          humanEl.textContent = `Hôm nay (${formatDayMonth(workState.date)})`;
        } else if (workState.date === shiftDateStr(workState.today, -1)) {
          humanEl.textContent = `Hôm qua (${formatDayMonth(workState.date)})`;
        } else {
          humanEl.textContent = `Ngày ${formatDayMonth(workState.date)}`;
        }
      }

      const todayBtn = document.getElementById('btn-work-today');
      if (todayBtn) {
        todayBtn.style.opacity = workState.date === workState.today ? '0.55' : '1';
      }

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
      setTxt('work-day-net', formatVND(activeSum.net_cash || 0));
      setTxt('work-day-paid', formatShortK(activeSum.paid_amount || 0));
      setTxt('work-day-unpaid', formatShortK(activeSum.unpaid_amount || 0));
      setTxt('work-day-expense', formatShortK(activeSum.expense_amount || 0));

      // Subtab badges
      setTxt('work-badge-day-jobs', String(workState.jobs.length));
      setTxt('work-badge-unpaid-all', String(workState.totalUnpaidJobs || 0));

      renderWorkSuggestions();
      renderWorkJobsList();
      renderWorkMonthDays();
      renderWorkUnpaidGroups();
      renderWorkMonthReport();
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

    window.stepWorkDate = function (delta) {
      const base = workState.date || state.today;
      const nextDate = shiftDateStr(base, delta);
      loadWorkData(nextDate);
    };

    window.stepWorkMonth = function (deltaMonths) {
      const curMonth = workState.month || (workState.date || state.today).slice(0, 7);
      const parts = curMonth.split('-').map(Number);
      const dt = new Date(Date.UTC(parts[0], parts[1] - 1 + deltaMonths, 1));
      const nextMonthStr = dt.toISOString().slice(0, 7);
      const todayStr = workState.today || state.today || '';
      const targetDate = todayStr.startsWith(nextMonthStr) ? todayStr : `${nextMonthStr}-01`;
      loadWorkData(targetDate);
    };

    window.onWorkDateChange = function (val) {
      if (val) loadWorkData(val);
    };

    window.jumpWorkToday = function () {
      loadWorkData(workState.today || state.today);
    };

    window.switchWorkSubTab = function (sub) {
      if (sub === 'ledger') {
        switchTab('ledger');
        return;
      }
      workState.subTab = sub;
      ['jobs', 'unpaid', 'month'].forEach(k => {
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
      try {
        await api('/api/work/job', {
          method: 'POST',
          body: JSON.stringify({
            date: jobDate,
            customer,
            channel,
            service,
            price,
            status
          })
        });
        document.getElementById('work-job-service').value = '';
        document.getElementById('work-job-price').value = '';
        updateWorkPricePreview('');
        document.querySelectorAll('#work-job-form .btn-price-chip').forEach(b => b.classList.remove('active'));
        closeModal('modal-add-work-job');
        showToast(`Đã lưu đơn ${customer} (${formatShortK(price)} - ${status})`);
        await loadWorkData(workState.date);
      } catch (err) {
        // Dự phòng khi server đang redeploy: lưu trực tiếp vào máy cá nhân
        const v = readFinanceVaultSync();
        v.jobs.push({
          id: Date.now(),
          date: jobDate,
          customer,
          channel,
          service,
          price,
          status,
          note: '',
          ts: Math.floor(Date.now() / 1000)
        });
        v.dirty = true;
        saveFinanceVaultToDevice(v);
        document.getElementById('work-job-service').value = '';
        document.getElementById('work-job-price').value = '';
        updateWorkPricePreview('');
        document.querySelectorAll('#work-job-form .btn-price-chip').forEach(b => b.classList.remove('active'));
        closeModal('modal-add-work-job');
        showToast(`Đã lưu đơn ${customer} vào máy cá nhân (tự đồng bộ khi mạng/server sẵn sàng)`);
        computeWorkFromLocalVault(jobDate);
      }
    };

    function renderWorkJobsList() {
      const container = document.getElementById('work-jobs-list');
      const subEl = document.getElementById('work-jobs-list-sub');
      if (!container) return;

      const jobs = workState.jobs || [];
      const ds = workState.daySummary || {};
      if (subEl) {
        subEl.textContent = `${jobs.length} đơn • Tổng ${formatShortK(ds.total_revenue || 0)}`;
      }

      if (jobs.length === 0) {
        container.innerHTML = `
        <div class="empty-state-box">
          Chưa có đơn dịch vụ nào trong ngày ${formatVNDate(workState.date)}.<br>
          Bấm nút <strong>+ Ghi đơn mới</strong> để lưu đơn chỉ trong vài giây.
        </div>
      `;
        return;
      }

      container.innerHTML = jobs.map((j, idx) => {
        const isCTT = j.status === 'CTT';
        const chClass = j.channel === 'FB' ? 'ch-fb' : 'ch-zl';
        const stClass = isCTT ? 'st-ctt' : 'st-tt';
        const stLabel = isCTT
          ? `${workIconSVG('clock', 13)} <span>Nợ (CTT) • Bấm để thu</span>`
          : `${workIconSVG('check', 13)} <span>Đã thu (TT)</span>`;

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
              <div class="font-tabular" style="font-size: 11.5px; color: var(--text-sub); margin-top: 2px;">${escapeHTML(formatDayMonthTime(j.date || workState.date, j.ts))}</div>
            </div>
            <div class="work-job-actions">
              <button type="button" class="btn-status-toggle ${stClass}" onclick="toggleWorkJobStatus(${j.id}, '${isCTT ? 'TT' : 'CTT'}')" aria-label="Đổi trạng thái thanh toán đơn ${escapeHTML(j.customer)}">
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
      try {
        await api('/api/work/job/' + jobId, {
          method: 'PUT',
          body: JSON.stringify({ status: nextStatus })
        });
        showToast(nextStatus === 'TT' ? 'Đã chuyển sang Đã thu tiền (TT)' : 'Đã chuyển sang Khách nợ (CTT)');
        await loadWorkData(workState.date);
      } catch (e) { }
    };

    window.openEditWorkJobModal = function (jobId) {
      let job = (workState.jobs || []).find(x => x.id === jobId);
      if (!job) {
        for (const g of (workState.unpaidGroups || [])) {
          const found = (g.jobs || []).find(x => x.id === jobId);
          if (found) {
            job = found;
            break;
          }
        }
      }
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
      try {
        await api('/api/work/job/' + id, {
          method: 'PUT',
          body: JSON.stringify({ date, channel, customer, service, price, status })
        });
        closeModal('modal-edit-work-job');
        showToast('Đã cập nhật đơn dịch vụ');
        await loadWorkData(workState.date);
      } catch (err) { }
    };

    window.deleteWorkJob = async function (jobId) {
      if (!confirm('Xoá đơn dịch vụ này khỏi sổ công việc? Thao tác này không thể hoàn tác.')) return;
      try {
        await api('/api/work/job/' + jobId, { method: 'DELETE' });
        removeJobFromLocalVault(jobId);
        showToast('Đã xoá đơn dịch vụ');
        await loadWorkData(workState.date);
      } catch (e) { }
    };

    function renderWorkMonthDays() {
      const container = document.getElementById('work-month-days-list');
      if (!container) return;
      const days = workState.recentDays || [];
      if (days.length === 0) {
        container.innerHTML = `<div class="empty-state-box">Chưa có dữ liệu ngày làm việc nào trong tháng này.</div>`;
        return;
      }

      container.innerHTML = days.map(d => {
        const isSelected = d.date === workState.date;
        const netDay = (d.paid_amount || 0) - (d.expense_amount || 0);
        return `
        <button type="button" class="work-day-brief-row font-tabular" style="${isSelected ? 'border-color: #6CA844; background-color: #F2F9EE;' : ''}" onclick="loadWorkData('${d.date}')">
          <div>
            <strong style="font-size: 13.5px; color: var(--text-main);">Ngày ${formatDayMonth(d.date)}</strong>
            <div style="font-size: 11.5px; color: var(--text-sub); margin-top: 2px;">
              ${d.job_count} đơn &bull; Đã thu ${formatShortK(d.paid_amount)}
              ${d.unpaid_amount > 0 ? ` &bull; <span style="color:#B45309;font-weight:700;">Nợ ${formatShortK(d.unpaid_amount)}</span>` : ''}
              ${d.expense_amount > 0 ? ` &bull; Chi ${formatShortK(d.expense_amount)}` : ''}
            </div>
          </div>
          <div style="text-align: right;">
            <span style="font-size: 14.5px; font-weight: 800; color: #1E3B13;">${formatShortK(d.total_revenue)}</span>
            <div style="font-size: 10.5px; font-weight: 700; color: var(--text-muted); margin-top: 1px;">Còn ${formatShortK(netDay)}</div>
          </div>
        </button>
      `;
      }).join('');
    }

    function renderWorkMonthReport() {
      const ms = workState.monthSummary || {};
      const days = workState.recentDays || [];
      const activeDaysCount = days.length;
      const jobDaysCount = days.filter(d => (d.job_count || 0) > 0).length;

      let monthLabel = workState.month || '';
      if (workState.month) {
        const parts = workState.month.split('-');
        monthLabel = `Tháng ${parseInt(parts[1], 10)}/${parts[0]}`;
      }

      const setTxt = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };

      setTxt('work-mview-nav-title', monthLabel);
      setTxt('work-mview-eyebrow', `TỔNG DOANH THU ${monthLabel.toUpperCase()}`);
      setTxt('work-mview-badge', `${ms.total_jobs || 0} đơn • ${activeDaysCount} ngày`);

      const revStr = formatVND(ms.total_revenue || 0);
      setTxt('work-mview-revenue', revStr);
      const mRevEl = document.getElementById('work-mview-revenue');
      if (mRevEl) {
        mRevEl.classList.toggle('is-long', revStr.length >= 12);
      }

      setTxt('work-mview-net', formatVND(ms.net_cash || 0));
      setTxt('work-mview-paid', formatShortK(ms.paid_amount || 0));
      setTxt('work-mview-paid-sub', `${ms.paid_jobs || 0} đơn đã thu`);
      setTxt('work-mview-unpaid', formatShortK(ms.unpaid_amount || 0));
      setTxt('work-mview-unpaid-sub', `${ms.unpaid_jobs || 0} đơn nợ`);
      setTxt('work-mview-expense', formatShortK(ms.expense_amount || 0));
      const avgExp = activeDaysCount > 0 ? Math.round((ms.expense_amount || 0) / activeDaysCount) : 0;
      setTxt('work-mview-expense-sub', avgExp > 0 ? `TB ${formatShortK(avgExp)}/ngày` : 'Phát sinh tháng');

      const avgRev = jobDaysCount > 0 ? Math.round((ms.total_revenue || 0) / jobDaysCount) : 0;
      setTxt('work-mview-avg-day', formatShortK(avgRev));
      setTxt('work-mview-avg-sub', `${jobDaysCount} ngày có đơn`);

      setTxt('work-mview-fund', formatShortK(ms.fund_in || 0));
      setTxt('work-mview-fund-sub', `Số quỹ: ${formatShortK(ms.fund_bal || 0)}`);

      setTxt('work-mview-loan', formatShortK(ms.borrow_amount || 0));
      setTxt('work-mview-loan-sub', `Trả nợ: ${formatShortK(ms.repay_amount || 0)}`);
      setTxt('work-mview-export-btn-txt', `Xuất bảng tổng kết ${monthLabel} ra Excel (.csv)`);

      // 1. Thống kê theo Khách hàng trong tháng
      const custListEl = document.getElementById('work-month-customers-list');
      const custCountEl = document.getElementById('work-mview-cust-count');
      if (custListEl) {
        const vault = readFinanceVaultSync();
        const mPrefix = (workState.month || '') + '-';
        const monthJobs = (vault.jobs || []).filter(j => (j.date || '').startsWith(mPrefix));
        const byCust = {};
        monthJobs.forEach(j => {
          const key = (j.customer || '').trim().toLowerCase();
          if (!key) return;
          if (!byCust[key]) {
            byCust[key] = {
              customer: j.customer,
              channel: j.channel || 'ZL',
              count: 0,
              total: 0,
              paid: 0,
              unpaid: 0
            };
          }
          const p = Number(j.price) || 0;
          byCust[key].count++;
          byCust[key].total += p;
          if (j.status === 'CTT') byCust[key].unpaid += p;
          else byCust[key].paid += p;
        });

        const custArr = Object.values(byCust).sort((a, b) => b.total - a.total);
        if (custCountEl) custCountEl.textContent = `${custArr.length} khách hàng`;

        if (custArr.length === 0) {
          custListEl.innerHTML = `<div class="empty-state-box">Chưa có đơn hàng nào trong ${monthLabel}.</div>`;
        } else {
          custListEl.innerHTML = custArr.map((c, idx) => `
          <div class="work-month-cust-card font-tabular">
            <div style="min-width: 0; flex: 1;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <span class="work-stt-badge">#${idx + 1}</span>
                <span class="work-ch-badge ${c.channel === 'FB' ? 'ch-fb' : 'ch-zl'}">${escapeHTML(c.channel)}</span>
                <strong class="work-job-cust-name">${escapeHTML(c.customer)}</strong>
              </div>
              <div style="font-size: 11.5px; color: var(--text-sub); margin-top: 3px;">
                ${c.count} đơn &bull; Đã thu ${formatShortK(c.paid)}
                ${c.unpaid > 0 ? ` &bull; <span style="color:#B45309;font-weight:700;">Nợ ${formatShortK(c.unpaid)}</span>` : ''}
              </div>
            </div>
            <div style="text-align: right; flex-shrink: 0;">
              <strong style="font-size: 14.5px; font-weight: 800; color: #1E3B13;">${formatVND(c.total)}</strong>
            </div>
          </div>
        `).join('');
        }
      }

      // 2. Bảng kê từng ngày trong tháng
      const fullDaysEl = document.getElementById('work-month-full-days-list');
      const daysCountEl = document.getElementById('work-mview-days-count');
      if (daysCountEl) daysCountEl.textContent = `${days.length} ngày phát sinh`;
      if (fullDaysEl) {
        if (days.length === 0) {
          fullDaysEl.innerHTML = `<div class="empty-state-box">Chưa có dữ liệu ngày làm việc nào trong ${monthLabel}.</div>`;
        } else {
          fullDaysEl.innerHTML = days.map(d => {
            const netDay = (d.paid_amount || 0) - (d.expense_amount || 0);
            return `
            <button type="button" class="work-day-brief-row font-tabular" onclick="loadWorkData('${d.date}'); switchWorkSubTab('jobs');">
              <div style="min-width: 0; flex: 1;">
                <strong style="font-size: 13.5px; color: var(--text-main);">Ngày ${formatDayMonth(d.date)}</strong>
                <div style="font-size: 11.5px; color: var(--text-sub); margin-top: 2px;">
                  ${d.job_count} đơn &bull; Thu ${formatShortK(d.paid_amount)}
                  ${d.unpaid_amount > 0 ? ` &bull; <span style="color:#B45309;font-weight:700;">Nợ ${formatShortK(d.unpaid_amount)}</span>` : ''}
                  ${d.expense_amount > 0 ? ` &bull; Chi ${formatShortK(d.expense_amount)}` : ''}
                </div>
              </div>
              <div style="text-align: right; flex-shrink: 0;">
                <span style="font-size: 14px; font-weight: 800; color: #1E3B13;">${formatVND(d.total_revenue)}</span>
                <div style="font-size: 11px; font-weight: 700; color: #2B5719; margin-top: 1px;">Thực còn: ${formatShortK(netDay)}</div>
              </div>
            </button>
          `;
          }).join('');
        }
      }
    }

    function renderWorkUnpaidGroups() {
      const totalEl = document.getElementById('work-unpaid-total-all');
      const countEl = document.getElementById('work-unpaid-count-all');
      const listEl = document.getElementById('work-unpaid-groups-list');
      if (totalEl) totalEl.textContent = formatVND(workState.totalUnpaidAll || 0);
      if (countEl) countEl.textContent = `${workState.totalUnpaidJobs || 0} đơn nợ`;
      if (!listEl) return;

      const groups = workState.unpaidGroups || [];
      if (groups.length === 0) {
        listEl.innerHTML = `
        <div class="empty-state-box" style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
          <span style="color: #2B5719;">${workIconSVG('shield_ok', 28)}</span>
          <span>Không có khách hàng nào đang nợ (CTT). Tất cả các đơn đều đã thanh toán đủ.</span>
        </div>
      `;
        return;
      }

      listEl.innerHTML = groups.map((g, gIdx) => {
        const safeCust = escapeHTML(g.customer);
        const itemsHtml = (g.jobs || []).map(j => `
        <div class="work-debt-item-row font-tabular">
          <div style="min-width: 0; flex: 1;">
            <strong style="color: var(--text-main);">${formatVNDate(j.date).slice(0, 5)}</strong>:
            <span>${escapeHTML(j.service)}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <strong style="color: #9A3412;">${formatShortK(j.price)}</strong>
            <button type="button" class="btn-status-toggle st-tt" style="min-height: 28px; padding: 2px 8px; font-size: 11px;" onclick="toggleWorkJobStatus(${j.id}, 'TT')" aria-label="Thu tiền đơn ${escapeHTML(j.service)}">Thu đơn này</button>
          </div>
        </div>
      `).join('');

        return `
        <div class="work-debt-group-card">
          <div class="work-debt-group-header">
            <div>
              <div class="work-debt-cust-title">${safeCust} <span class="work-ch-badge ${g.channel === 'FB' ? 'ch-fb' : 'ch-zl'}">${escapeHTML(g.channel)}</span></div>
              <span style="font-size: 11.5px; color: var(--text-sub);">${g.job_count} đơn chưa thanh toán</span>
            </div>
            <span class="work-debt-total-val font-tabular">${formatVND(g.total_amount)}</span>
          </div>
          <div class="work-debt-items-list">${itemsHtml}</div>
          <div class="work-debt-group-actions">
            <button type="button" class="btn-debt-copy" onclick="copyCustomerDebtText(${gIdx})">${workIconSVG('copy', 14)} <span>Copy báo nợ</span></button>
            <button type="button" class="btn-debt-payall" onclick="payAllCustomerDebt(${gIdx})">${workIconSVG('check', 14)} <span>Đã thu hết (${formatShortK(g.total_amount)})</span></button>
          </div>
        </div>
      `;
      }).join('');
    }

    window.copyCustomerDebtText = async function (groupIdx) {
      const g = (workState.unpaidGroups || [])[groupIdx];
      if (!g) return;
      const lines = [`Gửi ${g.customer} danh sách đơn chưa thanh toán (${g.job_count} đơn):`];
      (g.jobs || []).slice().reverse().forEach((j, idx) => {
        const dShort = formatVNDate(j.date).slice(0, 5);
        lines.push(`${idx + 1}. Ngày ${dShort}: ${j.service} = ${formatShortK(j.price)}`);
      });
      lines.push(`Tổng cộng: ${formatVND(g.total_amount)}`);

      const text = lines.join('\n');
      try {
        await navigator.clipboard.writeText(text);
        showToast(`Đã copy báo nợ của ${g.customer} để dán gửi Zalo/FB`);
      } catch (e) {
        showToast('Không thể copy tự động trên trình duyệt này', true);
      }
    };

    window.payAllCustomerDebt = async function (groupIdx) {
      const g = (workState.unpaidGroups || [])[groupIdx];
      if (!g) return;
      if (!confirm(`Xác nhận đã thu đủ ${formatVND(g.total_amount)} (${g.job_count} đơn) của khách "${g.customer}"?`)) return;

      try {
        await api('/api/work/job/pay-customer', {
          method: 'POST',
          body: JSON.stringify({ customer: g.customer })
        });
        showToast(`Đã tất toán toàn bộ đơn nợ của ${g.customer}`);
        await loadWorkData(workState.date);
      } catch (e) { }
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

    window.openAddWorkLedgerModal = function () {
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
      try {
        await api('/api/work/ledger', {
          method: 'POST',
          body: JSON.stringify({
            date: ledgerDate,
            category,
            amount,
            note
          })
        });
        document.getElementById('work-ledger-amount').value = '';
        document.getElementById('work-ledger-note').value = '';
        closeModal('modal-add-work-ledger');
        showToast('Đã lưu khoản mục vào sổ');
        await loadWorkData(workState.date);
      } catch (err) {
        const v = readFinanceVaultSync();
        v.ledger.push({
          id: Date.now(),
          date: ledgerDate,
          category,
          amount,
          note,
          ts: Math.floor(Date.now() / 1000)
        });
        v.dirty = true;
        saveFinanceVaultToDevice(v);
        document.getElementById('work-ledger-amount').value = '';
        document.getElementById('work-ledger-note').value = '';
        closeModal('modal-add-work-ledger');
        showToast('Đã lưu khoản mục vào máy cá nhân');
        computeWorkFromLocalVault(ledgerDate);
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
      const curMonth = workState.month || (curDate ? curDate.slice(0, 7) : '');

      const dateInput = document.getElementById('ledger-date-input');
      if (dateInput) dateInput.value = curDate;

      const humanEl = document.getElementById('ledger-date-human');
      if (humanEl && curDate) {
        if (curDate === todayDate) {
          humanEl.textContent = `Hôm nay (${formatDayMonth(curDate)})`;
        } else if (curDate === shiftDateStr(todayDate, -1)) {
          humanEl.textContent = `Hôm qua (${formatDayMonth(curDate)})`;
        } else {
          humanEl.textContent = `Ngày ${formatDayMonth(curDate)}`;
        }
      }

      const todayBtn = document.getElementById('btn-ledger-today');
      if (todayBtn) {
        todayBtn.style.opacity = curDate === todayDate ? '0.55' : '1';
      }

      const vault = readFinanceVaultSync();
      const allLedger = Array.isArray(vault.ledger) ? vault.ledger : [];
      const monthLedger = curMonth
        ? allLedger.filter(l => (l.date || '').startsWith(curMonth + '-'))
        : [];
      const dayLedger = workState.ledger || [];

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

      setTxt(
        'ledger-summary-date-label',
        isMonthScope
          ? `Tổng chi tiêu ${monthHuman}`
          : (curDate === todayDate ? 'Tổng chi tiêu hôm nay' : `Chi tiêu ngày ${formatDayMonth(curDate)}`)
      );
      setTxt('ledger-day-count-pill', `${isMonthScope ? monthLedger.length : dayLedger.length} khoản`);

      const expStr = formatVND(activeSum.expense_amount || 0);
      setTxt('ledger-hero-expense', expStr);
      const expEl = document.getElementById('ledger-hero-expense');
      if (expEl) expEl.classList.toggle('is-long', expStr.length >= 12);

      setTxt('ledger-hero-net', formatVND(activeSum.net_cash || 0));
      setTxt('ledger-stat-expense', formatShortK(activeSum.expense_amount || 0));
      setTxt('ledger-stat-fund-in', formatShortK(activeSum.fund_in || 0));
      setTxt('ledger-stat-borrow', formatShortK(activeSum.borrow_amount || 0));
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

      renderWorkLedgerList();
      renderLedgerMonthDays(monthLedger, monthHuman);
    }

    function renderWorkLedgerList() {
      const container = document.getElementById('work-ledger-list');
      const titleEl = document.getElementById('ledger-day-list-title');
      const subEl = document.getElementById('ledger-day-list-sub');
      const list = workState.ledger || [];
      const dm = formatDayMonth(workState.date);

      if (titleEl) titleEl.textContent = dm ? `Phát sinh ngày ${dm}` : 'Phát sinh trong ngày';
      if (subEl) subEl.textContent = `${list.length} khoản`;
      if (!container) return;

      if (list.length === 0) {
        container.innerHTML = `
        <div class="empty-state-box">
          Chưa có khoản chi tiêu, nộp quỹ hay mượn/trả nợ nào trong ngày ${dm || formatVNDate(workState.date)}.<br>
          Bấm nút <strong>+ Ghi thu chi</strong> để thêm khoản mục mới.
        </div>
      `;
        return;
      }

      container.innerHTML = list.map(item => `
      <div class="work-job-card">
        <div class="work-job-top">
          <div>
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <span class="work-stt-badge">${getLedgerCatLabel(item.category)}</span>
              <span class="font-tabular" style="font-size: 11.5px; color: var(--text-sub);">${escapeHTML(formatDayMonthTime(item.date || workState.date, item.ts))}</span>
            </div>
            <div class="work-job-cust-name" style="margin-top: 5px;">${escapeHTML(item.note)}</div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="work-job-price-val font-tabular">${formatVND(item.amount)}</span>
            <button type="button" class="btn-job-icon btn-del" onclick="deleteWorkLedger(${item.id})" aria-label="Xoá khoản mục ${escapeHTML(item.note)}">Xoá</button>
          </div>
        </div>
      </div>
    `).join('');
    }

    function renderLedgerMonthDays(monthLedger, monthHuman) {
      const container = document.getElementById('ledger-month-days-list');
      const titleEl = document.getElementById('ledger-month-days-title');
      const subEl = document.getElementById('ledger-month-days-sub');
      if (titleEl) {
        titleEl.textContent = monthHuman ? `Các ngày có thu chi (${monthHuman})` : 'Các ngày có thu chi trong tháng';
      }

      const byDate = {};
      (monthLedger || []).forEach(item => {
        if (!item || !item.date) return;
        if (!byDate[item.date]) {
          byDate[item.date] = { date: item.date, count: 0, expense: 0, fund_in: 0, borrow: 0, repay: 0 };
        }
        const amt = Number(item.amount) || 0;
        byDate[item.date].count++;
        if (item.category === 'expense') byDate[item.date].expense += amt;
        if (item.category === 'fund_in') byDate[item.date].fund_in += amt;
        if (item.category === 'borrow') byDate[item.date].borrow += amt;
        if (item.category === 'repay') byDate[item.date].repay += amt;
      });

      const days = Object.values(byDate).sort((a, b) => (a.date < b.date ? 1 : -1));
      if (subEl) subEl.textContent = `${days.length} ngày`;
      if (!container) return;

      if (days.length === 0) {
        container.innerHTML = `<div class="empty-state-box">Chưa có khoản thu chi nào trong ${escapeHTML(monthHuman || 'tháng này')}.</div>`;
        return;
      }

      container.innerHTML = days.map(d => {
        const isSelected = d.date === workState.date;
        const details = [`${d.count} khoản`];
        if (d.expense > 0) details.push(`Chi ${formatShortK(d.expense)}`);
        if (d.fund_in > 0) details.push(`Quỹ ${formatShortK(d.fund_in)}`);
        if (d.borrow > 0) details.push(`Mượn ${formatShortK(d.borrow)}`);
        if (d.repay > 0) details.push(`Trả ${formatShortK(d.repay)}`);

        return `
        <button type="button" class="work-day-brief-row font-tabular" style="${isSelected ? 'border-color: #6CA844; background-color: #F2F9EE;' : ''}" onclick="loadWorkData('${d.date}')">
          <div>
            <strong style="font-size: 13.5px; color: var(--text-main);">Ngày ${formatDayMonth(d.date)}</strong>
            <div style="font-size: 11.5px; color: var(--text-sub); margin-top: 2px;">${details.join(' &bull; ')}</div>
          </div>
          <div style="text-align: right;">
            <span style="font-size: 14.5px; font-weight: 800; color: #1E3B13;">${formatShortK(d.expense)}</span>
            <div style="font-size: 10.5px; font-weight: 700; color: var(--text-muted); margin-top: 1px;">${d.fund_in > 0 ? 'Quỹ ' + formatShortK(d.fund_in) : d.count + ' mục'}</div>
          </div>
        </button>`;
      }).join('');
    }

    window.deleteWorkLedger = async function (id) {
      if (!confirm('Xoá khoản mục thu chi này?')) return;
      try {
        await api('/api/work/ledger/' + id, { method: 'DELETE' });
        removeLedgerFromLocalVault(id);
        showToast('Đã xoá khoản mục');
        await loadWorkData(workState.date);
      } catch (e) { }
    };

    window.exportWorkExcel = function () {
      const month = workState.month || (workState.date || state.today).slice(0, 7);
      window.location.href = `/api/work/export?month=${encodeURIComponent(month)}`;
    };

    // Khởi động ứng dụng
    init();
  }) ();
