package app

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"runtime"
	"testing"
	"testing/fstest"
	"time"

	"quyenhealth/web"
)

// TestAssetStoreHeap đo lượng heap thường trực mà asset store chiếm sau khi nạp web.Files.
// Chạy: go test ./internal/app -run AssetStoreHeap -v
func TestAssetStoreHeap(t *testing.T) {
	var before, after runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&before)
	start := time.Now()
	st, err := newAssetStore(web.Files)
	if err != nil {
		t.Fatal(err)
	}
	elapsed := time.Since(start)
	runtime.GC()
	runtime.ReadMemStats(&after)
	t.Logf("asset store: heap thường trực = %.2f MB, tổng cấp phát khi nạp = %.2f MB, thời gian nạp = %v, số file = %d",
		float64(int64(after.HeapAlloc)-int64(before.HeapAlloc))/1e6,
		float64(after.TotalAlloc-before.TotalAlloc)/1e6, elapsed, len(st.m))
	runtime.KeepAlive(st)
}

// BenchmarkHandleGetWork đo tốc độ và cấp phát RAM của GET /api/work với ~100 đơn + ~50 sổ thu chi trải 3 tháng.
func BenchmarkHandleGetWork(b *testing.B) {
	db, err := OpenDB(b.TempDir())
	if err != nil {
		b.Fatal(err)
	}
	defer db.Close()

	static := fstest.MapFS{
		"index.html": {Data: []byte("<html></html>")},
	}
	srv, err := New(Config{Pin: "0312"}, db, static)
	if err != nil {
		b.Fatal(err)
	}
	h := srv.Handler()
	cookie := &http.Cookie{Name: "qh", Value: srv.sessionToken()}

	months := []string{"2026-01", "2026-02", "2026-03"}
	for i := 0; i < 100; i++ {
		m := months[i%3]
		d := fmt.Sprintf("%s-%02d", m, (i%28)+1)
		st := "TT"
		if i%3 == 0 {
			st = "CTT"
		}
		res, err := db.Exec(
			`INSERT INTO work_jobs(uid,date,customer,channel,service,price,status,note,ts,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
			fmt.Sprintf("bench_job_%d", i), d, fmt.Sprintf("Khách %d", i%15), "ZL", "BYPASS MDM", 200000, st, "", 1700000000+int64(i), 1700000000+int64(i),
		)
		if err != nil {
			b.Fatal(err)
		}
		if st == "CTT" && i%2 == 0 {
			jid, _ := res.LastInsertId()
			if _, err := db.Exec(
				`INSERT INTO work_job_payments(uid,job_id,date,amount,note,ts) VALUES(?,?,?,?,?,?)`,
				fmt.Sprintf("bench_pay_%d", i), jid, d, 50000, "đợt 1", 1700000000+int64(i),
			); err != nil {
				b.Fatal(err)
			}
		}
	}
	cats := []string{"expense", "fund_in", "borrow", "repay", "fund_bal"}
	for i := 0; i < 50; i++ {
		m := months[i%3]
		d := fmt.Sprintf("%s-%02d", m, (i%28)+1)
		cat := cats[i%len(cats)]
		res, err := db.Exec(
			`INSERT INTO work_ledger(uid,date,category,amount,note,ts,updated_at) VALUES(?,?,?,?,?,?,?)`,
			fmt.Sprintf("bench_ldg_%d", i), d, cat, 300000, "ghi chú", 1700000000+int64(i), 1700000000+int64(i),
		)
		if err != nil {
			b.Fatal(err)
		}
		if cat == "borrow" {
			lid, _ := res.LastInsertId()
			if _, err := db.Exec(
				`INSERT INTO work_ledger_repayments(uid,ledger_id,date,amount,note,ts) VALUES(?,?,?,?,?,?)`,
				fmt.Sprintf("bench_rep_%d", i), lid, d, 100000, "trả đợt 1", 1700000000+int64(i),
			); err != nil {
				b.Fatal(err)
			}
		}
	}

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest("GET", "/api/work?date=2026-03-15&month=2026-03", nil)
		req.AddCookie(cookie)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != 200 {
			b.Fatalf("status %d", w.Code)
		}
	}
}
