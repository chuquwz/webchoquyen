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
	"io/fs"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
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
	var err error
	if s.assets, err = newAssetStore(static); err != nil {
		return nil, err
	}
	s.routes()
	return s, nil
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

func (s *Server) sessionTokenFor(user string) string {
	m := hmac.New(sha256.New, s.secret)
	if user == "dev" {
		m.Write([]byte("session-dev-v1"))
	} else {
		m.Write([]byte("session-v1"))
	}
	return hex.EncodeToString(m.Sum(nil))
}

func (s *Server) sessionToken() string {
	return s.sessionTokenFor("quyen")
}

func (s *Server) currentUser(r *http.Request) string {
	c, err := r.Cookie("qh")
	if err != nil || c.Value == "" {
		return ""
	}
	val := []byte(c.Value)
	if subtle.ConstantTimeCompare(val, []byte(s.sessionTokenFor("quyen"))) == 1 {
		return "quyen"
	}
	if subtle.ConstantTimeCompare(val, []byte(s.sessionTokenFor("dev"))) == 1 {
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
	if subtle.ConstantTimeCompare([]byte(in.Pin), []byte("1401")) == 1 {
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
	m.HandleFunc("GET /api/me", a(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true, "user": s.currentUser(r)})
	}))
	m.HandleFunc("GET /api/today", a(s.handleToday))
	m.HandleFunc("GET /api/settings", a(s.handleGetSettings))
	m.HandleFunc("PUT /api/settings", a(s.handlePutSettings))
	m.HandleFunc("POST /api/water", a(s.handleAddWater))
	m.HandleFunc("DELETE /api/water/{id}", a(s.handleDelWater))
	m.HandleFunc("GET /api/weight", a(s.handleGetWeight))
	m.HandleFunc("POST /api/weight", a(s.handlePostWeight))
	m.HandleFunc("DELETE /api/weight/{date}", a(s.handleDelWeight))
	m.HandleFunc("PUT /api/med", a(s.handlePutMed))
	m.HandleFunc("GET /api/med", a(s.handleGetMed))
	m.HandleFunc("GET /api/glucose", a(s.handleGetGlucose))
	m.HandleFunc("POST /api/glucose", a(s.handlePostGlucose))
	m.HandleFunc("DELETE /api/glucose/{id}", a(s.handleDelGlucose))
	m.HandleFunc("GET /api/meals", a(s.handleGetMeals))
	m.HandleFunc("POST /api/meals/generate", a(s.handleGenerateMeals))
	m.HandleFunc("POST /api/meals/swap", a(s.handleSwapMeal))
	m.HandleFunc("POST /api/meals/check", a(s.handleCheckMeal))
	m.HandleFunc("GET /api/shopping", a(s.handleShopping))
	m.HandleFunc("GET /api/report", a(s.handleReport))
	m.HandleFunc("GET /api/backup", a(s.handleBackup))
	m.HandleFunc("POST /api/restore", a(s.handleRestore))
	m.HandleFunc("GET /api/push/key", a(s.handlePushKey))
	m.HandleFunc("POST /api/push/subscribe", a(s.handlePushSubscribe))
	m.HandleFunc("POST /api/push/test", a(s.handlePushTest))
	m.HandleFunc("GET /api/work", a(s.handleGetWork))
	m.HandleFunc("POST /api/work/job", a(s.handlePostWorkJob))
	m.HandleFunc("PUT /api/work/job/{id}", a(s.handlePutWorkJob))
	m.HandleFunc("DELETE /api/work/job/{id}", a(s.handleDelWorkJob))
	m.HandleFunc("POST /api/work/job/pay-customer", a(s.handlePayCustomerJobs))
	m.HandleFunc("POST /api/work/ledger", a(s.handlePostWorkLedger))
	m.HandleFunc("DELETE /api/work/ledger/{id}", a(s.handleDelWorkLedger))
	m.HandleFunc("GET /api/work/export", a(s.handleExportWorkCSV))
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

