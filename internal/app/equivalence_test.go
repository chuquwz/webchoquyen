package app

// Golden-master test: chụp toàn bộ đầu ra HTTP (status, header, body) của mọi endpoint
// và mọi file tĩnh, để đảm bảo các tối ưu hiệu năng KHÔNG làm đổi hành vi.
//
// Chụp lại snapshot (chỉ làm trên code gốc / khi cố ý đổi hành vi):
//   GOLDEN_UPDATE=1 go test ./internal/app -run Golden

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"quyenhealth/web"
)

var goldenUpdate = os.Getenv("GOLDEN_UPDATE") == "1"

type goldenResult struct {
	Name   string            `json:"name"`
	Status int               `json:"status"`
	Header map[string]string `json:"header"`
	Body   json.RawMessage   `json:"body,omitempty"`
	Text   string            `json:"text,omitempty"`
}

type goldenStep struct {
	name   string
	at     string // "2006-01-02 15:04" giờ VN
	method string
	path   string
	body   any
	bodyFn func(prev map[string][]byte) any
	auth   string // "", "quyen", "dev"
	header map[string]string
}

func headerMap(h http.Header) map[string]string {
	out := map[string]string{}
	for k, v := range h {
		out[k] = strings.Join(v, "\n")
	}
	return out
}

func compareGolden(t *testing.T, file string, got []goldenResult, normalize func(goldenResult) goldenResult) {
	t.Helper()
	p := filepath.Join("testdata", file)
	if goldenUpdate {
		if err := os.MkdirAll("testdata", 0o755); err != nil {
			t.Fatal(err)
		}
		b, _ := json.MarshalIndent(got, "", "  ")
		if err := os.WriteFile(p, b, 0o644); err != nil {
			t.Fatal(err)
		}
		t.Logf("đã ghi golden %s (%d mục)", p, len(got))
		return
	}
	raw, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("thiếu golden %s (chạy GOLDEN_UPDATE=1 trên code gốc): %v", p, err)
	}
	var want []goldenResult
	if err := json.Unmarshal(raw, &want); err != nil {
		t.Fatal(err)
	}
	if normalize == nil {
		normalize = func(r goldenResult) goldenResult { return r }
	}
	if len(want) != len(got) {
		t.Fatalf("số mục khác nhau: golden=%d hiện tại=%d", len(want), len(got))
	}
	fails := 0
	for i := range want {
		a, _ := json.Marshal(normalize(want[i]))
		b, _ := json.Marshal(normalize(got[i]))
		if !bytes.Equal(a, b) {
			fails++
			t.Errorf("KHÁC golden tại [%d] %s\n  golden : %s\n  hiện tại: %s", i, want[i].Name, a, b)
			if fails > 5 {
				t.FailNow()
			}
		}
	}
}

// ---------- API ----------

