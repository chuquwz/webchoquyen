package app

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Config là cấu hình chạy server (đọc từ biến môi trường ở main).
type Config struct {
	Pin          string // APP_PIN: mã đăng nhập duy nhất
	SessionKey   string // SESSION_SECRET (tuỳ chọn); mặc định suy ra từ PIN
	TickToken    string // TICK_TOKEN cho cron ngoài gọi /api/tick
	VapidSubject string // VAPID_SUBJECT: mailto:... hoặc https://...
}

// Server giữ trạng thái ứng dụng.
type Server struct {
	cfg    Config
	db     *sql.DB
	loc    *time.Location
	static fs.FS
	secret []byte
	mux    *http.ServeMux
	assets *assetStore
	now    func() time.Time

	failMu   sync.Mutex
	failures []time.Time

	healthRev atomic.Int64
	workRev   atomic.Int64
	uidSeq    atomic.Int64

	tokQuyen      string
	tokDev        string
	tokQuyenBytes []byte
	tokDevBytes   []byte

	dbIDOnce sync.Once
	dbID     string
}

// Việt Nam không có giờ mùa hè nên dùng múi giờ cố định UTC+7.
var vnLoc = time.FixedZone("ICT", 7*3600)

// New tạo server.
func New(cfg Config, db *sql.DB, static fs.FS) (*Server, error) {
	if cfg.Pin == "" {
		return nil, errors.New("thiếu APP_PIN")
	}
	key := cfg.SessionKey
	if key == "" {
		key = "qh|" + cfg.Pin
	}
	sum := sha256.Sum256([]byte(key))
	s := &Server{cfg: cfg, db: db, loc: vnLoc, static: static, secret: sum[:], now: time.Now}
	s.tokQuyen = computeSessionToken(s.secret, "quyen")
	s.tokDev = computeSessionToken(s.secret, "dev")
	s.tokQuyenBytes = []byte(s.tokQuyen)
	s.tokDevBytes = []byte(s.tokDev)
	bootRev := time.Now().UnixMilli()
	s.healthRev.Store(bootRev)
	s.workRev.Store(bootRev)
	var err error
	if s.assets, err = newAssetStore(static); err != nil {
		return nil, err
	}
	s.routes()
	return s, nil
}

func (s *Server) bumpHealthRev() int64 { return s.healthRev.Add(1) }
func (s *Server) bumpWorkRev() int64   { return s.workRev.Add(1) }
func (s *Server) nextUID(prefix string) string {
	return fmt.Sprintf("%s_%d_%d", prefix, s.now().UnixMilli(), s.uidSeq.Add(1))
}

func (s *Server) handleSyncState(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{
		"ok":         true,
		"db_id":      s.dbInstanceID(),
		"health_rev": s.healthRev.Load(),
		"work_rev":   s.workRev.Load(),
		"today":      s.today(),
		"now":        s.now().Unix(),
	})
}

// Handler trả về http.Handler gốc.
func (s *Server) Handler() http.Handler { return s.mux }

func (s *Server) today() string { return s.now().In(s.loc).Format("2006-01-02") }

func (s *Server) dateOf(ts int64) string { return time.Unix(ts, 0).In(s.loc).Format("2006-01-02") }

// ---------- tiện ích HTTP ----------

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func httpErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		httpErr(w, http.StatusBadRequest, "dữ liệu không hợp lệ")
		return false
	}
	return true
}

func serverErr(w http.ResponseWriter, err error) {
	log.Printf("lỗi: %v", err)
	httpErr(w, http.StatusInternalServerError, "lỗi máy chủ")
}

func queryInt(r *http.Request, key string, def, min, max int) int {
	n, err := strconv.Atoi(r.URL.Query().Get(key))
	if err != nil {
		return def
	}
	if n < min {
		return min
	}
	if n > max {
		return max
	}
	return n
}

// validDate kiểm tra chuỗi ngày YYYY-MM-DD.
func validDate(d string) bool {
	_, err := time.Parse("2006-01-02", d)
	return err == nil
}

func addDays(date string, n int) string {
	t, _ := time.Parse("2006-01-02", date)
	return t.AddDate(0, 0, n).Format("2006-01-02")
}

// ---------- xác thực ----------

func computeSessionToken(secret []byte, user string) string {
	m := hmac.New(sha256.New, secret)
	if user == "dev" {
		m.Write([]byte("session-dev-v1"))
	} else {
		m.Write([]byte("session-v1"))
	}
	return hex.EncodeToString(m.Sum(nil))
}

func (s *Server) sessionTokenFor(user string) string {
	if user == "dev" {
		return s.tokDev
	}
	return s.tokQuyen
}

func (s *Server) sessionToken() string {
	return s.tokQuyen
}

func (s *Server) currentUser(r *http.Request) string {
	c, err := r.Cookie("qh")
	if err != nil || c.Value == "" {
		return ""
	}
	val := []byte(c.Value)
	if subtle.ConstantTimeCompare(val, s.tokQuyenBytes) == 1 {
		return "quyen"
	}
	if subtle.ConstantTimeCompare(val, s.tokDevBytes) == 1 {
		return "dev"
	}
	return ""
}

func (s *Server) authed(r *http.Request) bool {
	return s.currentUser(r) != ""
}

