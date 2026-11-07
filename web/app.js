// QuyenHealth - Ultra-fast, minimal Vanilla JS App
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
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.style.borderLeft = isErr ? '4px solid #ef4444' : '4px solid #10b981';
    toast.innerHTML = `<span>${msg}</span><button style="background:none;border:none;color:#94a3b8;font-size:16px;cursor:pointer;" onclick="this.parentElement.remove()">&times;</button>`;
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
      // 1. Kiểm tra bản cập nhật mới ngay khi nạp trang
      reg.update().catch(() => {});

      // 2. Tự động kiểm tra cập nhật mỗi khi người dùng quay lại tab web
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          reg.update().catch(() => {});
        }
      });

      // 3. Định kỳ kiểm tra mỗi 60 giây
      setInterval(() => {
        reg.update().catch(() => {});
      }, 60000);
    }).catch(() => {});

    // Khi Service Worker mới kích hoạt thành công -> tự động nạp lại trang để dùng ngay phiên bản mới
    let isRefreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!isRefreshing) {
        isRefreshing = true;
        window.location.reload();
      }
    });
  }

  function showLoginView() {
    document.getElementById('login-view').style.display = 'flex';
    document.getElementById('app-view').style.display = 'none';
  }

  function showAppView() {
    document.getElementById('login-view').style.display = 'none';
    document.getElementById('app-view').style.display = 'block';
  }

  // Xử lý Form đăng nhập
  document.getElementById('login-form').addEventListener('submit', async (e) => {
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

  window.logout = async function () {
    if (!confirm('Bạn có chắc muốn đăng xuất khỏi thiết bị này?')) return;
    await api('/api/logout', { method: 'POST' });
    showLoginView();
  };

  // Quản lý Tab
  window.switchTab = function (tabId) {
    state.activeTab = tabId;
    document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.remove('active');
      el.setAttribute('aria-selected', 'false');
    });

    const targetPane = document.getElementById('tab-' + tabId);
    if (targetPane) targetPane.classList.add('active');

    const navButtons = document.querySelectorAll('.nav-item');
    const tabs = ['today', 'meals', 'weight', 'settings'];
    const idx = tabs.indexOf(tabId);
    if (idx !== -1 && navButtons[idx]) {
      navButtons[idx].classList.add('active');
      navButtons[idx].setAttribute('aria-selected', 'true');
    }

    if (tabId === 'meals') loadMeals();
    if (tabId === 'weight') loadWeightData();
    if (tabId === 'settings') {
      loadSettingsData();
      loadGlucoseData();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  function setupRouting() {
    const hash = window.location.hash.replace('#', '');
    if (['today', 'meals', 'weight', 'settings'].includes(hash)) {
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
      renderTodayNextMeal(data.meals || []);
    } catch (e) { }
  }

  function renderTodayHeader() {
    const badge = document.getElementById('today-date-badge');
    badge.textContent = `${getDayOfWeekVN(state.today)}, ${formatVNDate(state.today)}`;
  }

  // --- UỐNG NƯỚC ---
  function renderWaterWidget() {
    const min = parseInt(state.settings.water_min || 2500);
    const max = parseInt(state.settings.water_max || 3000);
    const cur = state.waterTotal;

    document.getElementById('water-cur').textContent = cur.toLocaleString('vi-VN');
    document.getElementById('water-min-text').textContent = min.toLocaleString('vi-VN') + ' ml';
    document.getElementById('water-max-text').textContent = max.toLocaleString('vi-VN') + ' ml';

    const pct = Math.min(100, Math.round((cur / min) * 100));
    document.getElementById('water-percent-text').textContent = pct + '%';

    // Cập nhật SVG Progress Ring nếu có
    const ring = document.getElementById('water-ring-progress');
    if (ring) {
      const ringPct = Math.min(100, (cur / min) * 100);
      const offset = 465 - (465 * ringPct / 100);
      ring.style.strokeDashoffset = offset;
    }

    const fillEl = document.getElementById('water-fill');
    if (fillEl) {
      const fillHeight = Math.min(100, (cur / max) * 100);
      fillEl.style.height = `${fillHeight}%`;
    }

    const badge = document.getElementById('water-badge');
    const undoBtn = document.getElementById('btn-undo-water');
    const entriesCount = document.getElementById('water-entries-count');

    if (cur >= min && cur <= max) {
      badge.textContent = 'Đã đạt mục tiêu';
      badge.className = 'badge badge-emerald';
    } else if (cur > max) {
      badge.textContent = 'Đã vượt 3.000ml';
      badge.className = 'badge badge-amber';
    } else {
      const remain = min - cur;
      badge.textContent = `Thiếu ${remain.toLocaleString('vi-VN')}ml`;
      badge.className = 'badge';
    }

    if (state.waterEntries.length > 0) {
      undoBtn.style.display = 'inline-block';
      const last = state.waterEntries[state.waterEntries.length - 1];
      const timeStr = new Date(last.ts * 1000).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
      entriesCount.textContent = `Lần gần nhất: +${last.ml}ml lúc ${timeStr}`;
    } else {
      undoBtn.style.display = 'none';
      entriesCount.textContent = 'Chưa có lần uống nào hôm nay';
    }
  }

  window.addWater = async function (ml) {
    // Optimistic UI update
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
    document.getElementById('custom-water-ml').value = '';
    openModal('modal-water');
  };

  window.submitCustomWater = async function (e) {
    e.preventDefault();
    const ml = parseInt(document.getElementById('custom-water-ml').value);
    if (!ml || ml < 1 || ml > 2000) {
      showToast('Số ml phải từ 1 đến 2000', true);
      return;
    }
    closeModal('modal-water');
    await addWater(ml);
  };

  // --- CHECKLIST THUỐC ---
  function renderMedWidget() {
    const btn = document.getElementById('btn-today-med');
    if (state.medTaken) {
      btn.className = 'btn-med-toggle taken';
      btn.innerHTML = '<span>Đã uống thuốc</span>';
    } else {
      btn.className = 'btn-med-toggle';
      btn.innerHTML = '<span>Chưa uống</span>';
    }
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
      showToast(next ? 'Đã ghi nhận uống thuốc hôm nay' : 'Đã bỏ ghi nhận uống thuốc');
    } catch (e) {
      state.medTaken = !next;
      renderMedWidget();
    }
  };

  // --- CÂN NẶNG HÔM NAY & STEPPER ---
  function renderWeightStepper() {
    let dispKg = state.todayWeight !== null ? state.todayWeight : state.currentWeight;
    document.getElementById('weight-val').textContent = dispKg.toFixed(1);

    const btnSave = document.getElementById('btn-save-weight');
    const sub = document.getElementById('weight-status-sub');
    if (state.todayWeight !== null) {
      btnSave.textContent = 'Đã lưu hôm nay (' + state.todayWeight.toFixed(1) + ' kg) - Bấm để sửa';
      btnSave.className = 'btn-secondary';
      sub.textContent = 'Hôm nay Quyền đã ghi nhận cân nặng!';
    } else {
      btnSave.textContent = 'Lưu cân nặng hôm nay';
      btnSave.className = 'btn-primary';
      sub.textContent = 'Nhớ cân vào sáng sớm sau khi vệ sinh, trước khi ăn sáng.';
    }
  }

  window.adjustWeight = function (delta) {
    let cur = parseFloat(document.getElementById('weight-val').textContent);
    cur = Math.round((cur + delta) * 10) / 10;
    if (cur < 40) cur = 40;
    if (cur > 200) cur = 200;
    document.getElementById('weight-val').textContent = cur.toFixed(1);
  };

  window.saveWeight = async function () {
    const kg = parseFloat(document.getElementById('weight-val').textContent);
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
    if (!mealsList || mealsList.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 12px 0;">
          Chưa có lịch bữa ăn cho hôm nay.
          <div style="margin-top: 10px;">
            <button class="btn-primary" style="padding: 8px 16px; font-size: 13px;" onclick="switchTab('meals')">Đến trang Bữa ăn để tạo lịch</button>
          </div>
        </div>`;
      return;
    }

    // Tìm bữa chưa ăn tiếp theo (theo giờ hiện tại)
    const order = ['breakfast', 'lunch', 'dinner', 'snack'];
    let nextMeal = mealsList.find(m => m.status === 'pending');
    if (!nextMeal) {
      nextMeal = mealsList[mealsList.length - 1]; // Đã ăn hết -> hiện bữa cuối
    }

    const slotNames = { breakfast: 'Bữa Sáng', lunch: 'Bữa Trưa', dinner: 'Bữa Tối', snack: 'Bữa Phụ' };
    let itemsHtml = nextMeal.items.map(it => `
      <li class="meal-item ${it.red ? 'meal-item-red' : ''}">
        <span>${it.red ? '<span class="meal-item-red-tag">[Chú ý] </span>' : ''}${it.name}</span>
        <span class="meal-item-qty">${it.qty || ''}</span>
      </li>`).join('');

    container.innerHTML = `
      <div class="meal-slot" style="margin-bottom: 0;">
        <div class="meal-slot-header">
          <span class="meal-slot-name">${slotNames[nextMeal.slot] || nextMeal.slot}</span>
          <span class="meal-slot-kcal">${nextMeal.kcal} kcal</span>
        </div>
        <ul class="meal-items-list">${itemsHtml}</ul>
        <div class="meal-slot-actions">
          <button class="btn-slot-act ${nextMeal.status === 'done' ? 'active-done' : ''}" onclick="checkMeal('${nextMeal.date}', '${nextMeal.slot}', 'done')">
            Ăn đúng món này
          </button>
          <button class="btn-slot-act ${nextMeal.status === 'swapped' ? 'active-diff' : ''}" onclick="openMealNoteModal('${nextMeal.date}', '${nextMeal.slot}', '${nextMeal.note || ''}')">
            Bữa này ăn món khác
          </button>
          ${nextMeal.status !== 'pending' ? `<button class="btn-slot-act" onclick="checkMeal('${nextMeal.date}', '${nextMeal.slot}', 'pending')">Đặt lại</button>` : ''}
        </div>
        ${nextMeal.status === 'swapped' && nextMeal.note ? `<div class="meal-note-box">Thực tế đã ăn: ${nextMeal.note}</div>` : ''}
      </div>`;
  }

  // ================= 2. BỮA ĂN (7 NGÀY) =================
  async function loadMeals() {
    const container = document.getElementById('meals-list-container');
    container.innerHTML = '<div style="text-align: center; padding: 40px 0; color: var(--text-muted);">Đang tải thực đơn 7 ngày...</div>';
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
      if (!confirm('Tạo lại lịch sẽ làm mới các bữa ăn chưa ăn trong 7 ngày tới (các bữa đã tick ăn hoặc đã ghi chú sẽ được giữ nguyên). Tiếp tục?')) {
        return;
      }
    }
    showToast('Đang tạo thực đơn 7 ngày phù hợp với sức khoẻ Quyền...');
    try {
      const data = await api('/api/meals/generate', { method: 'POST' });
      state.mealPlan = data.rows || [];
      renderMealPlanList();
      showToast('Đã tạo lịch bữa ăn 7 ngày thành công');
    } catch (e) { }
  };

  function renderMealPlanList() {
    const container = document.getElementById('meals-list-container');
    if (!state.mealPlan || state.mealPlan.length === 0) {
      container.innerHTML = `
        <div class="card" style="text-align: center; padding: 40px 20px;">
          <h3 style="margin-bottom: 8px;">Chưa có lịch ăn 7 ngày</h3>
          <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 20px;">
            Hệ thống sẽ tự động cân đối kcal (~1.800 kcal/ngày), đủ rau xanh, thực phẩm đỏ, hạn chế đạm purin cao cho Quyền.
          </p>
          <button class="btn-primary" onclick="generateMealPlan()">Bấm để tự tạo lịch bữa ăn ngay</button>
        </div>`;
      return;
    }

    // Nhóm các bữa theo ngày
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
        <div class="card meal-day-card" style="${isToday ? 'border-color: rgba(56, 189, 248, 0.4);' : ''}">
          <div class="meal-day-header">
            <div style="display: flex; align-items: center; gap: 8px;">
              <strong style="font-size: 15px; font-weight: 700;">${getDayOfWeekVN(date)} (${formatVNDate(date)})</strong>
              ${isToday ? '<span class="badge badge-emerald">HÔM NAY</span>' : ''}
            </div>
            <span style="font-size: 13px; color: var(--text-tertiary); font-weight: 600; font-variant-numeric: tabular-nums;">${totalKcal} kcal</span>
          </div>`;

      dayMeals.forEach(slotMeal => {
        let itemsHtml = slotMeal.items.map(it => `
          <li class="meal-item ${it.red ? 'meal-item-red' : ''}">
            <span>${it.red ? '<span class="meal-item-red-tag">[Chú ý] </span>' : ''}${it.name}</span>
            <span class="meal-item-qty">${it.qty || ''}</span>
          </li>`).join('');

        html += `
          <div class="meal-slot">
            <div class="meal-slot-header">
              <span class="meal-slot-name">${slotNames[slotMeal.slot] || slotMeal.slot}</span>
              <div style="display: flex; gap: 8px; align-items: center;">
                <span class="meal-slot-kcal">${slotMeal.kcal} kcal</span>
                ${slotMeal.status === 'pending' ? `<button class="btn-chip" style="padding: 2px 8px; font-size: 11px;" onclick="swapMeal('${date}', '${slotMeal.slot}')">Đổi món</button>` : ''}
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
            ${slotMeal.status === 'swapped' && slotMeal.note ? `<div class="meal-note-box">Thực tế đã ăn: ${slotMeal.note}</div>` : ''}
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
      showToast('Đã đổi món thành công!');
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
        html += `<div style="font-weight: 700; font-size: 14px; margin: 12px 0 6px; color: #38bdf8;">${grp}</div>`;
        groups[grp].forEach(item => {
          const key = item.name + '_' + item.text;
          const checked = boughtItems[key] ? 'checked' : '';
          html += `
            <label style="display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; background: rgba(0,0,0,0.15); margin-bottom: 6px; border-radius: 8px; cursor: pointer;">
              <span style="display: flex; align-items: center; gap: 8px;">
                <input type="checkbox" ${checked} onchange="toggleBoughtItem('${key}', this.checked)" style="width: 18px; height: 18px;">
                <span style="${checked ? 'text-decoration: line-through; opacity: 0.5;' : ''}">${item.name}</span>
              </span>
              <span style="font-size: 13px; font-weight: 600; color: #cbd5e1;">${item.text}</span>
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

    let cur = state.currentWeight;
    if (state.weights.length > 0) {
      cur = state.weights[state.weights.length - 1].kg;
    }
    curEl.textContent = cur.toFixed(1) + ' kg';
    const rem = Math.max(0, cur - 70.0);
    remEl.textContent = rem.toFixed(1) + ' kg';

    const wList = state.weights;
    if (wList.length === 0) {
      svg.innerHTML = '<text x="250" y="100" fill="#64748b" text-anchor="middle" font-size="13">Chưa có đủ dữ liệu để vẽ biểu đồ</text>';
      return;
    }

    // Tính toán toạ độ vẽ SVG (500x200)
    const minKg = 65;
    const maxKg = 100;
    const padX = 40;
    const padY = 24;
    const w = 500 - padX * 2;
    const h = 200 - padY * 2;

    const getY = (kg) => padY + h - ((kg - minKg) / (maxKg - minKg)) * h;

    // Đường mốc 70kg (xanh lá)
    const y70 = getY(70);
    let svgContent = `
      <defs>
        <linearGradient id="chartLineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#38bdf8" />
          <stop offset="100%" stop-color="#0284c7" />
        </linearGradient>
      </defs>
      <line x1="${padX}" y1="${getY(80)}" x2="${500 - padX}" y2="${getY(80)}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="2,2" stroke-width="1"/>
      <line x1="${padX}" y1="${getY(90)}" x2="${500 - padX}" y2="${getY(90)}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="2,2" stroke-width="1"/>
      <line x1="${padX}" y1="${y70}" x2="${500 - padX}" y2="${y70}" stroke="#10b981" stroke-dasharray="4,4" stroke-width="1.5"/>
      <text x="${500 - padX + 6}" y="${y70 + 4}" fill="#10b981" font-size="11" font-weight="600">70kg</text>
    `;

    // Vẽ các điểm và đường cân nặng thực tế
    let pts = [];
    const stepX = w / Math.max(1, wList.length - 1);
    wList.forEach((pt, i) => {
      const x = padX + i * stepX;
      const y = getY(pt.kg);
      pts.push(`${x},${y}`);
    });

    svgContent += `
      <polyline fill="none" stroke="url(#chartLineGrad)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${pts.join(' ')}" />
    `;

    wList.forEach((pt, i) => {
      const x = padX + i * stepX;
      const y = getY(pt.kg);
      svgContent += `
        <circle cx="${x}" cy="${y}" r="3.5" fill="#38bdf8" stroke="#090d16" stroke-width="1.5" />
        <text x="${x}" y="${y - 8}" fill="#94a3b8" font-size="10" font-weight="600" text-anchor="middle">${pt.kg}</text>
      `;
    });

    svg.innerHTML = svgContent;
  }

  function renderWeightHistory() {
    const container = document.getElementById('weight-history-list');
    if (state.weights.length === 0) {
      container.innerHTML = '<div style="color: var(--text-tertiary); padding: 12px 0; font-size: 13px;">Chưa có ngày đo nào.</div>';
      return;
    }
    let html = '<table style="width: 100%; font-size: 13px; border-collapse: collapse;">';
    html += '<tr style="color: var(--text-tertiary); border-bottom: 1px solid var(--border-subtle); text-align: left;"><th style="padding: 8px 6px; font-weight: 500;">Ngày</th><th style="padding: 8px 6px; font-weight: 500;">Cân nặng</th><th style="padding: 8px 6px; text-align: right; font-weight: 500;">Thay đổi</th></tr>';

    for (let i = state.weights.length - 1; i >= 0; i--) {
      const item = state.weights[i];
      let diffStr = '-';
      if (i > 0) {
        const prev = state.weights[i - 1];
        const diff = item.kg - prev.kg;
        if (diff > 0) diffStr = `<span style="color: var(--rose); font-weight: 600;">+${diff.toFixed(1)}kg</span>`;
        else if (diff < 0) diffStr = `<span style="color: var(--emerald); font-weight: 600;">${diff.toFixed(1)}kg</span>`;
        else diffStr = '<span style="color: var(--text-tertiary);">0.0kg</span>';
      }
      html += `
        <tr style="border-bottom: 1px solid var(--border-subtle);">
          <td style="padding: 10px 6px; color: var(--text-secondary);">${formatVNDate(item.date)}</td>
          <td style="padding: 10px 6px; font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums;">${item.kg.toFixed(1)} kg</td>
          <td style="padding: 10px 6px; text-align: right; font-variant-numeric: tabular-nums;">${diffStr}</td>
        </tr>`;
    }
    html += '</table>';
    container.innerHTML = html;
  }

  // ================= 4. THÊM & CÀI ĐẶT =================
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
      document.getElementById('set-name').value = s.name || 'Quyền';
      document.getElementById('set-age').value = s.age || '22';
      document.getElementById('set-height').value = s.height || '172';
      document.getElementById('set-goal').value = s.goal_weight || '70';
      document.getElementById('set-water-min').value = s.water_min || '2500';
      document.getElementById('set-water-max').value = s.water_max || '3000';
      document.getElementById('set-t-weight').value = s.t_weight || '06:30';
      document.getElementById('set-t-med').value = s.t_med || '08:00';
      document.getElementById('set-t-sleep').value = s.t_sleep || '22:30';
      document.getElementById('set-snack').value = s.snack || '1';

      // Nạp mốc nhắc nhở tự do
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
        badge.className = 'badge';
      } else {
        badge.textContent = `${list.length} mốc/ngày`;
        badge.className = 'badge badge-emerald';
      }
    }

    if (list.length === 0) {
      container.innerHTML = '<span style="font-size:12px; color:var(--text-tertiary); padding:4px 0;">Chưa có mốc nào (bấm nút bên dưới để thêm)</span>';
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
      showToast('Tối đa 10 mốc giờ cho mỗi mục', true);
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
      if (document.getElementById('set-t-weight')) {
        document.getElementById('set-t-weight').value = payload.t_weight;
      }
      if (document.getElementById('set-t-med')) {
        document.getElementById('set-t-med').value = payload.t_med;
      }
      if (document.getElementById('set-t-sleep')) {
        document.getElementById('set-t-sleep').value = payload.t_sleep;
      }
      showToast('Đã lưu lịch & số lần nhắc nhở thành công!');
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
      showToast('Đã lưu cấu hình cá nhân thành công');
    } catch (e) { }
  };

  // --- THÔNG BÁO WEB PUSH ---
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
      showToast('Trình duyệt này chưa hỗ trợ nhận thông báo push', true);
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
      showToast('Đã bật thông báo nhắc nhở thành công');
    } catch (err) {
      showToast('Lỗi kích hoạt thông báo: ' + err.message, true);
    }
  };

  window.sendTestPush = async function () {
    try {
      const res = await api('/api/push/test', { method: 'POST' });
      if (res.sent > 0) {
        showToast('Đã gửi thông báo thử tới thiết bị! Kiểm tra thanh thông báo nhé.');
      } else {
        showToast('Chưa có thiết bị nào đăng ký nhận thông báo. Bấm "Bật Nhắc Nhở" trước nhé.', true);
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
    if (state.glucose.length === 0) {
      container.innerHTML = '<div style="color: var(--text-tertiary); padding: 8px 0; font-size: 13px;">Chưa ghi số đo nào gần đây.</div>';
      return;
    }
    const ctxLabels = { fasting: 'Sáng đói', after: 'Sau ăn', bedtime: 'Trước ngủ', other: 'Khác' };
    let html = '';
    state.glucose.slice(0, 5).forEach(g => {
      let color = 'var(--emerald)';
      let tag = 'Bình thường';
      if (g.mmol >= 7.0) {
        color = 'var(--rose)';
        tag = 'Cao (ngưỡng tiểu đường)';
      } else if (g.mmol >= 5.6) {
        color = 'var(--amber)';
        tag = 'Cận ngưỡng';
      }
      const timeStr = new Date(g.ts * 1000).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
      html += `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--border-subtle);">
          <div>
            <strong style="color: ${color}; font-size: 15px; font-variant-numeric: tabular-nums;">${g.mmol.toFixed(1)} mmol/L</strong>
            <span style="font-size: 12px; color: var(--text-tertiary); margin-left: 6px;">(${ctxLabels[g.ctx] || g.ctx})</span>
          </div>
          <div style="font-size: 12px; color: var(--text-tertiary);">${timeStr} · <span style="color:${color}; font-weight:600;">${tag}</span></div>
        </div>`;
    });
    container.innerHTML = html;
  }

  window.openGlucoseModal = function () {
    document.getElementById('glucose-mmol').value = '';
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
      showToast('Đã ghi chỉ số đường huyết thành công');
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

      let weightChange = 'Chưa có đủ số liệu đo';
      if (weights.length >= 2) {
        const diff = weights[weights.length - 1].kg - weights[0].kg;
        weightChange = `${diff > 0 ? '+' : ''}${diff.toFixed(1)} kg (${weights[0].kg}kg &rarr; ${weights[weights.length - 1].kg}kg)`;
      }

      container.innerHTML = `
        <div style="background: rgba(0,0,0,0.2); padding: 14px; border-radius: 12px; margin-bottom: 14px;">
          <div style="font-size: 15px; font-weight: 700; margin-bottom: 8px; color: #38bdf8;">Tóm tắt tuân thủ 7 ngày</div>
          <div><strong>Nước lọc trung bình:</strong> ${avgWater.toLocaleString('vi-VN')} ml / ngày (mục tiêu 2500ml)</div>
          <div><strong>Ăn đúng thực đơn:</strong> ${mealRate}% các bữa chính</div>
          <div><strong>Uống thuốc đều:</strong> ${medRate}% số ngày (${medCount}/7 ngày)</div>
          <div><strong>Cân nặng thay đổi:</strong> <strong>${weightChange}</strong></div>
        </div>
        <div style="color: var(--text-muted); font-size: 12px; margin-bottom: 12px;">
          * Bác sĩ có thể chụp màn hình này trong mỗi lần tái khám để đánh giá mức độ cải thiện gan nhiễm mỡ và phòng ngừa tiểu đường/gút.
        </div>
        <button class="btn-primary" onclick="window.print()">In hoặc Lưu PDF báo cáo</button>
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
    if (!confirm('Khôi phục dữ liệu sẽ ghi đè dữ liệu hiện tại trên web bằng nội dung file sao lưu. Bạn có chắc chắn?')) {
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
      showToast('Khôi phục dữ liệu thành công! Đang tải lại...');
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      showToast('File sao lưu không hợp lệ: ' + err.message, true);
    }
    e.target.value = '';
  };

  // Modal helpers
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

  // Đóng modal khi click ra ngoài vùng xám
  document.querySelectorAll('.modal-overlay').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target === el) el.classList.remove('open');
    });
  });

  // Hỗ trợ phím Escape để đóng modal (WCAG 2.1 / better-accessibility)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.open').forEach(el => {
        el.classList.remove('open');
      });
    }
  });

  // Khởi động
  init();
})();