func newGoldenServer(t *testing.T) (*Server, *time.Time) {
	t.Helper()
	db, err := OpenDB(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	for k, v := range map[string]string{"_db_instance_id": "db_golden", "_vapid_priv": "priv-golden", "_vapid_pub": "pub-golden"} {
		if _, err := db.Exec(`INSERT INTO settings(key,value) VALUES(?,?)`, k, v); err != nil {
			t.Fatal(err)
		}
	}
	static := fstest.MapFS{
		"index.html": {Data: []byte("<html></html>")},
		"style.css":  {Data: []byte("body{}")},
		"app.js":     {Data: []byte("")},
		"sw.js":      {Data: []byte("")},
	}
	srv, err := New(Config{Pin: "246810"}, db, static)
	if err != nil {
		t.Fatal(err)
	}
	clock := new(time.Time)
	srv.now = func() time.Time { return *clock }
	srv.healthRev.Store(1000)
	srv.workRev.Store(1000)
	return srv, clock
}

func runGoldenSteps(t *testing.T, srv *Server, clock *time.Time, steps []goldenStep) []goldenResult {
	t.Helper()
	h := srv.Handler()
	prev := map[string][]byte{}
	var out []goldenResult
	for _, st := range steps {
		tm, err := time.ParseInLocation("2006-01-02 15:04", st.at, vnLoc)
		if err != nil {
			t.Fatalf("%s: %v", st.name, err)
		}
		*clock = tm
		body := st.body
		if st.bodyFn != nil {
			body = st.bodyFn(prev)
		}
		var buf bytes.Buffer
		if body != nil {
			if s, ok := body.(string); ok {
				buf.WriteString(s)
			} else {
				_ = json.NewEncoder(&buf).Encode(body)
			}
		}
		req := httptest.NewRequest(st.method, st.path, &buf)
		req.Header.Set("Content-Type", "application/json")
		for k, v := range st.header {
			req.Header.Set(k, v)
		}
		if st.auth != "" {
			req.AddCookie(&http.Cookie{Name: "qh", Value: srv.sessionTokenFor(st.auth)})
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		res := goldenResult{Name: st.name, Status: w.Code, Header: headerMap(w.Header())}
		b := w.Body.Bytes()
		prev[st.name] = append([]byte(nil), b...)
		var cb bytes.Buffer
		if strings.HasPrefix(w.Header().Get("Content-Type"), "application/json") && json.Compact(&cb, b) == nil {
			res.Body = cb.Bytes()
		} else {
			res.Text = string(b)
		}
		out = append(out, res)
	}
	return out
}

func goldenAPISteps() []goldenStep {
	const d0 = "2026-03-15"
	const prevMonthDay = "2026-02-20"
	T := func(s string) int64 {
		tm, _ := time.ParseInLocation("2006-01-02 15:04", s, vnLoc)
		return tm.Unix()
	}
	A := "quyen"
	steps := []goldenStep{
		{name: "healthz", at: d0 + " 06:00", method: "GET", path: "/healthz"},
		{name: "me-unauth", at: d0 + " 06:00", method: "GET", path: "/api/me"},
		{name: "login-wrong", at: d0 + " 06:00", method: "POST", path: "/api/login", body: map[string]string{"pin": "0000"}},
		{name: "login-bad-json", at: d0 + " 06:00", method: "POST", path: "/api/login", body: "{not json"},
		{name: "login-ok", at: d0 + " 06:00", method: "POST", path: "/api/login", body: map[string]string{"pin": "0312"}},
		{name: "login-env-pin-https", at: d0 + " 06:00", method: "POST", path: "/api/login", body: map[string]string{"pin": "246810"}, header: map[string]string{"X-Forwarded-Proto": "https"}},
		{name: "login-dev", at: d0 + " 06:00", method: "POST", path: "/api/login", body: map[string]string{"pin": "1407"}},
		{name: "me", at: d0 + " 06:00", method: "GET", path: "/api/me", auth: A},
		{name: "me-dev", at: d0 + " 06:00", method: "GET", path: "/api/me", auth: "dev"},
		{name: "bad-cookie", at: d0 + " 06:00", method: "GET", path: "/api/today", header: map[string]string{"Cookie": "qh=deadbeef"}},
		{name: "sync-state", at: d0 + " 06:01", method: "GET", path: "/api/sync/state", auth: A},
		{name: "settings-get", at: d0 + " 06:01", method: "GET", path: "/api/settings", auth: A},
		{name: "settings-put", at: d0 + " 06:02", method: "PUT", path: "/api/settings", auth: A, body: map[string]string{"name": "Quyền A", "water_min": "2600", "remind_water_times": "09:00, 13:00,16:00,19:30", "unknown": "x"}},
		{name: "settings-put-bad-name", at: d0 + " 06:02", method: "PUT", path: "/api/settings", auth: A, body: map[string]string{"name": ""}},
		{name: "settings-put-bad-hm", at: d0 + " 06:02", method: "PUT", path: "/api/settings", auth: A, body: map[string]string{"remind_med_times": "25:00"}},
		{name: "settings-put-bad-num", at: d0 + " 06:02", method: "PUT", path: "/api/settings", auth: A, body: map[string]string{"height": "-3"}},

		{name: "tick-0635", at: d0 + " 06:35", method: "GET", path: "/api/tick"},
		{name: "water-add", at: d0 + " 07:00", method: "POST", path: "/api/water", auth: A, body: map[string]any{"ml": 300, "cid": "c1"}},
		{name: "water-add-dup", at: d0 + " 07:01", method: "POST", path: "/api/water", auth: A, body: map[string]any{"ml": 300, "cid": "c1"}},
		{name: "water-add-offline-ts", at: d0 + " 07:02", method: "POST", path: "/api/water", auth: A, body: map[string]any{"ml": 500, "cid": "c2", "ts": T(d0 + " 06:50")}},
		{name: "water-add-3", at: d0 + " 07:03", method: "POST", path: "/api/water", auth: A, body: map[string]any{"ml": 250}},
		{name: "water-add-bad", at: d0 + " 07:03", method: "POST", path: "/api/water", auth: A, body: map[string]any{"ml": 0}},
		{name: "water-del", at: d0 + " 07:04", method: "DELETE", path: "/api/water/3", auth: A},
		{name: "water-del-bad", at: d0 + " 07:04", method: "DELETE", path: "/api/water/abc", auth: A},

		{name: "weight-today", at: d0 + " 07:06", method: "POST", path: "/api/weight", auth: A, body: map[string]any{"kg": 95.8}},
		{name: "weight-bad", at: d0 + " 07:06", method: "POST", path: "/api/weight", auth: A, body: map[string]any{"kg": 20}},

		{name: "med-doses", at: d0 + " 08:10", method: "PUT", path: "/api/med", auth: A, body: map[string]any{"doses": []bool{true, false, true, true}}},
		{name: "med-get", at: d0 + " 08:11", method: "GET", path: "/api/med", auth: A},
		{name: "med-count", at: d0 + " 08:12", method: "PUT", path: "/api/med", auth: A, body: map[string]any{"taken_count": 1}},
		{name: "med-taken", at: d0 + " 08:13", method: "PUT", path: "/api/med", auth: A, body: map[string]any{"taken": true}},
		{name: "med-reset", at: d0 + " 08:14", method: "PUT", path: "/api/med", auth: A, body: map[string]any{"taken_count": 1}},

		{name: "meals-check-done", at: d0 + " 08:34", method: "POST", path: "/api/meals/check", auth: A, body: map[string]any{"slot": "breakfast", "status": "done"}},
		{name: "meals-check-bad", at: d0 + " 08:35", method: "POST", path: "/api/meals/check", auth: A, body: map[string]any{"slot": "dinner", "status": "eaten"}},
		{name: "today", at: d0 + " 08:40", method: "GET", path: "/api/today", auth: A},

		// ---------- công việc ----------
		{name: "job-1", at: d0 + " 09:00", method: "POST", path: "/api/work/job", auth: A, body: map[string]any{"date": d0, "customer": "Lý Tuấn", "channel": "zl", "service": "BYPASS MDM X4", "price": 200, "status": "TT"}},
		{name: "job-2", at: d0 + " 09:01", method: "POST", path: "/api/work/job", auth: A, body: map[string]any{"date": d0, "customer": "Điện Thoại Nguyên Trường", "channel": "ZL", "service": "FIX VOLTE OPPO A55S 5G", "price": 80000, "status": "CTT"}},
		{name: "job-3-prev-month", at: d0 + " 09:02", method: "POST", path: "/api/work/job", auth: A, body: map[string]any{"uid": "job_uid_3", "date": prevMonthDay, "customer": "Bh Mobile", "channel": "FB", "service": "FRP SS", "price": 150, "status": "CTT", "note": "nợ cũ"}},
		{name: "job-4", at: d0 + " 09:03", method: "POST", path: "/api/work/job", auth: A, body: map[string]any{"date": d0, "customer": " bh mobile ", "channel": "FB", "service": "HIDE", "price": 350000, "status": "CTT"}},
		{name: "job-5-other-day", at: d0 + " 09:04", method: "POST", path: "/api/work/job", auth: A, body: map[string]any{"date": "2026-03-14", "customer": "Táo Service", "channel": "KHAC", "service": "OFF MI CLOUD", "price": 250000, "status": "TT"}},
		{name: "job-bad", at: d0 + " 09:04", method: "POST", path: "/api/work/job", auth: A, body: map[string]any{"date": d0, "customer": "", "service": "X", "price": 100}},
		{name: "job-put", at: d0 + " 09:05", method: "PUT", path: "/api/work/job/1", auth: A, body: map[string]any{"note": "khách quen", "price": 220000}},
		{name: "job-put-404", at: d0 + " 09:05", method: "PUT", path: "/api/work/job/999", auth: A, body: map[string]any{"note": "x"}},
		{name: "job-pay-3a", at: d0 + " 09:06", method: "POST", path: "/api/work/job/3/pay", auth: A, body: map[string]any{"date": d0, "amount": 50, "note": "đợt 1"}},
		{name: "job-pay-4a", at: d0 + " 09:07", method: "POST", path: "/api/work/job/4/pay", auth: A, body: map[string]any{"uid": "pay_uid_4a", "date": d0, "amount": 100000}},
		{name: "job-pay-3b", at: d0 + " 09:08", method: "POST", path: "/api/work/job/3/pay", auth: A, body: map[string]any{"date": d0, "amount": 100, "note": "đợt 2"}},
		{name: "job-pay-bad", at: d0 + " 09:08", method: "POST", path: "/api/work/job/2/pay", auth: A, body: map[string]any{"date": d0, "amount": 0}},
		{name: "ledger-expense", at: d0 + " 09:10", method: "POST", path: "/api/work/ledger", auth: A, body: map[string]any{"date": d0, "category": "expense", "amount": 10, "note": "Thuê tools"}},
		{name: "ledger-fund-in", at: d0 + " 09:11", method: "POST", path: "/api/work/ledger", auth: A, body: map[string]any{"date": d0, "category": "fund_in", "amount": 155000, "note": "Nộp quỹ ngày"}},
		{name: "ledger-fund-bal-1", at: d0 + " 09:12", method: "POST", path: "/api/work/ledger", auth: A, body: map[string]any{"date": d0, "category": "fund_bal", "amount": 2000000}},
		{name: "ledger-fund-bal-2", at: d0 + " 09:13", method: "POST", path: "/api/work/ledger", auth: A, body: map[string]any{"date": d0, "category": "fund_bal", "amount": 1500000}},
		{name: "ledger-borrow-prev", at: d0 + " 09:14", method: "POST", path: "/api/work/ledger", auth: A, body: map[string]any{"uid": "ldg_uid_borrow", "date": "2026-02-25", "category": "borrow", "amount": 1000, "note": "Mượn mua máy"}},
		{name: "ledger-borrow-today", at: d0 + " 09:15", method: "POST", path: "/api/work/ledger", auth: A, body: map[string]any{"date": d0, "category": "borrow", "amount": 300000, "note": "Mượn tiền ăn"}},
		{name: "ledger-repay", at: d0 + " 09:16", method: "POST", path: "/api/work/ledger", auth: A, body: map[string]any{"date": d0, "category": "repay", "amount": 50, "note": "Trả nợ cũ"}},
		{name: "ledger-bad", at: d0 + " 09:16", method: "POST", path: "/api/work/ledger", auth: A, body: map[string]any{"date": d0, "category": "gift", "amount": 50}},
		{name: "ledger-repay-5a", at: d0 + " 09:17", method: "POST", path: "/api/work/ledger/5/repay", auth: A, body: map[string]any{"date": d0, "amount": 300, "note": "trả đợt 1"}},
		{name: "ledger-repay-5b", at: d0 + " 09:18", method: "POST", path: "/api/work/ledger/5/repay", auth: A, body: map[string]any{"uid": "rep_uid_5b", "date": d0, "amount": 200}},
		{name: "ledger-repay-6", at: d0 + " 09:19", method: "POST", path: "/api/work/ledger/6/repay", auth: A, body: map[string]any{"date": d0, "amount": 300000}},
		{name: "ledger-repay-non-borrow", at: d0 + " 09:19", method: "POST", path: "/api/work/ledger/1/repay", auth: A, body: map[string]any{"date": d0, "amount": 1000}},

		{name: "work-today", at: d0 + " 09:20", method: "GET", path: "/api/work?date=" + d0, auth: A},
		{name: "work-default", at: d0 + " 09:20", method: "GET", path: "/api/work", auth: A},
		{name: "work-prev-month", at: d0 + " 09:20", method: "GET", path: "/api/work?date=" + prevMonthDay + "&month=2026-02", auth: A},
		{name: "work-other-month", at: d0 + " 09:20", method: "GET", path: "/api/work?date=" + d0 + "&month=2026-02", auth: A},
		{name: "work-bad-month", at: d0 + " 09:20", method: "GET", path: "/api/work?date=bad&month=2026-13", auth: A},
		{name: "export-mar", at: d0 + " 09:21", method: "GET", path: "/api/work/export?month=2026-03", auth: A},
		{name: "export-feb", at: d0 + " 09:21", method: "GET", path: "/api/work/export?month=2026-02", auth: A},
		{name: "export-default", at: d0 + " 09:21", method: "GET", path: "/api/work/export", auth: A},

		{name: "pay-customer", at: d0 + " 09:30", method: "POST", path: "/api/work/job/pay-customer", auth: A, body: map[string]string{"customer": "Điện Thoại Nguyên Trường"}},
		{name: "pay-customer-none", at: d0 + " 09:30", method: "POST", path: "/api/work/job/pay-customer", auth: A, body: map[string]string{"customer": "Không Có"}},
		{name: "work-after-pay", at: d0 + " 09:31", method: "GET", path: "/api/work?date=" + d0, auth: A},
		{name: "del-job-payment", at: d0 + " 09:32", method: "DELETE", path: "/api/work/job-payment/2", auth: A},
		{name: "del-repayment", at: d0 + " 09:33", method: "DELETE", path: "/api/work/repayment/1", auth: A},
		{name: "del-job", at: d0 + " 09:34", method: "DELETE", path: "/api/work/job/1", auth: A},
		{name: "del-ledger", at: d0 + " 09:35", method: "DELETE", path: "/api/work/ledger/1", auth: A},
		{name: "del-job-404", at: d0 + " 09:35", method: "DELETE", path: "/api/work/job/999", auth: A},
		{name: "work-after-del", at: d0 + " 09:36", method: "GET", path: "/api/work?date=" + d0, auth: A},
		{name: "vault-get", at: d0 + " 09:37", method: "GET", path: "/api/work/vault", auth: A},
		{name: "vault-merge", at: d0 + " 09:40", method: "POST", path: "/api/work/vault", auth: A, bodyFn: func(prev map[string][]byte) any {
			var v struct {
				Jobs   []map[string]any `json:"jobs"`
				Ledger []map[string]any `json:"ledger"`
			}
			_ = json.Unmarshal(prev["vault-get"], &v)
			if len(v.Jobs) > 0 {
				v.Jobs[0]["note"] = "sửa từ máy khác"
				v.Jobs[0]["updated_at"] = T(d0 + " 09:39")
			}
			if len(v.Ledger) > 1 {
				v.Ledger[1]["note"] = "cũ hơn, không được ghi đè"
				v.Ledger[1]["updated_at"] = 1
			}
			v.Jobs = append(v.Jobs, map[string]any{
				"uid": "ext_job_1", "date": "2026-03-13", "customer": "Khách Mới", "channel": "FB", "service": "FRP SS",
				"price": 100, "status": "CTT", "ts": T(d0 + " 09:38"), "updated_at": T(d0 + " 09:38"),
				"payments": []map[string]any{{"uid": "ext_pay_1", "date": "2026-03-14", "amount": 40, "note": "đợt 1", "ts": T(d0 + " 09:38")}},
			}, map[string]any{
				"uid": "ghost_job", "date": "2026-03-12", "customer": "Ma", "channel": "ZL", "service": "X", "price": 5000, "status": "TT", "ts": T(d0 + " 09:00"),
			}, map[string]any{
				"date": "2026-03-11", "customer": "Không UID", "service": "BYPASS", "price": 70, "ts": T(d0 + " 09:01"),
			})
			v.Ledger = append(v.Ledger, map[string]any{
				"uid": "ext_ldg_1", "date": "2026-03-13", "category": "borrow", "amount": 500, "note": "Mượn anh B", "ts": T(d0 + " 09:38"),
				"repayments": []map[string]any{{"uid": "ext_rep_1", "date": "2026-03-14", "amount": 200, "ts": T(d0 + " 09:38")}},
			})
			return map[string]any{"mode": "merge", "jobs": v.Jobs, "ledger": v.Ledger, "tombstones": []map[string]any{
				{"uid": "ghost_job", "kind": "job", "deleted_at": T(d0 + " 09:39")},
				{"uid": "sig:ledger:abc", "kind": "ledger", "sig": "2026-03-01|expense|5000|x|123", "deleted_at": T(d0 + " 09:39")},
				{"uid": "x", "kind": "invalid", "deleted_at": T(d0 + " 09:39")},
			}}
		}},
		{name: "vault-merge-again", at: d0 + " 09:41", method: "POST", path: "/api/work/vault", auth: A, bodyFn: func(prev map[string][]byte) any {
			var v map[string]any
			_ = json.Unmarshal(prev["vault-merge"], &v)
			return map[string]any{"mode": "merge", "jobs": v["jobs"], "ledger": v["ledger"], "tombstones": v["tombstones"]}
		}},
		{name: "job-ghost-repost", at: d0 + " 09:42", method: "POST", path: "/api/work/job", auth: A, body: map[string]any{"uid": "ghost_job", "date": "2026-03-12", "customer": "Ma", "service": "X", "price": 5000}},
		{name: "work-after-merge", at: d0 + " 09:43", method: "GET", path: "/api/work?date=2026-03-14&month=2026-03", auth: A},
		{name: "export-after-merge", at: d0 + " 09:43", method: "GET", path: "/api/work/export?month=2026-03", auth: A},

		{name: "backup", at: d0 + " 10:00", method: "GET", path: "/api/backup", auth: A},
		{name: "push-key", at: d0 + " 10:01", method: "GET", path: "/api/push/key", auth: A},
		{name: "push-sub-bad", at: d0 + " 10:01", method: "POST", path: "/api/push/subscribe", auth: A, body: map[string]any{"endpoint": ""}},
		{name: "push-test", at: d0 + " 10:02", method: "POST", path: "/api/push/test", auth: A},
		{name: "tick-1235", at: d0 + " 12:35", method: "POST", path: "/api/tick"},
		{name: "tick-2005", at: d0 + " 20:05", method: "GET", path: "/api/tick"},
		{name: "tick-2005-again", at: d0 + " 20:06", method: "GET", path: "/api/tick"},
		{name: "tick-2235", at: d0 + " 22:35", method: "GET", path: "/api/tick"},

		{name: "vault-replace", at: d0 + " 23:00", method: "POST", path: "/api/work/vault", auth: A, bodyFn: func(prev map[string][]byte) any {
			var v map[string]any
			_ = json.Unmarshal(prev["vault-get"], &v)
			return map[string]any{"mode": "replace", "jobs": v["jobs"], "ledger": v["ledger"], "tombstones": []map[string]any{
				{"uid": "sig:job:zzz", "kind": "job", "sig": "abc", "deleted_at": T(d0 + " 22:59")},
			}}
		}},
		{name: "work-after-replace", at: d0 + " 23:01", method: "GET", path: "/api/work?date=" + d0, auth: A},

		// ngày hôm sau: dữ liệu sức khoẻ ngày cũ bị dọn
		{name: "today-next-day", at: "2026-03-16 07:00", method: "GET", path: "/api/today", auth: A},
		{name: "restore", at: "2026-03-16 07:05", method: "POST", path: "/api/restore", auth: A, bodyFn: func(prev map[string][]byte) any {
			var v map[string]any
			_ = json.Unmarshal(prev["backup"], &v)
			return v
		}},
		{name: "restore-bad", at: "2026-03-16 07:05", method: "POST", path: "/api/restore", auth: A, body: "[1,2"},
		{name: "today-after-restore", at: "2026-03-16 07:06", method: "GET", path: "/api/today", auth: A},
		{name: "work-after-restore", at: "2026-03-16 07:06", method: "GET", path: "/api/work?date=" + d0, auth: A},
		{name: "backup-after-restore", at: "2026-03-16 07:07", method: "GET", path: "/api/backup", auth: A},
		{name: "settings-after-restore", at: "2026-03-16 07:07", method: "GET", path: "/api/settings", auth: A},
		{name: "logout", at: "2026-03-16 07:08", method: "POST", path: "/api/logout", auth: A},
		{name: "method-not-allowed", at: "2026-03-16 07:08", method: "POST", path: "/index.html"},
		{name: "not-found", at: "2026-03-16 07:08", method: "GET", path: "/khong-co.js"},
	}
	// rate limit: 5 lần sai liên tiếp trong 1 phút
	for i := 0; i < 5; i++ {
		steps = append(steps, goldenStep{name: fmt.Sprintf("login-brute-%d", i), at: "2026-03-16 08:00", method: "POST", path: "/api/login", body: map[string]string{"pin": "9999"}})
	}
	steps = append(steps,
		goldenStep{name: "login-locked", at: "2026-03-16 08:00", method: "POST", path: "/api/login", body: map[string]string{"pin": "0312"}},
		goldenStep{name: "login-unlocked", at: "2026-03-16 08:02", method: "POST", path: "/api/login", body: map[string]string{"pin": "0312"}},
	)
	return steps
}

func TestGoldenAPI(t *testing.T) {
	srv, clock := newGoldenServer(t)
	got := runGoldenSteps(t, srv, clock, goldenAPISteps())
	if goldenUpdate {
		for _, r := range got {
			t.Logf("%-28s %d", r.Name, r.Status)
		}
	}
	compareGolden(t, "golden_api.json", got, nil)
}

// ---------- file tĩnh thật (web.Files nhúng vào binary) ----------

func TestGoldenStatic(t *testing.T) {
	st, err := newAssetStore(web.Files)
	if err != nil {
		t.Fatal(err)
	}
	var files []string
	_ = fs.WalkDir(web.Files, ".", func(p string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() && !strings.HasSuffix(p, ".go") {
			files = append(files, "/"+p)
		}
		return nil
	})
	sort.Strings(files)
	files = append(files, "/", "/khong-co.webp")

	do := func(method, p string, hdr map[string]string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, p, nil)
		for k, v := range hdr {
			req.Header.Set(k, v)
		}
		w := httptest.NewRecorder()
		st.serve(w, req)
		return w
	}
	rec := func(name string, w *httptest.ResponseRecorder) goldenResult {
		body := w.Body.Bytes()
		if len(body) > 0 && w.Header().Get("Content-Encoding") == "gzip" {
			zr, err := gzip.NewReader(bytes.NewReader(body))
			if err != nil {
				t.Fatalf("%s: %v", name, err)
			}
			body, _ = io.ReadAll(zr)
		}
		sum := sha256.Sum256(body)
		return goldenResult{Name: name, Status: w.Code, Header: headerMap(w.Header()),
			Text: fmt.Sprintf("len=%d sha256=%s", len(body), hex.EncodeToString(sum[:]))}
	}
	var got []goldenResult
	for _, p := range files {
		gz := map[string]string{"Accept-Encoding": "gzip, deflate, br"}
		w := do("GET", p, gz)
		got = append(got, rec("GET gzip "+p, w))
		got = append(got, rec("GET identity "+p, do("GET", p, nil)))
		got = append(got, rec("HEAD gzip "+p, do("HEAD", p, gz)))
		if et := w.Header().Get("ETag"); et != "" {
			got = append(got, rec("GET 304 "+p, do("GET", p, map[string]string{"If-None-Match": et, "Accept-Encoding": "gzip"})))
			got = append(got, rec("GET stale-etag "+p, do("GET", p, map[string]string{"If-None-Match": `"cu"`})))
		}
	}
	// Ngoại lệ duy nhất đã được duyệt: ảnh .webp không còn được gzip lại (byte ảnh giải nén vẫn y hệt),
	// nên bỏ qua 3 header tầng truyền tải này cho .webp.
	normalize := func(r goldenResult) goldenResult {
		if path.Ext(r.Name) == ".webp" {
			h := map[string]string{}
			for k, v := range r.Header {
				if k != "Content-Encoding" && k != "Content-Length" && k != "Vary" {
					h[k] = v
				}
			}
			r.Header = h
		}
		return r
	}
	compareGolden(t, "golden_static.json", got, normalize)
}