func isHTTPS(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

func (s *Server) tooManyFailures() bool {
	s.failMu.Lock()
	defer s.failMu.Unlock()
	cut := s.now().Add(-time.Minute)
	kept := s.failures[:0]
	for _, t := range s.failures {
		if t.After(cut) {
			kept = append(kept, t)
		}
	}
	s.failures = kept
	return len(s.failures) >= 5
}

func (s *Server) noteFailure() {
	s.failMu.Lock()
	s.failures = append(s.failures, s.now())
	s.failMu.Unlock()
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if s.tooManyFailures() {
		httpErr(w, http.StatusTooManyRequests, "Nhập sai quá nhiều lần, thử lại sau 1 phút")
		return
	}
	var in struct {
		Pin string `json:"pin"`
	}
	if !readJSON(w, r, &in) {
		return
	}

	user := ""
	if subtle.ConstantTimeCompare([]byte(in.Pin), []byte("1407")) == 1 {
		user = "dev"
	} else if subtle.ConstantTimeCompare([]byte(in.Pin), []byte("0312")) == 1 ||
		(s.cfg.Pin != "" && subtle.ConstantTimeCompare([]byte(in.Pin), []byte(s.cfg.Pin)) == 1) {
		user = "quyen"
	}

	if user == "" {
		s.noteFailure()
		httpErr(w, http.StatusUnauthorized, "Sai mã PIN")
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "qh",
		Value:    s.sessionTokenFor(user),
		Path:     "/",
		HttpOnly: true,
		Secure:   isHTTPS(r),
		SameSite: http.SameSiteStrictMode,
		MaxAge:   365 * 24 * 3600,
	})
	writeJSON(w, 200, map[string]any{"ok": true, "user": user})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: "qh", Value: "", Path: "/", HttpOnly: true, MaxAge: -1})
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) auth(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.authed(r) {
			httpErr(w, http.StatusUnauthorized, "chưa đăng nhập")
			return
		}
		h(w, r)
	}
}

func (s *Server) authWrite(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := s.currentUser(r)
		if user == "" {
			httpErr(w, http.StatusUnauthorized, "chưa đăng nhập")
			return
		}
		if user != "quyen" {
			httpErr(w, http.StatusForbidden, "Tài khoản Tùng Beng chỉ có quyền xem, không thể thao tác")
			return
		}
		h(w, r)
	}
}

// ---------- routing ----------

func (s *Server) routes() {
	m := http.NewServeMux()
	m.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("ok"))
	})
	m.HandleFunc("POST /api/login", s.handleLogin)
	m.HandleFunc("POST /api/logout", s.handleLogout)
	m.HandleFunc("GET /api/tick", s.handleTick) // dùng TICK_TOKEN, không cần cookie
	m.HandleFunc("POST /api/tick", s.handleTick)

	a := s.auth
	wAuth := s.authWrite
	m.HandleFunc("GET /api/me", a(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true, "user": s.currentUser(r)})
	}))
	m.HandleFunc("GET /api/sync/state", a(s.handleSyncState))
	m.HandleFunc("GET /api/today", a(s.handleToday))
	m.HandleFunc("GET /api/settings", a(s.handleGetSettings))
	m.HandleFunc("PUT /api/settings", wAuth(s.handlePutSettings))
	m.HandleFunc("POST /api/water", wAuth(s.handleAddWater))
	m.HandleFunc("DELETE /api/water/{id}", wAuth(s.handleDelWater))
	m.HandleFunc("POST /api/weight", wAuth(s.handlePostWeight))
	m.HandleFunc("PUT /api/med", wAuth(s.handlePutMed))
	m.HandleFunc("GET /api/med", a(s.handleGetMed))
	m.HandleFunc("POST /api/meals/check", wAuth(s.handleCheckMeal))
	m.HandleFunc("GET /api/backup", wAuth(s.handleBackup))
	m.HandleFunc("POST /api/restore", wAuth(s.handleRestore))
	m.HandleFunc("GET /api/push/key", a(s.handlePushKey))
	m.HandleFunc("POST /api/push/subscribe", wAuth(s.handlePushSubscribe))
	m.HandleFunc("POST /api/push/test", wAuth(s.handlePushTest))
	m.HandleFunc("GET /api/work", a(s.handleGetWork))
	m.HandleFunc("GET /api/work/vault", a(s.handleGetWorkVault))
	m.HandleFunc("POST /api/work/vault", wAuth(s.handleSyncWorkVault))
	m.HandleFunc("POST /api/work/job", wAuth(s.handlePostWorkJob))
	m.HandleFunc("PUT /api/work/job/{id}", wAuth(s.handlePutWorkJob))
	m.HandleFunc("POST /api/work/job/{id}/pay", wAuth(s.handlePayWorkJob))
	m.HandleFunc("DELETE /api/work/job/{id}", wAuth(s.handleDelWorkJob))
	m.HandleFunc("DELETE /api/work/job-payment/{id}", wAuth(s.handleDelWorkJobPayment))
	m.HandleFunc("POST /api/work/job/pay-customer", wAuth(s.handlePayCustomerJobs))
	m.HandleFunc("POST /api/work/ledger", wAuth(s.handlePostWorkLedger))
	m.HandleFunc("POST /api/work/ledger/{id}/repay", wAuth(s.handleRepayWorkLedger))
	m.HandleFunc("DELETE /api/work/ledger/{id}", wAuth(s.handleDelWorkLedger))
	m.HandleFunc("DELETE /api/work/repayment/{id}", wAuth(s.handleDelWorkLedgerRepayment))
	m.HandleFunc("GET /api/work/export", wAuth(s.handleExportWorkCSV))
	m.HandleFunc("/", s.assets.serve)
	s.mux = m
}

// Run chạy bộ lập lịch nhắc nhở cho tới khi ctx kết thúc.
func (s *Server) Run(ctx context.Context) {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.tick(s.now())
		}
	}
}

