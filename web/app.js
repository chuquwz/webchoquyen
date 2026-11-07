// QuyenHealth - Ultra-fast, minimal Vanilla JS App
// Styled 100% like the Sage Green Clean Mockup Interface - Thuần Tiếng Việt
(function () {
  'use strict';

  // State cục bộ của ứng dụng
  let state = {
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
        showAppView();
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
    const loginEl = document.getElementById('login-view');
    const appEl = document.getElementById('app-view');
    if (loginEl) loginEl.style.display = 'flex';
    if (appEl) appEl.style.display = 'none';
  }

  function showAppView() {
    const loginEl = document.getElementById('login-view');
    const appEl = document.getElementById('app-view');
    if (loginEl) loginEl.style.display = 'none';
    if (appEl) appEl.style.display = 'block';
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
          showAppView();
          await loadToday();
          showToast('Chào Quyền! Chúc một ngày nhiều sức khoẻ');
        }
      } catch (err) { }
    });
  }

  window.logout = async function () {
    if (!confirm('Bạn có chắc muốn đăng xuất khỏi thiết bị này?')) return;
    await api('/api/logout', { method: 'POST' });
    showLoginView();
  };

  // Quản lý Tab: hôm nay, tổng quan, ai, hồ sơ, cài đặt
  window.switchTab = function (tabId) {
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
    if (tabId === 'records') loadMeals();
    if (tabId === 'settings') {
      loadSettingsData();
      loadGlucoseData();
    }

    const scrollContainer = document.querySelector('.app-content-area');
    if (scrollContainer) {
      scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  function setupRouting() {
    const hash = window.location.hash.replace('#', '');
    if (['today', 'overview', 'ai', 'records', 'settings'].includes(hash)) {
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

      renderTodayHeader();
      renderWaterWidget();
      renderMedWidget();
      renderWeightStepper();
      renderDailyHealthScore();
      renderTodayNextMeal(data.meals || []);
    } catch (e) { }
  }

  function renderTodayHeader() {
    const badge = document.getElementById('today-date-badge');
    if (badge) {
      badge.textContent = `${getDayOfWeekVN(state.today)}, ${formatVNDate(state.today)}`;
    }
    const nameEl = document.getElementById('user-display-name');
    if (nameEl) {
      const uName = (state.settings && state.settings.name) || 'Quyền';
      nameEl.textContent = `${uName}! 👋`;
    }
  }

  // Tính & Vẽ Vòng Tròn Điểm Sức Khoẻ Hàng Ngày (Daily Health Score Gauge)
  function renderDailyHealthScore() {
    let score = 70; // Điểm nền móng

    // Uống nước: tối đa 15 điểm
    const minWater = parseInt(state.settings.water_min || 2500);
    const waterRatio = Math.min(1, state.waterTotal / minWater);
    score += Math.round(waterRatio * 15);

    // Thuốc men: 10 điểm
    if (state.medTaken) score += 10;

    // Đo cân sáng: 5 điểm
    if (state.todayWeight !== null) score += 5;

    score = Math.min(100, Math.max(50, score));

    const scoreValEl = document.getElementById('daily-score-val');
    if (scoreValEl) {
      scoreValEl.textContent = `${score}/100`;
    }

    const badgeEl = document.getElementById('daily-score-badge');
    if (badgeEl) {
      badgeEl.textContent = score >= 85 ? 'Tốt' : score >= 70 ? 'Khá' : 'Đang cải thiện';
    }

    // Vẽ vòng Gauge SVG (Chu vi r=40 là 251.2)
    const ringCircle = document.getElementById('score-ring-circle');
    if (ringCircle) {
      const circum = 251.2;
      const offset = circum - (circum * (score / 100));
      ringCircle.style.strokeDashoffset = offset;
    }

    // Cập nhật thẻ tóm tắt nước uống ở mục Hôm Nay
    const waterSummary = document.getElementById('summary-water-display');
    if (waterSummary) {
      waterSummary.textContent = (state.waterTotal / 1000).toFixed(1);
    }
  }

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

    if (undoBtn && entriesCount) {
      if (state.waterEntries.length > 0) {
        undoBtn.style.display = 'inline-block';
        const last = state.waterEntries[state.waterEntries.length - 1];
        const timeStr = new Date(last.ts * 1000).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        entriesCount.textContent = `Lần gần nhất: +${last.ml}ml lúc ${timeStr}`;
      } else {
        undoBtn.style.display = 'none';
        entriesCount.textContent = 'Chưa có lần uống nào';
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
    if (!btn) return;
    if (state.medTaken) {
      btn.className = 'btn-med-chip taken';
      btn.innerHTML = '<span>Đã uống thuốc hôm nay</span>';
    } else {
      btn.className = 'btn-med-chip';
      btn.innerHTML = '<span>Chưa uống thuốc</span>';
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
    if (btnSave && sub) {
      if (state.todayWeight !== null) {
        btnSave.textContent = 'Đã lưu (' + state.todayWeight.toFixed(1) + 'kg) - Bấm sửa';
        btnSave.className = 'btn-secondary-pill btn-save-weight';
        sub.textContent = 'Hôm nay Quyền đã ghi nhận cân nặng!';
      } else {
        btnSave.textContent = 'Lưu cân nặng';
        btnSave.className = 'btn-green-pill btn-save-weight';
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

  window.openOverviewMenu = function () {
    showToast('Tuỳ chọn: Xuất báo cáo, Tải CSV, Lọc số đo');
  };

  window.openNotificationsModal = function () {
    showToast('Hôm nay bạn không có cảnh báo sức khoẻ nào bất thường!');
  };

  window.openSymptomChecker = function () {
    switchTab('ai');
    sendQuickPrompt('Tôi muốn kiểm tra một vài triệu chứng sức khoẻ...');
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
      const s = data.settings || {};
      state.settings = s;
      if (document.getElementById('set-name')) document.getElementById('set-name').value = s.name || 'Quyền';
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
      name: document.getElementById('set-name').value.trim(),
      age: document.getElementById('set-age').value,
      height: document.getElementById('set-height').value,
      goal_weight: document.getElementById('set-goal').value,
      water_min: document.getElementById('set-water-min').value,
      water_max: document.getElementById('set-water-max').value,
      t_weight: document.getElementById('set-t-weight').value,
      t_med: document.getElementById('set-t-med').value,
      t_sleep: document.getElementById('set-t-sleep').value,
      snack: document.getElementById('set-snack').value,
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

  // --- THÔNG BÁO PUSH ---
  function urlBase64ToUint8Array(base64String) {
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
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      showToast('Trình duyệt chưa hỗ trợ thông báo push', true);
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        showToast('Chưa cấp quyền thông báo cho ứng dụng', true);
        return;
      }

      const keyData = await api('/api/push/key');
      const pubKey = keyData.publicKey;
      const reg = await navigator.serviceWorker.ready;

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(pubKey)
        });
      }

      await api('/api/push/subscribe', {
        method: 'POST',
        body: JSON.stringify(sub)
      });
      showToast('Đã bật thông báo thành công');
    } catch (err) {
      showToast('Lỗi bật thông báo: ' + err.message, true);
    }
  };

  window.sendTestPush = async function () {
    try {
      const res = await api('/api/push/test', { method: 'POST' });
      if (res.sent > 0) {
        showToast('Đã gửi thông báo thử tới thiết bị!');
      } else {
        showToast('Chưa có thiết bị đăng ký. Bấm "Bật thông báo" trước nhé.', true);
      }
    } catch (e) { }
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

  // ================= 5. TRỢ LÝ SỨC KHOẺ AI TƯƠNG TÁC THUẦN TIẾNG VIỆT =================
  window.submitAiMessage = function () {
    const input = document.getElementById('ai-input-field');
    if (!input) return;
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    sendAiMessage(msg);
  };

  window.handleAiKeydown = function (e) {
    if (e.key === 'Enter') {
      submitAiMessage();
    }
  };

  window.sendQuickPrompt = function (promptText) {
    switchTab('ai');
    sendAiMessage(promptText);
  };

  function sendAiMessage(msg) {
    const stream = document.getElementById('ai-chat-messages');
    if (!stream) return;

    // 1. Thêm bong bóng của người dùng (màu xanh lá bên phải)
    const userRow = document.createElement('div');
    userRow.className = 'chat-row user-row';
    userRow.innerHTML = `<div class="chat-bubble user-bubble">${escapeHtml(msg)}</div>`;
    stream.appendChild(userRow);

    // 2. Thêm chỉ báo AI đang xử lý
    const aiRow = document.createElement('div');
    aiRow.className = 'chat-row ai-row';
    aiRow.innerHTML = `
      <div class="ai-sparkle-avatar">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></svg>
      </div>
      <div class="chat-bubble ai-bubble">
        <div style="display: flex; gap: 4px; align-items: center; padding: 6px 0;">
          <span style="font-size: 13px; color: var(--text-muted);">Đang phân tích dữ liệu sức khoẻ của bạn...</span>
        </div>
      </div>
    `;
    stream.appendChild(aiRow);

    const scrollContainer = document.querySelector('.app-content-area');
    if (scrollContainer) scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'smooth' });

    // 3. Tạo câu trả lời thông minh thuần Tiếng Việt dựa trên dữ liệu sức khoẻ
    setTimeout(() => {
      let adviceText = '';
      let recs = [];
      const lower = msg.toLowerCase();

      if (lower.includes('đau đầu') || lower.includes('mệt') || lower.includes('ốm') || lower.includes('chóng mặt')) {
        adviceText = "Chào Quyền, tôi rất tiếc khi biết bạn đang cảm thấy mệt mỏi và đau đầu. Đối với người đang theo dõi men gan và điều chỉnh cân nặng, triệu chứng này thường do thiếu nước, căng thẳng hoặc thiếu ngủ. Dưới đây là các khuyến nghị:";
        recs = [
          "Nghỉ ngơi và đi ngủ sớm trước 22:30 đêm nay (mục tiêu 7 - 8 tiếng)",
          `Uống ngay 1 ca nước lọc ấm (hôm nay bạn đã uống ${state.waterTotal}ml / 2.500ml)`,
          "Hạn chế nhìn màn hình điện thoại trước khi ngủ ít nhất 30 phút",
          "Uống thuốc hạ men gan theo đúng đơn sau bữa ăn, nếu đau kéo dài hãy đi khám bác sĩ"
        ];
      } else if (lower.includes('thực đơn') || lower.includes('ăn') || lower.includes('đói') || lower.includes('món')) {
        adviceText = "Kế hoạch dinh dưỡng hôm nay của Quyền được thiết kế ~1.800 kcal, tập trung vào thực phẩm làng quê quen thuộc ít dầu mỡ để bảo vệ gan:";
        recs = [
          "Ưu tiên món luộc, hấp thanh đạm: ức gà luộc, trứng luộc, nạc heo luộc, cá đồng nấu ngót",
          "Tuyệt đối không ăn nội tạng động vật và không chiên rán nhiều mỡ",
          "Bổ sung nhiều rau xanh lá để tăng cường chất xơ đào thải độc tố",
          "Bấm tab 'Hồ sơ' bên dưới để xem chi tiết thực đơn 7 ngày và danh sách đi chợ"
        ];
      } else if (lower.includes('nước') || lower.includes('uống')) {
        adviceText = `Hôm nay bạn đã uống ${state.waterTotal.toLocaleString('vi-VN')} ml nước lọc:`;
        recs = [
          "Mục tiêu tối thiểu là 2.500 ml để thận và gan lọc mỡ thừa hiệu quả",
          "Uống từng ngụm nhỏ, chia đều 4 - 5 lần trong ngày thay vì uống dồn 1 lúc",
          "Không tính nước ngọt có ga, trà quá đặc hay bia rượu vào lượng nước lọc này"
        ];
      } else if (lower.includes('cân') || lower.includes('giảm') || lower.includes('mục tiêu')) {
        const diff = Math.max(0, state.currentWeight - 70.0).toFixed(1);
        adviceText = `Cân nặng hiện tại: ${state.currentWeight.toFixed(1)} kg. Bạn đang trên hành trình tiến về mốc 70.0 kg (cần giảm ${diff} kg):`;
        recs = [
          "Bước lên cân mỗi buổi sáng sau khi đi vệ sinh và trước khi ăn sáng",
          "Tốc độ giảm an toàn và bền vững cho gan là 0.5 - 1.0 kg mỗi tuần",
          "Kết hợp đi bộ nhẹ nhàng 30 - 45 phút mỗi chiều tối sau giờ làm",
          "Uống đều đặn thuốc điều trị theo chỉ định của bác sĩ"
        ];
      } else {
        adviceText = "Chào Quyền! Tôi luôn sẵn sàng đồng hành cùng bạn trên hành trình chăm sóc sức khoẻ. Dưới đây là những lời khuyên phù hợp nhất lúc này:";
        recs = [
          `Duy trì uống đủ nước lọc (mục tiêu 2.500 ml/ngày)`,
          "Ăn đúng bữa theo thực đơn làng quê thanh đạm, tránh hoàn toàn rượu bia",
          "Uống thuốc bảo vệ gan đều đặn sau bữa ăn",
          "Giữ tinh thần thoải mái và đi ngủ trước 22:30"
        ];
      }

      const recsHtml = recs.map(r => `
        <li>
          <span class="rec-check-icon">✔</span>
          <span>${r}</span>
        </li>
      `).join('');

      const bubbleEl = aiRow.querySelector('.ai-bubble');
      if (bubbleEl) {
        bubbleEl.innerHTML = `
          <p class="ai-bubble-intro">${adviceText}</p>
          <ul class="ai-recs-list">${recsHtml}</ul>
          <div class="ai-feedback-toolbar">
            <button type="button" class="btn-feedback" title="Sao chép nội dung" onclick="copyAiResponse(this)">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button type="button" class="btn-feedback" title="Hữu ích" onclick="rateAiResponse(this, 'up')">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
            </button>
            <button type="button" class="btn-feedback" title="Chưa chuẩn" onclick="rateAiResponse(this, 'down')">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/></svg>
            </button>
          </div>
        `;
      }

      if (scrollContainer) scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'smooth' });
    }, 600);
  }

  window.copyAiResponse = function (btn) {
    const bubble = btn.closest('.ai-bubble');
    if (bubble) {
      navigator.clipboard.writeText(bubble.innerText);
      showToast('Đã sao chép nội dung tư vấn');
    }
  };

  window.rateAiResponse = function (btn, type) {
    showToast(type === 'up' ? 'Cảm ơn bạn đã đánh giá tốt!' : 'Cảm ơn, AI sẽ cải thiện câu trả lời');
  };

  window.showAiHistory = function () {
    showToast('Lịch sử trò chuyện gần nhất được lưu trên máy');
  };

  window.openAttachOptions = function () {
    showToast('Đính kèm ảnh kết quả xét nghiệm hoặc đơn thuốc');
  };

  window.startVoiceInput = function () {
    showToast('Bấm và nói câu hỏi sức khoẻ của bạn');
  };

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ================= 6. LỌC HỒ SƠ Y TẾ =================
  window.filterRecords = function (cat, btn) {
    document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    const cards = document.querySelectorAll('.record-card-item');
    cards.forEach(card => {
      if (cat === 'all') {
        card.style.display = 'flex';
      } else if (cat === 'lab') {
        card.style.display = card.classList.contains('record-cat-lab') ? 'flex' : 'none';
      } else if (cat === 'prescription') {
        card.style.display = card.classList.contains('record-cat-prescription') ? 'flex' : 'none';
      } else if (cat === 'report') {
        card.style.display = card.classList.contains('record-cat-report') ? 'flex' : 'none';
      } else if (cat === 'meal') {
        card.style.display = 'none';
      }
    });

    if (cat === 'meal') {
      const mealSec = document.getElementById('meals-list-container');
      if (mealSec) mealSec.scrollIntoView({ behavior: 'smooth' });
    }
  };

  window.viewRecordDetail = function (type) {
    if (type === 'blood') {
      showToast('Xét nghiệm máu & men gan: AST 42 U/L, ALT 55 U/L (Đang hạ dần tốt)');
    } else if (type === 'xray') {
      showToast('Chụp X-quang tim phổi: Phổi sáng, bóng tim bình thường');
    } else if (type === 'vitamind') {
      showToast('Nồng độ Vitamin D: 18 ng/mL (Hơi thấp - Nên phơi nắng sớm 15 phút)');
    } else if (type === 'ecg') {
      showToast('Điện tâm đồ ECG: Nhịp xoang 78 chu kỳ/phút đều, bình thường');
    }
  };

  // ================= 7. MODAL HELPERS =================
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

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.open').forEach(el => {
        el.classList.remove('open');
      });
    }
  });

  // Khởi động ứng dụng
  init();
})();
