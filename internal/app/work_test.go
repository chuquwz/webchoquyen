package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func newTestServer(t *testing.T) *Server {
	t.Helper()
	db, err := OpenDB(t.TempDir())
	if err != nil {
		t.Fatalf("OpenDB: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	static := fstest.MapFS{
		"index.html": {Data: []byte("<html></html>")},
		"style.css":  {Data: []byte("body{}")},
		"app.js":     {Data: []byte("")},
		"sw.js":      {Data: []byte("")},
	}
	srv, err := New(Config{Pin: "0312"}, db, static)
	if err != nil {
		t.Fatalf("New server: %v", err)
	}
	return srv
}

func authedReq(srv *Server, method, target string, body any) *http.Request {
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, target, &buf)
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "qh", Value: srv.sessionToken()})
	return req
}

func TestWorkFlowAndExport(t *testing.T) {
	srv := newTestServer(t)
	h := srv.Handler()
	today := srv.today()

	// 1. Tạo 2 đơn dịch vụ: 1 đơn TT (200k), 1 đơn CTT (80k)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, authedReq(srv, "POST", "/api/work/job", map[string]any{
		"date":     today,
		"customer": "Lý Tuấn",
		"channel":  "ZL",
		"service":  "BYPASS MDM X4",
		"price":    200, // tự động nhân 1000 -> 200.000đ
		"status":   "TT",
	}))
	if w.Code != 200 {
		t.Fatalf("expected 200 creating job 1, got %d: %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	h.ServeHTTP(w, authedReq(srv, "POST", "/api/work/job", map[string]any{
		"date":     today,
		"customer": "Điện Thoại Nguyên Trường",
		"channel":  "ZL",
		"service":  "FIX VOLTE OPPO A55S 5G",
		"price":    80000,
		"status":   "CTT",
	}))
	if w.Code != 200 {
		t.Fatalf("expected 200 creating job 2, got %d: %s", w.Code, w.Body.String())
	}

	// 2. Tạo 2 khoản thu chi / quỹ: 10k thuê tools (expense) + 155k nộp quỹ (fund_in)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, authedReq(srv, "POST", "/api/work/ledger", map[string]any{
		"date":     today,
		"category": "expense",
		"amount":   10, // 10.000đ
		"note":     "Thuê tools",
	}))
	if w.Code != 200 {
		t.Fatalf("expected 200 creating ledger 1, got %d: %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	h.ServeHTTP(w, authedReq(srv, "POST", "/api/work/ledger", map[string]any{
		"date":     today,
		"category": "fund_in",
		"amount":   155000,
		"note":     "Nộp quỹ ngày",
	}))
	if w.Code != 200 {
		t.Fatalf("expected 200 creating ledger 2, got %d: %s", w.Code, w.Body.String())
	}

	// 3. Kiểm tra GET /api/work
	w = httptest.NewRecorder()
	h.ServeHTTP(w, authedReq(srv, "GET", "/api/work?date="+today, nil))
	if w.Code != 200 {
		t.Fatalf("expected 200 GET /api/work, got %d", w.Code)
	}
	var resp struct {
		DaySummary      workSummary           `json:"day_summary"`
		UnpaidGroups    []unpaidCustomerGroup `json:"unpaid_groups"`
		TotalUnpaidAll  int                   `json:"total_unpaid_all"`
		TotalUnpaidJobs int                   `json:"total_unpaid_jobs"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal work response: %v", err)
	}
	if resp.DaySummary.TotalRevenue != 280000 {
		t.Fatalf("expected total revenue 280000, got %d", resp.DaySummary.TotalRevenue)
	}
	if resp.DaySummary.PaidAmount != 200000 || resp.DaySummary.UnpaidAmount != 80000 {
		t.Fatalf("unexpected paid/unpaid: %+v", resp.DaySummary)
	}
	if resp.DaySummary.ExpenseAmount != 10000 || resp.DaySummary.NetCash != 190000 || resp.DaySummary.FundIn != 155000 {
		t.Fatalf("unexpected ledger summary: %+v", resp.DaySummary)
	}
	if len(resp.UnpaidGroups) != 1 || resp.UnpaidGroups[0].Customer != "Điện Thoại Nguyên Trường" || resp.TotalUnpaidAll != 80000 {
		t.Fatalf("unexpected unpaid groups: %+v", resp.UnpaidGroups)
	}

	// 4. Kiểm tra xuất file CSV Excel
	w = httptest.NewRecorder()
	h.ServeHTTP(w, authedReq(srv, "GET", "/api/work/export?month="+today[:7], nil))
	if w.Code != 200 {
		t.Fatalf("expected 200 GET /api/work/export, got %d", w.Code)
	}
	csvBody := w.Body.String()
	if !strings.Contains(csvBody, "BYPASS MDM X4") || !strings.Contains(csvBody, "Điện Thoại Nguyên Trường") {
		t.Fatalf("CSV export missing expected content: %s", csvBody)
	}

	// 5. Tất toán toàn bộ nợ CTT của khách "Điện Thoại Nguyên Trường"
	w = httptest.NewRecorder()
	h.ServeHTTP(w, authedReq(srv, "POST", "/api/work/job/pay-customer", map[string]any{
		"customer": "Điện Thoại Nguyên Trường",
	}))
	if w.Code != 200 {
		t.Fatalf("expected 200 pay-customer, got %d", w.Code)
	}

	w = httptest.NewRecorder()
	h.ServeHTTP(w, authedReq(srv, "GET", "/api/work?date="+today, nil))
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.DaySummary.PaidAmount != 280000 || resp.DaySummary.UnpaidAmount != 0 || len(resp.UnpaidGroups) != 0 {
		t.Fatalf("expected all paid after pay-customer, got %+v", resp.DaySummary)
	}

	// 6. Kiểm tra đồng bộ Két Tài Chính Máy Cá Nhân (/api/work/vault) khi Redeploy sang DB mới
	w = httptest.NewRecorder()
	h.ServeHTTP(w, authedReq(srv, "GET", "/api/work/vault", nil))
	if w.Code != 200 {
		t.Fatalf("expected 200 GET /api/work/vault, got %d", w.Code)
	}
	var vault struct {
		DBID   string       `json:"db_id"`
		Jobs   []workJob    `json:"jobs"`
		Ledger []workLedger `json:"ledger"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &vault)
	if len(vault.Jobs) != 2 || len(vault.Ledger) != 2 || vault.DBID == "" {
		t.Fatalf("unexpected vault content: %+v", vault)
	}

	// Tạo server mới hoàn toàn (mô phỏng container mới sau khi Redeploy trên Koyeb)
	freshSrv := newTestServer(t)
	freshH := freshSrv.Handler()

	w = httptest.NewRecorder()
	freshH.ServeHTTP(w, authedReq(freshSrv, "POST", "/api/work/vault", map[string]any{
		"mode":   "merge",
		"jobs":   vault.Jobs,
		"ledger": vault.Ledger,
	}))
	if w.Code != 200 {
		t.Fatalf("expected 200 POST /api/work/vault on fresh server, got %d: %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	freshH.ServeHTTP(w, authedReq(freshSrv, "GET", "/api/work?date="+today, nil))
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.DaySummary.TotalRevenue != 280000 || resp.DaySummary.NetCash != 270000 {
		t.Fatalf("expected restored revenue 280000 and net 270000 on fresh server, got %+v", resp.DaySummary)
	}
}

func TestMultiDoseMedByReminderSchedule(t *testing.T) {
	srv := newTestServer(t)
	h := srv.Handler()
	today := srv.today()

	// Mặc định có 3 mốc nhắc thuốc (08:00, 12:30, 20:00) -> target_count = 3
	w := httptest.NewRecorder()
	h.ServeHTTP(w, authedReq(srv, "GET", "/api/today", nil))
	if w.Code != 200 {
		t.Fatalf("expected 200 GET /api/today, got %d", w.Code)
	}
	var todayResp struct {
		Med struct {
			Taken       bool     `json:"taken"`
			TakenCount  int      `json:"taken_count"`
			TargetCount int      `json:"target_count"`
			Times       []string `json:"times"`
		} `json:"med"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &todayResp)
	if todayResp.Med.TargetCount != 3 || todayResp.Med.TakenCount != 0 || todayResp.Med.Taken {
		t.Fatalf("expected target 3 and taken 0, got %+v", todayResp.Med)
	}

	// Ghi nhận uống lần 1/3 -> taken_count = 1, taken = false (chưa đủ 3 lần)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, authedReq(srv, "PUT", "/api/med", map[string]any{
		"date":        today,
		"taken_count": 1,
	}))
	if w.Code != 200 {
		t.Fatalf("expected 200 PUT /api/med, got %d", w.Code)
	}
	var medResp struct {
		Taken       bool `json:"taken"`
		TakenCount  int  `json:"taken_count"`
		TargetCount int  `json:"target_count"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &medResp)
	if medResp.TakenCount != 1 || medResp.TargetCount != 3 || medResp.Taken {
		t.Fatalf("expected 1/3 not yet complete, got %+v", medResp)
	}

	// Ghi nhận uống đủ 3/3 -> taken_count = 3, taken = true
	w = httptest.NewRecorder()
	h.ServeHTTP(w, authedReq(srv, "PUT", "/api/med", map[string]any{
		"date":        today,
		"taken_count": 3,
	}))
	_ = json.Unmarshal(w.Body.Bytes(), &medResp)
	if medResp.TakenCount != 3 || !medResp.Taken {
		t.Fatalf("expected 3/3 complete, got %+v", medResp)
	}
}

func TestMealChecklistDefault3Meals(t *testing.T) {
	srv := newTestServer(t)
	h := srv.Handler()
	today := srv.today()

	// 1. Mặc định GET /api/today trả về đúng 3 bữa (breakfast, lunch, dinner) với status = "pending"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, authedReq(srv, "GET", "/api/today", nil))
	if w.Code != 200 {
		t.Fatalf("expected 200 GET /api/today, got %d", w.Code)
	}
	var todayResp struct {
		MealsTarget int       `json:"meals_target"`
		Meals       []mealRow `json:"meals"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &todayResp); err != nil {
		t.Fatalf("unmarshal /api/today: %v", err)
	}
	if todayResp.MealsTarget != 3 || len(todayResp.Meals) != 3 {
		t.Fatalf("expected 3 default meals, got target=%d len=%d", todayResp.MealsTarget, len(todayResp.Meals))
	}
	expectedSlots := []string{"breakfast", "lunch", "dinner"}
	for i, sl := range expectedSlots {
		if string(todayResp.Meals[i].Slot) != sl || todayResp.Meals[i].Status != "pending" {
			t.Fatalf("meal %d expected (%s, pending), got (%s, %s)", i, sl, todayResp.Meals[i].Slot, todayResp.Meals[i].Status)
		}
	}

	// 2. POST /api/meals/check lưu được trực tiếp trên ngày mới mà không cần generate trước
	w = httptest.NewRecorder()
	h.ServeHTTP(w, authedReq(srv, "POST", "/api/meals/check", map[string]any{
		"date":   today,
		"slot":   "breakfast",
		"status": "done",
		"note":   "Trứng luộc/hấp, Khoai lang/Ngô luộc",
	}))
	if w.Code != 200 {
		t.Fatalf("expected 200 POST /api/meals/check done, got %d: %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	h.ServeHTTP(w, authedReq(srv, "POST", "/api/meals/check", map[string]any{
		"date":   today,
		"slot":   "lunch",
		"status": "swapped",
		"note":   "Có đồ chiên/rán",
	}))
	if w.Code != 200 {
		t.Fatalf("expected 200 POST /api/meals/check swapped, got %d: %s", w.Code, w.Body.String())
	}

	// 3. GET /api/meals chỉ trả về đúng 3 bữa của ngày hôm nay và phản ánh trạng thái đã lưu
	w = httptest.NewRecorder()
	h.ServeHTTP(w, authedReq(srv, "GET", "/api/meals?days=7", nil))
	if w.Code != 200 {
		t.Fatalf("expected 200 GET /api/meals?days=7, got %d", w.Code)
	}
	var mealsResp struct {
		MealsTarget int       `json:"meals_target"`
		Rows        []mealRow `json:"rows"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &mealsResp); err != nil {
		t.Fatalf("unmarshal /api/meals: %v", err)
	}
	if mealsResp.MealsTarget != 3 || len(mealsResp.Rows) != 3 {
		t.Fatalf("expected target=3 and 3 rows for today only, got target=%d len=%d", mealsResp.MealsTarget, len(mealsResp.Rows))
	}

	foundBreakfast := false
	foundLunch := false
	for _, r := range mealsResp.Rows {
		if r.Date != today {
			t.Fatalf("expected only today (%s) rows, got %s", today, r.Date)
		}
		if r.Date == today && r.Slot == "breakfast" {
			foundBreakfast = true
			if r.Status != "done" || r.Note != "Trứng luộc/hấp, Khoai lang/Ngô luộc" {
				t.Fatalf("unexpected breakfast state: %+v", r)
			}
		}
		if r.Date == today && r.Slot == "lunch" {
			foundLunch = true
			if r.Status != "swapped" || r.Note != "Có đồ chiên/rán" {
				t.Fatalf("unexpected lunch state: %+v", r)
			}
		}
	}
	if !foundBreakfast || !foundLunch {
		t.Fatalf("expected today's breakfast and lunch in /api/meals rows")
	}
}

func TestPruneOldHealthDataKeepsWeightHistory(t *testing.T) {
	srv := newTestServer(t)
	h := srv.Handler()
	today := srv.today()
	yesterday := addDays(today, -1)

	// Ghi dữ liệu sức khoẻ ngày hôm qua và lịch sử cân nặng nhiều ngày
	if _, err := srv.db.Exec(`INSERT INTO water_log(ts, date, ml) VALUES(?, ?, ?)`, 1000, yesterday, 500); err != nil {
		t.Fatalf("insert old water: %v", err)
	}
	if _, err := srv.db.Exec(`INSERT INTO med_log(date, taken, ts) VALUES(?, ?, ?)`, yesterday, 2, 1000); err != nil {
		t.Fatalf("insert old med: %v", err)
	}
	if _, err := srv.db.Exec(`INSERT INTO meal_plan(date, slot, items_json, kcal, status, actual_note, updated_at) VALUES(?, 'breakfast', '[]', 0, 'done', '', 1000)`, yesterday); err != nil {
		t.Fatalf("insert old meal: %v", err)
	}
	if _, err := srv.db.Exec(`INSERT INTO weight_log(date, kg, ts) VALUES(?, ?, ?), (?, ?, ?)`, yesterday, 97.5, 1000, today, 97.0, 2000); err != nil {
		t.Fatalf("insert weights: %v", err)
	}

	// Gọi GET /api/today -> tự động xoá nước/thuốc/bữa ăn ngày cũ nhưng giữ toàn bộ cân nặng
	w := httptest.NewRecorder()
	h.ServeHTTP(w, authedReq(srv, "GET", "/api/today", nil))
	if w.Code != 200 {
		t.Fatalf("expected 200 GET /api/today, got %d", w.Code)
	}

	var cnt int
	_ = srv.db.QueryRow(`SELECT COUNT(*) FROM water_log WHERE date=?`, yesterday).Scan(&cnt)
	if cnt != 0 {
		t.Fatalf("expected old water_log deleted, got %d", cnt)
	}
	_ = srv.db.QueryRow(`SELECT COUNT(*) FROM med_log WHERE date=?`, yesterday).Scan(&cnt)
	if cnt != 0 {
		t.Fatalf("expected old med_log deleted, got %d", cnt)
	}
	_ = srv.db.QueryRow(`SELECT COUNT(*) FROM meal_plan WHERE date=?`, yesterday).Scan(&cnt)
	if cnt != 0 {
		t.Fatalf("expected old meal_plan deleted, got %d", cnt)
	}
	_ = srv.db.QueryRow(`SELECT COUNT(*) FROM weight_log`).Scan(&cnt)
	if cnt != 2 {
		t.Fatalf("expected both yesterday and today weight_log preserved, got %d", cnt)
	}

	var todayResp struct {
		Weight struct {
			Rows []weightRow `json:"rows"`
		} `json:"weight"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &todayResp); err != nil {
		t.Fatalf("unmarshal /api/today weight rows: %v", err)
	}
	if len(todayResp.Weight.Rows) != 2 {
		t.Fatalf("expected 2 weight rows in /api/today, got %d", len(todayResp.Weight.Rows))
	}
}

func TestBorrowPartialRepaymentAndVaultSync(t *testing.T) {
	srv := newTestServer(t)
	h := srv.Handler()
	today := srv.today()
	nextDay := addDays(today, 1)

	// 1. Tạo khoản Mượn 2.000.000đ ("A Mạnh")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, authedReq(srv, "POST", "/api/work/ledger", map[string]any{
		"date":     today,
		"category": "borrow",
		"amount":   2000000,
		"note":     "A Mạnh",
	}))
	if w.Code != 200 {
		t.Fatalf("expected 200 creating borrow, got %d: %s", w.Code, w.Body.String())
	}
	var createResp struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &createResp)
	if createResp.ID <= 0 {
		t.Fatalf("expected valid ledger id, got %+v", createResp)
	}

	// 2. Trả lần 1: 500 (tự nhân 1000 = 500.000đ) vào hôm nay
	w = httptest.NewRecorder()
	h.ServeHTTP(w, authedReq(srv, "POST", "/api/work/ledger/"+strconvItoa64(createResp.ID)+"/repay", map[string]any{
		"date":   today,
		"amount": 500,
		"note":   "Chuyển khoản lần 1",
	}))
	if w.Code != 200 {
		t.Fatalf("expected 200 repay 1, got %d: %s", w.Code, w.Body.String())
	}
	var repay1Resp struct {
		RepaymentID     int64 `json:"repayment_id"`
		PaidAmount      int   `json:"paid_amount"`
		RemainingAmount int   `json:"remaining_amount"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &repay1Resp)
	if repay1Resp.PaidAmount != 500000 || repay1Resp.RemainingAmount != 1500000 {
		t.Fatalf("unexpected repay 1 totals: %+v", repay1Resp)
	}

	// 3. Trả lần 2: 300.000đ vào ngày hôm sau -> còn nợ 1.200.000đ
	w = httptest.NewRecorder()
	h.ServeHTTP(w, authedReq(srv, "POST", "/api/work/ledger/"+strconvItoa64(createResp.ID)+"/repay", map[string]any{
		"date":   nextDay,
		"amount": 300000,
		"note":   "Tiền mặt lần 2",
	}))
	if w.Code != 200 {
		t.Fatalf("expected 200 repay 2, got %d: %s", w.Code, w.Body.String())
	}
	var repay2Resp struct {
		RepaymentID     int64 `json:"repayment_id"`
		PaidAmount      int   `json:"paid_amount"`
		RemainingAmount int   `json:"remaining_amount"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &repay2Resp)
	if repay2Resp.PaidAmount != 800000 || repay2Resp.RemainingAmount != 1200000 {
		t.Fatalf("unexpected repay 2 totals: %+v", repay2Resp)
	}

	// 4. Cho phép trả thừa (còn 1.200.000đ, trả 1.500.000đ) -> remaining_amount về 0, settled = true
	w = httptest.NewRecorder()
	h.ServeHTTP(w, authedReq(srv, "POST", "/api/work/ledger/"+strconvItoa64(createResp.ID)+"/repay", map[string]any{
		"date":   today,
		"amount": 1500000,
		"note":   "Trả hết + thêm 300k",
	}))
	if w.Code != 200 {
		t.Fatalf("expected 200 over-repay, got %d: %s", w.Code, w.Body.String())
	}
	var overResp struct {
		RepaymentID     int64 `json:"repayment_id"`
		PaidAmount      int   `json:"paid_amount"`
		RemainingAmount int   `json:"remaining_amount"`
		OverpaidAmount  int   `json:"overpaid_amount"`
		Settled         bool  `json:"settled"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &overResp)
	if !overResp.Settled || overResp.RemainingAmount != 0 || overResp.PaidAmount != 2300000 || overResp.OverpaidAmount != 300000 {
		t.Fatalf("unexpected over-repay totals: %+v", overResp)
	}

	// 5. Kiểm tra GET /api/work?date=today
	w = httptest.NewRecorder()
	h.ServeHTTP(w, authedReq(srv, "GET", "/api/work?date="+today, nil))
	if w.Code != 200 {
		t.Fatalf("expected 200 GET /api/work, got %d", w.Code)
	}
	var workResp struct {
		Ledger     []workLedger `json:"ledger"`
		DaySummary workSummary  `json:"day_summary"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &workResp)
	if len(workResp.Ledger) != 1 {
		t.Fatalf("expected 1 ledger item, got %d", len(workResp.Ledger))
	}
	bItem := workResp.Ledger[0]
	if bItem.Amount != 2000000 || bItem.PaidAmount != 2300000 || bItem.RemainingAmount != 0 || len(bItem.Repayments) != 3 {
		t.Fatalf("unexpected settled borrow item state: %+v", bItem)
	}
	if workResp.DaySummary.BorrowAmount != 0 || workResp.DaySummary.RepayAmount != 2000000 {
		t.Fatalf("unexpected settled day summary: %+v", workResp.DaySummary)
	}

	// 6. Kiểm tra đồng bộ Vault sang server mới khi redeploy giữ nguyên cả lần trả thừa
	w = httptest.NewRecorder()
	h.ServeHTTP(w, authedReq(srv, "GET", "/api/work/vault", nil))
	var vault struct {
		Jobs   []workJob    `json:"jobs"`
		Ledger []workLedger `json:"ledger"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &vault)

	freshSrv := newTestServer(t)
	freshH := freshSrv.Handler()
	w = httptest.NewRecorder()
	freshH.ServeHTTP(w, authedReq(freshSrv, "POST", "/api/work/vault", map[string]any{
		"mode":   "merge",
		"jobs":   vault.Jobs,
		"ledger": vault.Ledger,
	}))
	if w.Code != 200 {
		t.Fatalf("expected 200 vault sync, got %d: %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	freshH.ServeHTTP(w, authedReq(freshSrv, "GET", "/api/work?date="+today, nil))
	_ = json.Unmarshal(w.Body.Bytes(), &workResp)
	if len(workResp.Ledger) != 1 || len(workResp.Ledger[0].Repayments) != 3 || workResp.Ledger[0].RemainingAmount != 0 || workResp.Ledger[0].PaidAmount != 2300000 {
		t.Fatalf("expected over-repayments preserved after vault sync, got %+v", workResp.Ledger)
	}

	// 7. Xoá lần trả thừa trên server gốc -> số tiền nợ khôi phục đúng 1.200.000đ
	w = httptest.NewRecorder()
	h.ServeHTTP(w, authedReq(srv, "DELETE", "/api/work/repayment/"+strconvItoa64(overResp.RepaymentID), nil))
	if w.Code != 200 {
		t.Fatalf("expected 200 delete repayment, got %d: %s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, authedReq(srv, "GET", "/api/work?date="+today, nil))
	_ = json.Unmarshal(w.Body.Bytes(), &workResp)
	if workResp.Ledger[0].RemainingAmount != 1200000 || len(workResp.Ledger[0].Repayments) != 2 {
		t.Fatalf("expected remaining 1200000 and 2 repayments after delete, got %+v", workResp.Ledger[0])
	}

	// 8. Xoá hoàn toàn khoản mượn bất cứ lúc nào -> cascade xoá luôn lịch sử trả tiền
	w = httptest.NewRecorder()
	h.ServeHTTP(w, authedReq(srv, "DELETE", "/api/work/ledger/"+strconvItoa64(createResp.ID), nil))
	if w.Code != 200 {
		t.Fatalf("expected 200 delete borrow, got %d: %s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, authedReq(srv, "GET", "/api/work?date="+today, nil))
	_ = json.Unmarshal(w.Body.Bytes(), &workResp)
	if len(workResp.Ledger) != 0 {
		t.Fatalf("expected empty ledger after borrow deletion, got %+v", workResp.Ledger)
	}
}

func strconvItoa64(v int64) string {
	return strings.TrimSpace(jsonNumber(v))
}

func jsonNumber(v int64) string {
	b, _ := json.Marshal(v)
	return string(b)
}


