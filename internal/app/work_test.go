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
}

