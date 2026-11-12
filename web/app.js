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
    currentWeight: 97.0,
    todayWeight: null,
    mealPlan: [],
    weights: [],
    glucose: [],
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
    renderCalendarDays();
    try {
      const me = await api('/api/me');
      if (me.ok) {
        if (me.user) {
          state.currentUser = me.user;
          localStorage.setItem('qh_user', me.user);
        }
        showAppView();
        initMotivationSection();
        await loadToday();
      }
    } catch (e) {
      showLoginView();
    }
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js').then((reg) => {
      reg.update().catch(() => {});

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
          reg.update().catch(() => {});
        }
      });

      setInterval(() => {
        reg.update().catch(() => {});
      }, 30000);
    }).catch(() => {});

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
    } catch (e) {}
    localStorage.removeItem('qh_user');
    state.currentUser = 'quyen';
    showLoginView();
  };

  // Quản lý Tab: hôm nay, thực đơn, chỉ số, cài đặt
  window.switchTab = function (tabId) {
    if (tabId === 'records') tabId = 'meals';
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

    if (tabId === 'overview') loadWeightData();
    if (tabId === 'meals') loadMeals();
    if (tabId === 'work') loadWorkData();
    if (tabId === 'settings') {
      loadSettingsData();
      loadGlucoseData();
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
    const scrollContainer = document.querySelector('.app-content-area');
    if (scrollContainer) {
      scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  function setupRouting() {
    const hash = window.location.hash.replace('#', '');
    if (['today', 'work', 'meals', 'overview', 'settings'].includes(hash)) {
      switchTab(hash);
    }
  }

  // Format ngày tiếng Việt
  function formatVNDate(dStr) {
    if (!dStr) return '';
    const parts = dStr.split('-');
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  function getDayOfWeekVN(dStr) {
    const days = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
    const d = new Date(dStr + 'T00:00:00');
    return days[d.getDay()];
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
      state.medTaken = data.med && data.med.taken;

      if (data.weight) {
        state.todayWeight = data.weight.today;
        if (data.weight.last) {
          state.currentWeight = data.weight.last.kg;
        } else if (state.settings.start_weight) {
          state.currentWeight = parseFloat(state.settings.start_weight);
        }
      }

      state.todayMeals = data.meals || [];

      renderTodayHeader();
      renderWaterWidget();
      renderMedWidget();
      renderWeightStepper();
      renderDailyHealthScore();
      initMotivationSection();
      renderTodayNextMeal(data.meals || []);
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
      if (isDev) {
        avatarBox.innerHTML = `
          <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#2B5719" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
          </svg>`;
      } else {
        avatarBox.innerHTML = `
          <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#2B5719" stroke-width="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
          </svg>`;
      }
    }

    if (topAvatar) {
      if (isDev) {
        topAvatar.innerHTML = `
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#2B5719" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
          </svg>`;
      } else {
        topAvatar.innerHTML = `
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#2B5719" stroke-width="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
          </svg>`;
      }
    }
  }

  function renderTodayHeader() {
    const badge = document.getElementById('today-date-badge');
    if (badge) {
      badge.textContent = `${getDayOfWeekVN(state.today)}, ${formatVNDate(state.today)}`;
    }
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

    // 2. Thuốc men (bổ gan): 30 điểm
    const medPts = state.medTaken ? 30 : 0;
    score += medPts;

    // 3. Đo cân sáng: 15 điểm
    const hasWeight = state.todayWeight !== null && state.todayWeight !== undefined;
    const weightPts = hasWeight ? 15 : 0;
    score += weightPts;

    // 4. Bữa ăn theo thực đơn: tối đa 15 điểm (5 điểm mỗi bữa chính: sáng, trưa, tối)
    const meals = state.todayMeals || [];
    const mainMeals = meals.filter(m => m.slot !== 'snack');
    let mealPts = 0;
    let doneMealsCount = 0;
    if (mainMeals.length > 0) {
      doneMealsCount = mainMeals.filter(m => m.status === 'done' || m.status === 'swapped').length;
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
    const weightSummary = document.getElementById('summary-weight-display');
    if (weightSummary) {
      const curW = state.todayWeight !== null && state.todayWeight !== undefined ? state.todayWeight : state.currentWeight;
      weightSummary.textContent = curW ? curW.toFixed(1) : '--';
    }
    const medSummary = document.getElementById('summary-med-display');
    if (medSummary) {
      medSummary.textContent = state.medTaken ? 'Đã uống' : 'Chưa uống';
      medSummary.style.color = state.medTaken ? '#2B5719' : '#C2410C';
    }
  }

  // Mở modal giải thích chi tiết điểm tuân thủ hôm nay
  window.openScoreBreakdownModal = function () {
    const minWater = parseInt((state.settings && state.settings.water_min) || 2500);
    const curWater = state.waterTotal || 0;
    const waterRatio = Math.min(1, curWater / minWater);
    const waterPts = Math.round(waterRatio * 40);

    const medPts = state.medTaken ? 30 : 0;

    const hasWeight = state.todayWeight !== null && state.todayWeight !== undefined;
    const weightPts = hasWeight ? 15 : 0;

    const meals = state.todayMeals || [];
    const mainMeals = meals.filter(m => m.slot !== 'snack');
    const doneMeals = mainMeals.filter(m => m.status === 'done' || m.status === 'swapped').length;
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
              ${state.medTaken ? '<span style="color: #2B5719; font-weight: 600;">Đã uống thuốc hôm nay</span>' : '<span style="color: #C2410C;">Chưa uống thuốc (bấm vào ô Thuốc bổ gan để ghi nhận)</span>'}
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
              ${hasWeight ? `<span style="color: #2B5719; font-weight: 600;">Đã ghi nhận: ${state.todayWeight.toFixed(1)} kg</span>` : '<span style="color: #C2410C;">Chưa cân sáng nay (bấm Lưu cân nặng bên dưới)</span>'}
            </div>
          </div>

          <div style="background: #F9FBF8; border: 1px solid var(--border-subtle); border-radius: 14px; padding: 12px 14px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="font-weight: 700; font-size: 13.5px; color: var(--text-main); display: inline-flex; align-items: center; gap: 6px;">
                <svg class="ui-inline-svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#2B5719" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                <span>Thực đơn 3 bữa chính</span>
              </span>
              <span style="font-weight: 800; color: ${mealPts ? 'var(--color-score-ring)' : 'var(--text-muted)'};" class="font-tabular">${mealPts}/15 đ</span>
            </div>
            <div style="font-size: 12.5px; color: var(--text-sub);">
              Đã ghi nhận <strong class="font-tabular">${doneMeals}/3</strong> bữa chính (5 điểm mỗi bữa)
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
        const timeStr = new Date(last.ts * 1000).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        entriesCount.textContent = `Lần gần nhất: +${last.ml}ml lúc ${timeStr}`;
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

  window.openCustomWaterModal = function () {
    const inp = document.getElementById('custom-water-ml');
    if (inp) inp.value = '';
    openModal('modal-water');
  };

  window.submitCustomWater = async function (e) {
    e.preventDefault();
    const ml = parseInt(document.getElementById('custom-water-ml').value);
    if (!ml || ml < 1 || ml > 2000) {
      showToast('Số ml phải từ 1 đến 2.000 ml', true);
      return;
    }
    closeModal('modal-water');
    await addWater(ml);
  };

  // --- CHECKLIST THUỐC ---
  function renderMedWidget() {
    const btn = document.getElementById('btn-today-med');
    if (btn) {
      if (state.medTaken) {
        btn.className = 'btn-med-chip taken';
        btn.innerHTML = '<span>Đã uống thuốc hôm nay</span>';
      } else {
        btn.className = 'btn-med-chip';
        btn.innerHTML = '<span>Chưa uống thuốc</span>';
      }
    }
    renderDailyHealthScore();
  }

  window.toggleMed = async function () {
    const next = !state.medTaken;
    state.medTaken = next;
    renderMedWidget();
    try {
      await api('/api/med', {
        method: 'PUT',
        body: JSON.stringify({ date: state.today, taken: next })
      });
      showToast(next ? 'Đã ghi nhận uống thuốc hôm nay' : 'Đã bỏ ghi nhận thuốc');
    } catch (e) {
      state.medTaken = !next;
      renderMedWidget();
    }
  };

  // --- CÂN NẶNG HÔM NAY & STEPPER ---
  function renderWeightStepper() {
    let dispKg = state.todayWeight !== null ? state.todayWeight : state.currentWeight;
    const valEl = document.getElementById('weight-val');
    if (valEl) valEl.textContent = dispKg.toFixed(1);

    const btnSave = document.getElementById('btn-save-weight');
    const sub = document.getElementById('weight-status-sub');
    if (btnSave) {
      if (state.todayWeight !== null) {
        btnSave.textContent = 'Đã lưu (' + state.todayWeight.toFixed(1) + 'kg) - Bấm sửa';
        btnSave.className = 'btn-secondary-pill btn-save-weight';
      } else {
        btnSave.textContent = 'Lưu cân nặng';
        btnSave.className = 'btn-green-pill btn-save-weight';
      }
    }
    if (sub) {
      if (state.todayWeight !== null) {
        sub.textContent = 'Hôm nay Quyền đã ghi nhận cân nặng!';
      } else {
        sub.textContent = 'Cân vào sáng sớm sau khi vệ sinh cá nhân, trước khi ăn sáng.';
      }
    }
    renderDailyHealthScore();
  }

  window.adjustWeight = function (delta) {
    const valEl = document.getElementById('weight-val');
    if (!valEl) return;
    let cur = parseFloat(valEl.textContent);
    cur = Math.round((cur + delta) * 10) / 10;
    if (cur < 40) cur = 40;
    if (cur > 200) cur = 200;
    valEl.textContent = cur.toFixed(1);
  };

  window.saveWeight = async function () {
    const valEl = document.getElementById('weight-val');
    if (!valEl) return;
    const kg = parseFloat(valEl.textContent);
    try {
      await api('/api/weight', {
        method: 'POST',
        body: JSON.stringify({ kg, date: state.today })
      });
      state.todayWeight = kg;
      state.currentWeight = kg;
      renderWeightStepper();
      showToast(`Đã lưu cân nặng hôm nay: ${kg.toFixed(1)} kg`);
    } catch (e) { }
  };

  // --- BỮA TIẾP THEO TRONG NGÀY ---
  function renderTodayNextMeal(mealsList) {
    const container = document.getElementById('today-next-meal-content');
    if (!container) return;
    if (!mealsList || mealsList.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 8px 0; font-size: 13px;">
          Chưa có lịch bữa ăn cho hôm nay.
          <div style="margin-top: 8px;">
            <button class="btn-green-pill btn-sm" onclick="switchTab('records')">Đến mục Thực đơn để tạo</button>
          </div>
        </div>`;
      return;
    }

    let nextMeal = mealsList.find(m => m.status === 'pending');
    if (!nextMeal) {
      nextMeal = mealsList[mealsList.length - 1];
    }

    const slotNames = { breakfast: 'Bữa Sáng', lunch: 'Bữa Trưa', dinner: 'Bữa Tối', snack: 'Bữa Phụ' };
    let itemsHtml = nextMeal.items.map(it => `
      <li style="display: flex; justify-content: space-between; padding: 2px 0;">
        <span>${it.red ? '<span style="color:#ef4444; font-weight:700;">[Chú ý] </span>' : ''}${it.name}</span>
        <span style="font-weight:600;">${it.qty || ''}</span>
      </li>`).join('');

    container.innerHTML = `
      <div style="background: #F9FBF8; border-radius: 16px; padding: 12px 14px; border: 1px solid var(--border-subtle);">
        <div style="display: flex; justify-content: space-between; font-size: 13.5px; font-weight: 700; margin-bottom: 6px;">
          <span>${slotNames[nextMeal.slot] || nextMeal.slot}</span>
          <span style="color: var(--color-score-ring);">${nextMeal.kcal} kcal</span>
        </div>
        <ul style="list-style: none; font-size: 12.5px; color: var(--text-sub); margin-bottom: 10px;">${itemsHtml}</ul>
        <div style="display: flex; gap: 8px;">
          <button class="btn-slot-act ${nextMeal.status === 'done' ? 'active-done' : ''}" onclick="checkMeal('${nextMeal.date}', '${nextMeal.slot}', 'done')">
            Ăn đúng món
          </button>
          <button class="btn-slot-act ${nextMeal.status === 'swapped' ? 'active-diff' : ''}" onclick="openMealNoteModal('${nextMeal.date}', '${nextMeal.slot}', '${nextMeal.note || ''}')">
            Ăn món khác
          </button>
          ${nextMeal.status !== 'pending' ? `<button class="btn-slot-act" onclick="checkMeal('${nextMeal.date}', '${nextMeal.slot}', 'pending')">Đặt lại</button>` : ''}
        </div>
      </div>`;
  }

  // --- CALENDAR DAY STRIP CHO MÀN HÌNH TỔNG QUAN ---
  function renderCalendarDays() {
    const container = document.getElementById('calendar-days-container');
    if (!container) return;

    const todayDate = new Date();
    const daysArr = [];
    const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

    // Lấy 5 ngày quanh hôm nay (-2 đến +2)
    for (let offset = -2; offset <= 2; offset++) {
      const d = new Date(todayDate);
      d.setDate(todayDate.getDate() + offset);
      daysArr.push({
        name: dayNames[d.getDay()],
        num: d.getDate(),
        isToday: offset === 0
      });
    }

    container.innerHTML = daysArr.map(item => `
      <div class="day-capsule ${item.isToday ? 'active' : ''}" onclick="selectCalendarDay(this, ${item.num})">
        <span class="day-name">${item.name}</span>
        <span class="day-num">${item.num}</span>
      </div>
    `).join('');

    const monthEl = document.getElementById('current-month-display');
    if (monthEl) {
      const monthNames = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];
      monthEl.textContent = `${monthNames[todayDate.getMonth()]}, ${todayDate.getFullYear()}`;
    }
  }

  window.selectCalendarDay = function (el, dayNum) {
    document.querySelectorAll('.day-capsule').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    showToast(`Đã chọn ngày ${dayNum}`);
  };

  window.openCalendarPicker = function () {
    showToast('Chọn ngày để xem dữ liệu');
  };

  window.openNotificationsModal = function () {
    showToast('Tất cả chỉ số sức khoẻ hôm nay đang được theo dõi ổn định!');
  };

  // ================= 2. BỮA ĂN (7 NGÀY) =================
  async function loadMeals() {
    const container = document.getElementById('meals-list-container');
    if (!container) return;
    container.innerHTML = '<div style="text-align: center; padding: 24px 0; color: var(--text-muted); font-size: 13px;">Đang tải thực đơn 7 ngày...</div>';
    try {
      const data = await api('/api/meals?days=7');
      state.mealPlan = data.rows || [];
      renderMealPlanList();
    } catch (e) {
      container.innerHTML = '<div style="text-align: center; color: #ef4444; padding: 20px;">Lỗi tải thực đơn.</div>';
    }
  }

  window.generateMealPlan = async function () {
    if (state.mealPlan.length > 0) {
      if (!confirm('Tạo lại lịch sẽ làm mới các bữa ăn chưa ăn trong 7 ngày tới. Tiếp tục?')) {
        return;
      }
    }
    showToast('Đang tạo thực đơn 7 ngày phù hợp với sức khoẻ...');
    try {
      const data = await api('/api/meals/generate', { method: 'POST' });
      state.mealPlan = data.rows || [];
      renderMealPlanList();
      showToast('Đã tạo lịch bữa ăn 7 ngày');
    } catch (e) { }
  };

  function renderMealPlanList() {
    const container = document.getElementById('meals-list-container');
    if (!container) return;
    if (!state.mealPlan || state.mealPlan.length === 0) {
      container.innerHTML = `
        <div class="empty-state-box" style="text-align: center; padding: 24px 16px;">
          <h4 style="margin-bottom: 6px;">Chưa có lịch ăn 7 ngày</h4>
          <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 14px;">
            Hệ thống sẽ tự động cân đối ~1.800 kcal/ngày, ít dầu mỡ bảo vệ tế bào gan.
          </p>
          <button class="btn-green-pill btn-sm" onclick="generateMealPlan()">Tự tạo lịch bữa ăn ngay</button>
        </div>`;
      return;
    }

    const daysMap = {};
    state.mealPlan.forEach(m => {
      if (!daysMap[m.date]) daysMap[m.date] = [];
      daysMap[m.date].push(m);
    });

    const slotNames = { breakfast: 'Sáng', lunch: 'Trưa', dinner: 'Tối', snack: 'Phụ' };
    let html = '';

    Object.keys(daysMap).sort().forEach(date => {
      const isToday = date === state.today;
      const dayMeals = daysMap[date];
      const totalKcal = dayMeals.reduce((s, m) => s + m.kcal, 0);

      html += `
        <div class="meal-day-card">
          <div class="meal-day-header">
            <div style="display: flex; align-items: center; gap: 8px;">
              <strong style="font-size: 14px;">${getDayOfWeekVN(date)} (${formatVNDate(date)})</strong>
              ${isToday ? '<span class="badge-status-pill badge-normal" style="font-size:10px;">Hôm nay</span>' : ''}
            </div>
            <span style="font-size: 12px; color: var(--color-score-ring); font-weight: 700;">${totalKcal} kcal</span>
          </div>`;

      dayMeals.forEach(slotMeal => {
        let itemsHtml = slotMeal.items.map(it => `
          <li style="display:flex; justify-content:space-between; padding:2px 0;">
            <span>${it.red ? '<span style="color:#ef4444; font-weight:700;">[Chú ý] </span>' : ''}${it.name}</span>
            <span style="font-weight:600;">${it.qty || ''}</span>
          </li>`).join('');

        html += `
          <div class="meal-slot">
            <div class="meal-slot-header">
              <span>${slotNames[slotMeal.slot] || slotMeal.slot}</span>
              <div style="display: flex; gap: 8px; align-items: center;">
                <span style="font-size: 12px; color: var(--text-muted);">${slotMeal.kcal} kcal</span>
                ${slotMeal.status === 'pending' ? `<button type="button" class="btn-link-action" style="font-size: 11px;" onclick="swapMeal('${date}', '${slotMeal.slot}')">Đổi món</button>` : ''}
              </div>
            </div>
            <ul class="meal-items-list">${itemsHtml}</ul>
            <div class="meal-slot-actions">
              <button class="btn-slot-act ${slotMeal.status === 'done' ? 'active-done' : ''}" onclick="checkMeal('${date}', '${slotMeal.slot}', 'done')">
                Ăn đúng
              </button>
              <button class="btn-slot-act ${slotMeal.status === 'swapped' ? 'active-diff' : ''}" onclick="openMealNoteModal('${date}', '${slotMeal.slot}', '${slotMeal.note || ''}')">
                Ăn khác
              </button>
              ${slotMeal.status !== 'pending' ? `<button class="btn-slot-act" onclick="checkMeal('${date}', '${slotMeal.slot}', 'pending')">Đặt lại</button>` : ''}
            </div>
          </div>`;
      });

      html += '</div>';
    });

    container.innerHTML = html;
  }

  window.swapMeal = async function (date, slot) {
    try {
      showToast('Đang chọn món thay thế phù hợp...');
      const updated = await api('/api/meals/swap', {
        method: 'POST',
        body: JSON.stringify({ date, slot })
      });
      const idx = state.mealPlan.findIndex(m => m.date === date && m.slot === slot);
      if (idx !== -1) {
        state.mealPlan[idx] = updated;
      }
      renderMealPlanList();
      showToast('Đã đổi món');
    } catch (e) { }
  };

  window.checkMeal = async function (date, slot, status) {
    try {
      const res = await api('/api/meals/check', {
        method: 'POST',
        body: JSON.stringify({ date, slot, status, note: '' })
      });
      const meal = state.mealPlan.find(m => m.date === date && m.slot === slot);
      if (meal) {
        meal.status = res.status;
        meal.note = res.note;
      }
      const tMeal = (state.todayMeals || []).find(m => m.slot === slot);
      if (tMeal && date === state.today) {
        tMeal.status = res.status;
        tMeal.note = res.note;
        renderDailyHealthScore();
      }
      renderMealPlanList();
      if (date === state.today) loadToday();
      showToast(status === 'done' ? 'Đã ghi nhận ăn đúng thực đơn' : 'Đã cập nhật trạng thái');
    } catch (e) { }
  };

  window.openMealNoteModal = function (date, slot, currentNote) {
    document.getElementById('note-meal-date').value = date;
    document.getElementById('note-meal-slot').value = slot;
    document.getElementById('note-meal-text').value = currentNote || '';
    openModal('modal-meal-note');
  };

  window.appendNoteTag = function (tag) {
    const input = document.getElementById('note-meal-text');
    if (input.value) {
      input.value += ', ' + tag;
    } else {
      input.value = tag;
    }
  };

  window.submitMealNote = async function (e) {
    e.preventDefault();
    const date = document.getElementById('note-meal-date').value;
    const slot = document.getElementById('note-meal-slot').value;
    const note = document.getElementById('note-meal-text').value.trim();
    if (!note) return;

    try {
      const res = await api('/api/meals/check', {
        method: 'POST',
        body: JSON.stringify({ date, slot, status: 'swapped', note })
      });
      closeModal('modal-meal-note');
      const meal = state.mealPlan.find(m => m.date === date && m.slot === slot);
      if (meal) {
        meal.status = 'swapped';
        meal.note = note;
      }
      const tMeal = (state.todayMeals || []).find(m => m.slot === slot);
      if (tMeal && date === state.today) {
        tMeal.status = 'swapped';
        tMeal.note = note;
        renderDailyHealthScore();
      }
      renderMealPlanList();
      if (date === state.today) loadToday();
      showToast('Đã ghi nhận món ăn thực tế');
    } catch (e) { }
  };

  // --- DANH SÁCH ĐI CHỢ ---
  window.openShoppingModal = async function () {
    openModal('modal-shopping');
    const container = document.getElementById('shopping-list-items');
    container.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-muted);">Đang gộp nguyên liệu...</div>';
    try {
      const data = await api('/api/shopping?days=7');
      if (!data.lines || data.lines.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-muted);">Chưa có món nào cần đi chợ (hãy tạo lịch trước).</div>';
        return;
      }

      const groups = {};
      data.lines.forEach(l => {
        if (!groups[l.group]) groups[l.group] = [];
        groups[l.group].push(l);
      });

      const boughtItems = JSON.parse(localStorage.getItem('quyen_bought_items') || '{}');
      let html = '';

      Object.keys(groups).sort().forEach(grp => {
        html += `<div style="font-weight: 700; font-size: 13px; text-transform: uppercase; margin: 14px 0 6px; color: var(--text-main);">${grp}</div>`;
        groups[grp].forEach(item => {
          const key = item.name + '_' + item.text;
          const checked = boughtItems[key] ? 'checked' : '';
          html += `
            <label style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: #F8FAF7; border: 1px solid var(--border-subtle); margin-bottom: 6px; border-radius: 12px; cursor: pointer;">
              <span style="display: flex; align-items: center; gap: 8px;">
                <input type="checkbox" ${checked} onchange="toggleBoughtItem('${key}', this.checked)" style="width: 17px; height: 17px; accent-color: var(--color-score-ring);">
                <span style="font-size: 13px; ${checked ? 'text-decoration: line-through; opacity: 0.5;' : ''}">${item.name}</span>
              </span>
              <span style="font-size: 12px; font-weight: 600; color: var(--text-muted); font-variant-numeric: tabular-nums;">${item.text}</span>
            </label>`;
        });
      });

      container.innerHTML = html;
    } catch (e) {
      container.innerHTML = '<div style="color: #ef4444; padding: 20px;">Lỗi tải danh sách đi chợ.</div>';
    }
  };

  window.toggleBoughtItem = function (key, checked) {
    const bought = JSON.parse(localStorage.getItem('quyen_bought_items') || '{}');
    if (checked) {
      bought[key] = true;
    } else {
      delete bought[key];
    }
    localStorage.setItem('quyen_bought_items', JSON.stringify(bought));
  };

  // ================= 3. CÂN NẶNG & TIẾN ĐỘ =================
  async function loadWeightData() {
    try {
      const data = await api('/api/weight?days=90');
      state.weights = data.rows || [];
      renderWeightChart();
      renderWeightHistory();

      // Cập nhật các thẻ chỉ số thực tế trên màn hình Tổng quan
      const cur = state.weights.length > 0 ? state.weights[state.weights.length - 1].kg : state.currentWeight;
      const rem = Math.max(0, cur - 70.0);
      const wVal = document.getElementById('overview-weight-val');
      if (wVal) wVal.textContent = cur.toFixed(1);
      const wBadge = document.getElementById('overview-weight-badge');
      if (wBadge) wBadge.textContent = `Còn ${rem.toFixed(1)} kg`;

      const kcalVal = document.getElementById('overview-kcal-val');
      if (kcalVal) kcalVal.textContent = (state.targetKcal || 1800).toLocaleString('vi-VN');

      const waterVal = document.getElementById('overview-water-val');
      if (waterVal) {
        const minW = parseInt(state.settings.water_min || 2500);
        waterVal.textContent = state.waterTotal.toLocaleString('vi-VN');
        const waterPct = document.getElementById('overview-water-pct');
        if (waterPct) {
          const pct = Math.min(100, Math.round((state.waterTotal / minW) * 100));
          waterPct.textContent = `${pct}%`;
        }
      }

      // Nạp thêm dữ liệu đường huyết nếu có
      if (state.glucose && state.glucose.length > 0) {
        const g = state.glucose[0];
        const gVal = document.getElementById('overview-glucose-val');
        if (gVal) gVal.textContent = g.mmol.toFixed(1);
        const gBadge = document.getElementById('overview-glucose-badge');
        const ctxLabels = { fasting: 'Sáng đói', after: 'Sau ăn', bedtime: 'Trước ngủ', other: 'Khác' };
        if (gBadge) gBadge.textContent = ctxLabels[g.ctx] || 'Đã ghi';
      }
    } catch (e) { }
  }

  function renderWeightChart() {
    const curEl = document.getElementById('weight-chart-current');
    const remEl = document.getElementById('weight-chart-rem');
    const svg = document.getElementById('weight-svg');
    if (!svg) return;

    let cur = state.currentWeight;
    if (state.weights.length > 0) {
      cur = state.weights[state.weights.length - 1].kg;
    }
    if (curEl) curEl.textContent = cur.toFixed(1) + ' kg';
    const rem = Math.max(0, cur - 70.0);
    if (remEl) remEl.textContent = rem.toFixed(1) + ' kg';

    const wList = state.weights;
    if (wList.length === 0) {
      svg.innerHTML = '<text x="250" y="100" fill="#8A9185" text-anchor="middle" font-size="13">Chưa có đủ dữ liệu đo cân nặng</text>';
      return;
    }

    const minKg = 65;
    const maxKg = 100;
    const padX = 36;
    const padY = 20;
    const w = 500 - padX * 2;
    const h = 200 - padY * 2;

    const getY = (kg) => padY + h - ((kg - minKg) / (maxKg - minKg)) * h;

    const y70 = getY(70);
    let svgContent = `
      <defs>
        <linearGradient id="chartGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#A4DB7A" />
          <stop offset="100%" stop-color="#5E9447" />
        </linearGradient>
      </defs>
      <line x1="${padX}" y1="${getY(80)}" x2="${500 - padX}" y2="${getY(80)}" stroke="#EAEFE9" stroke-dasharray="2,2" stroke-width="1"/>
      <line x1="${padX}" y1="${getY(90)}" x2="${500 - padX}" y2="${getY(90)}" stroke="#EAEFE9" stroke-dasharray="2,2" stroke-width="1"/>
      <line x1="${padX}" y1="${y70}" x2="${500 - padX}" y2="${y70}" stroke="#5E9447" stroke-dasharray="4,4" stroke-width="1.5"/>
      <text x="${500 - padX + 4}" y="${y70 + 4}" fill="#5E9447" font-size="11" font-weight="700">70kg</text>
    `;

    let pts = [];
    const stepX = w / Math.max(1, wList.length - 1);
    wList.forEach((pt, i) => {
      const x = padX + i * stepX;
      const y = getY(pt.kg);
      pts.push(`${x},${y}`);
    });

    svgContent += `
      <polyline fill="none" stroke="url(#chartGrad)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${pts.join(' ')}" />
    `;

    wList.forEach((pt, i) => {
      const x = padX + i * stepX;
      const y = getY(pt.kg);
      svgContent += `
        <circle cx="${x}" cy="${y}" r="4" fill="#5E9447" stroke="#ffffff" stroke-width="2" />
        <text x="${x}" y="${y - 8}" fill="#1C1F1B" font-size="10" font-weight="700" text-anchor="middle">${pt.kg}</text>
      `;
    });

    svg.innerHTML = svgContent;
  }

  function renderWeightHistory() {
    const container = document.getElementById('weight-history-list');
    if (!container) return;
    if (state.weights.length === 0) {
      container.innerHTML = '<div style="color: var(--text-muted); padding: 8px 0; font-size: 13px;">Chưa có ngày đo nào.</div>';
      return;
    }
    let html = '<table>';
    html += '<thead><tr><th>Ngày</th><th>Cân nặng</th><th style="text-align: right;">Thay đổi</th></tr></thead><tbody>';

    for (let i = state.weights.length - 1; i >= 0; i--) {
      const item = state.weights[i];
      let diffStr = '-';
      if (i > 0) {
        const prev = state.weights[i - 1];
        const diff = item.kg - prev.kg;
        if (diff > 0) diffStr = `<span style="color: var(--pink-text); font-weight: 700;">+${diff.toFixed(1)}kg</span>`;
        else if (diff < 0) diffStr = `<span style="color: var(--color-score-ring); font-weight: 700;">${diff.toFixed(1)}kg</span>`;
        else diffStr = '<span style="color: var(--text-muted);">0.0kg</span>';
      }
      html += `
        <tr>
          <td style="color: var(--text-sub);">${formatVNDate(item.date)}</td>
          <td style="font-weight: 700; color: var(--text-main); font-variant-numeric: tabular-nums;">${item.kg.toFixed(1)} kg</td>
          <td style="text-align: right; font-variant-numeric: tabular-nums;">${diffStr}</td>
        </tr>`;
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  // ================= 4. CÀI ĐẶT & NHẮC NHỞ =================
  let reminderState = {
    weight: ['06:30'],
    med: ['08:00', '12:00'],
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
      if (document.getElementById('set-snack')) document.getElementById('set-snack').value = s.snack || '1';

      if (s.remind_weight_times !== undefined) {
        reminderState.weight = s.remind_weight_times ? s.remind_weight_times.split(',').map(t => t.trim()).filter(Boolean) : [];
      } else if (s.t_weight) {
        reminderState.weight = [s.t_weight];
      }

      if (s.remind_med_times !== undefined) {
        reminderState.med = s.remind_med_times ? s.remind_med_times.split(',').map(t => t.trim()).filter(Boolean) : [];
      } else {
        reminderState.med = [s.t_med || '08:00', s.t_med2 || '12:00'].filter(Boolean);
      }

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
  };

  window.removeReminderTime = function (cat, idx) {
    if (!reminderState[cat]) return;
    reminderState[cat].splice(idx, 1);
    renderReminderChips(cat);
  };

  window.updateReminderTime = function (cat, idx, val) {
    if (!reminderState[cat] || !val) return;
    reminderState[cat][idx] = val;
    reminderState[cat].sort();
    renderReminderChips(cat);
  };

  window.saveReminderSchedule = async function () {
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
      showToast('Đã lưu lịch nhắc nhở thành công!');
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
      snack: document.getElementById('set-snack')?.value || '1',
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
      renderTodayHeader();
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

  // --- ĐƯỜNG HUYẾT ---
  async function loadGlucoseData() {
    try {
      const data = await api('/api/glucose?days=30');
      state.glucose = data.rows || [];
      renderGlucoseHistory();
    } catch (e) { }
  }

  function renderGlucoseHistory() {
    const container = document.getElementById('glucose-history-list');
    if (!container) return;
    if (state.glucose.length === 0) {
      container.innerHTML = '<div style="color: var(--text-muted); padding: 6px 0; font-size: 13px;">Chưa ghi số đo nào gần đây.</div>';
      return;
    }
    const ctxLabels = { fasting: 'Sáng đói', after: 'Sau ăn', bedtime: 'Trước ngủ', other: 'Khác' };
    let html = '';
    state.glucose.slice(0, 4).forEach(g => {
      let badgeClass = 'badge-normal';
      let tag = 'Bình thường';
      if (g.mmol >= 7.0) {
        badgeClass = 'badge-low';
        tag = 'Cao';
      } else if (g.mmol >= 5.6) {
        badgeClass = 'badge-good';
        tag = 'Cận ngưỡng';
      }
      const timeStr = new Date(g.ts * 1000).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
      html += `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border-subtle);">
          <div>
            <strong style="font-size: 14px; font-variant-numeric: tabular-nums;">${g.mmol.toFixed(1)} mmol/L</strong>
            <span style="font-size: 11.5px; color: var(--text-muted); margin-left: 6px;">(${ctxLabels[g.ctx] || g.ctx})</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 11.5px; color: var(--text-muted);">${timeStr}</span>
            <span class="badge-status-pill ${badgeClass}">${tag}</span>
          </div>
        </div>`;
    });
    container.innerHTML = html;
  }

  window.openGlucoseModal = function () {
    const inp = document.getElementById('glucose-mmol');
    if (inp) inp.value = '';
    openModal('modal-glucose');
  };

  window.submitGlucose = async function (e) {
    e.preventDefault();
    const mmol = parseFloat(document.getElementById('glucose-mmol').value);
    const ctx = document.getElementById('glucose-ctx').value;
    if (!mmol || mmol < 1 || mmol > 40) return;
    try {
      await api('/api/glucose', {
        method: 'POST',
        body: JSON.stringify({ mmol, ctx, ts: Math.floor(Date.now() / 1000) })
      });
      closeModal('modal-glucose');
      await loadGlucoseData();
      showToast('Đã lưu chỉ số đường huyết');
    } catch (e) { }
  };

  // --- BÁO CÁO TUẦN ---
  window.viewWeeklyReport = async function () {
    openModal('modal-report');
    const container = document.getElementById('report-content');
    container.innerHTML = 'Đang tính toán số liệu 7 ngày qua...';
    try {
      const data = await api('/api/report?days=7');
      const days = data.days || [];
      const weights = data.weights || [];

      let totalWater = 0;
      let medCount = 0;
      let totalDoneMeals = 0;
      let totalPlannedMeals = 0;

      days.forEach(d => {
        totalWater += d.water;
        if (d.med) medCount++;
        totalDoneMeals += d.meals_done;
        totalPlannedMeals += d.meals_total;
      });

      const avgWater = Math.round(totalWater / Math.max(1, days.length));
      const mealRate = totalPlannedMeals > 0 ? Math.round((totalDoneMeals / totalPlannedMeals) * 100) : 0;
      const medRate = Math.round((medCount / Math.max(1, days.length)) * 100);

      let weightChange = 'Chưa có đủ số liệu';
      if (weights.length >= 2) {
        const diff = weights[weights.length - 1].kg - weights[0].kg;
        weightChange = `${diff > 0 ? '+' : ''}${diff.toFixed(1)} kg (${weights[0].kg}kg &rarr; ${weights[weights.length - 1].kg}kg)`;
      }

      container.innerHTML = `
        <div style="background: #F7FAF6; border: 1px solid var(--border-card); padding: 16px; border-radius: 18px; margin-bottom: 16px;">
          <div style="font-size: 15px; font-weight: 700; margin-bottom: 10px;">Tóm tắt tuân thủ 7 ngày</div>
          <div style="margin-bottom: 6px;"><strong>Nước lọc TB:</strong> <span style="font-weight:700;">${avgWater.toLocaleString('vi-VN')} ml / ngày</span> (chuẩn 2.500ml)</div>
          <div style="margin-bottom: 6px;"><strong>Ăn đúng thực đơn:</strong> <span style="font-weight:700;">${mealRate}%</span> bữa chính</div>
          <div style="margin-bottom: 6px;"><strong>Uống thuốc đều:</strong> <span style="font-weight:700;">${medRate}%</span> (${medCount}/7 ngày)</div>
          <div><strong>Cân nặng thay đổi:</strong> <strong style="color: var(--color-score-ring);">${weightChange}</strong></div>
        </div>
        <div style="color: var(--text-muted); font-size: 12px; margin-bottom: 14px; line-height: 1.5;">
          * Báo cáo này để đưa Bác sĩ xem trong mỗi lần tái khám định kỳ theo dõi gan.
        </div>
        <button class="btn-green-pill" style="width: 100%;" onclick="window.print()">In hoặc Lưu PDF</button>
      `;
    } catch (e) {
      container.innerHTML = '<div style="color: #ef4444;">Lỗi tải báo cáo.</div>';
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
    subTab: 'jobs', // 'jobs' | 'unpaid' | 'ledger'
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
    if (n % 1000 === 0) {
      return (n / 1000).toLocaleString('vi-VN') + 'k';
    }
    return n.toLocaleString('vi-VN') + 'đ';
  }

  function shiftDateStr(dStr, deltaDays) {
    const parts = dStr.split('-').map(Number);
    const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    dt.setUTCDate(dt.getUTCDate() + deltaDays);
    return dt.toISOString().slice(0, 10);
  }

  async function loadWorkData(targetDate) {
    const dateParam = targetDate || workState.date || state.today || '';
    const monthParam = dateParam ? dateParam.slice(0, 7) : '';
    const qs = dateParam ? `?date=${encodeURIComponent(dateParam)}&month=${encodeURIComponent(monthParam)}` : '';
    try {
      const data = await api('/api/work' + qs);
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
    } catch (e) {}
  }

  function renderWorkScreen() {
    // 1. Date bar
    const dateInput = document.getElementById('work-date-input');
    if (dateInput) dateInput.value = workState.date;

    const humanEl = document.getElementById('work-date-human');
    if (humanEl) {
      if (workState.date === workState.today) {
        humanEl.textContent = `Hôm nay (${getDayOfWeekVN(workState.date)})`;
      } else if (workState.date === shiftDateStr(workState.today, -1)) {
        humanEl.textContent = `Hôm qua (${getDayOfWeekVN(workState.date)})`;
      } else {
        humanEl.textContent = `${getDayOfWeekVN(workState.date)} - ${formatVNDate(workState.date)}`;
      }
    }

    const todayBtn = document.getElementById('btn-work-today');
    if (todayBtn) {
      todayBtn.style.opacity = workState.date === workState.today ? '0.55' : '1';
    }

    // 2. Summary Hero Card
    const ds = workState.daySummary || {};
    const ms = workState.monthSummary || {};
    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setTxt('work-summary-date-label', workState.date === workState.today ? 'Tổng kết hôm nay' : `Tổng kết ngày ${formatVNDate(workState.date)}`);
    setTxt('work-day-revenue', formatVND(ds.total_revenue || 0));
    setTxt('work-day-job-count', `${ds.total_jobs || 0} đơn`);
    setTxt('work-day-net', formatVND(ds.net_cash || 0));
    setTxt('work-day-paid', formatShortK(ds.paid_amount || 0));
    setTxt('work-day-unpaid', formatShortK(ds.unpaid_amount || 0));
    setTxt('work-day-expense', formatShortK(ds.expense_amount || 0));

    // Extra badges (Nộp quỹ, Số quỹ, Mượn, Trả nợ)
    const extraEl = document.getElementById('work-day-extra-badges');
    if (extraEl) {
      const pills = [];
      if (ds.fund_in > 0) pills.push(`<span class="work-extra-pill font-tabular">${workIconSVG('fund_in', 13)} <span>Nộp quỹ: ${formatShortK(ds.fund_in)}</span></span>`);
      if (ds.fund_bal > 0) pills.push(`<span class="work-extra-pill font-tabular">${workIconSVG('fund_bal', 13)} <span>Số quỹ: ${formatShortK(ds.fund_bal)}</span></span>`);
      if (ds.borrow_amount > 0) pills.push(`<span class="work-extra-pill font-tabular">${workIconSVG('borrow', 13)} <span>Mượn: ${formatShortK(ds.borrow_amount)}</span></span>`);
      if (ds.repay_amount > 0) pills.push(`<span class="work-extra-pill font-tabular">${workIconSVG('repay', 13)} <span>Trả nợ: ${formatShortK(ds.repay_amount)}</span></span>`);
      if (pills.length > 0) {
        extraEl.style.display = 'flex';
        extraEl.innerHTML = pills.join('');
      } else {
        extraEl.style.display = 'none';
        extraEl.innerHTML = '';
      }
    }

    // Month strip
    if (workState.month) {
      const mParts = workState.month.split('-');
      setTxt('work-month-label', `Tháng ${parseInt(mParts[1], 10)}/${mParts[0]} (${ms.total_jobs || 0} đơn):`);
    }
    setTxt('work-month-revenue', formatShortK(ms.total_revenue || 0));
    setTxt('work-month-paid', formatShortK(ms.paid_amount || 0));
    setTxt('work-month-expense', formatShortK(ms.expense_amount || 0));

    // Subtab badges
    setTxt('work-badge-day-jobs', String(workState.jobs.length));
    setTxt('work-badge-unpaid-all', String(workState.totalUnpaidJobs || 0));

    renderWorkSuggestions();
    renderWorkJobsList();
    renderWorkMonthDays();
    renderWorkUnpaidGroups();
    renderWorkLedgerList();
  }

  window.stepWorkDate = function (delta) {
    const base = workState.date || state.today;
    const nextDate = shiftDateStr(base, delta);
    loadWorkData(nextDate);
  };

  window.onWorkDateChange = function (val) {
    if (val) loadWorkData(val);
  };

  window.jumpWorkToday = function () {
    loadWorkData(workState.today || state.today);
  };

  window.switchWorkSubTab = function (sub) {
    workState.subTab = sub;
    ['jobs', 'unpaid', 'ledger'].forEach(k => {
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
      } catch (e) {}
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
    try {
      await api('/api/work/job', {
        method: 'POST',
        body: JSON.stringify({
          date: workState.date || state.today,
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
      showToast(`Đã lưu đơn ${customer} (${formatShortK(price)} - ${status})`);
      await loadWorkData(workState.date);
    } catch (err) {}
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
          Chọn nhanh <strong>Khách quen + Dịch vụ + Mệnh giá</strong> ở khung trên để lưu đơn chỉ trong vài giây.
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
            <span class="work-job-service-name">${escapeHTML(j.service)}</span>
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
    } catch (e) {}
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
    } catch (err) {}
  };

  window.deleteWorkJob = async function (jobId) {
    if (!confirm('Xoá đơn dịch vụ này khỏi sổ công việc? Thao tác này không thể hoàn tác.')) return;
    try {
      await api('/api/work/job/' + jobId, { method: 'DELETE' });
      showToast('Đã xoá đơn dịch vụ');
      await loadWorkData(workState.date);
    } catch (e) {}
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
      return `
        <button type="button" class="work-day-brief-row font-tabular" style="${isSelected ? 'border-color: #6CA844; background-color: #F2F9EE;' : ''}" onclick="loadWorkData('${d.date}')">
          <div>
            <strong style="font-size: 13.5px; color: var(--text-main);">${formatVNDate(d.date)} (${getDayOfWeekVN(d.date)})</strong>
            <div style="font-size: 11.5px; color: var(--text-sub); margin-top: 2px;">
              ${d.job_count} đơn &bull; Đã thu ${formatShortK(d.paid_amount)}
              ${d.unpaid_amount > 0 ? ` &bull; <span style="color:#B45309;font-weight:700;">Nợ ${formatShortK(d.unpaid_amount)}</span>` : ''}
              ${d.expense_amount > 0 ? ` &bull; Chi ${formatShortK(d.expense_amount)}` : ''}
            </div>
          </div>
          <div style="text-align: right;">
            <span style="font-size: 14.5px; font-weight: 800; color: #1E3B13;">${formatShortK(d.total_revenue)}</span>
          </div>
        </button>
      `;
    }).join('');
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
    } catch (e) {}
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
    try {
      await api('/api/work/ledger', {
        method: 'POST',
        body: JSON.stringify({
          date: workState.date || state.today,
          category,
          amount,
          note
        })
      });
      document.getElementById('work-ledger-amount').value = '';
      document.getElementById('work-ledger-note').value = '';
      showToast('Đã lưu khoản mục vào sổ');
      await loadWorkData(workState.date);
    } catch (err) {}
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

  function renderWorkLedgerList() {
    const container = document.getElementById('work-ledger-list');
    if (!container) return;
    const list = workState.ledger || [];
    if (list.length === 0) {
      container.innerHTML = `
        <div class="empty-state-box">
          Chưa có khoản chi tiêu, nộp quỹ hay mượn/trả nợ nào trong ngày ${formatVNDate(workState.date)}.
        </div>
      `;
      return;
    }

    container.innerHTML = list.map(item => `
      <div class="work-job-card">
        <div class="work-job-top">
          <div>
            <span class="work-stt-badge">${getLedgerCatLabel(item.category)}</span>
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

  window.deleteWorkLedger = async function (id) {
    if (!confirm('Xoá khoản mục thu chi này?')) return;
    try {
      await api('/api/work/ledger/' + id, { method: 'DELETE' });
      showToast('Đã xoá khoản mục');
      await loadWorkData(workState.date);
    } catch (e) {}
  };

  window.exportWorkExcel = function () {
    const month = workState.month || (workState.date || state.today).slice(0, 7);
    window.location.href = `/api/work/export?month=${encodeURIComponent(month)}`;
  };

  // Khởi động ứng dụng
  init();
})();
