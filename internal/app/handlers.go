package app

import (
	"database/sql"
	"encoding/json"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"quyenhealth/internal/meals"
)

// ---------- cài đặt ----------

var defaultSettings = map[string]string{
	"name":                "Quyền",
	"age":                 "22",
	"height":              "172",
	"start_weight":        "97",
	"goal_weight":         "70",
	"activity":            "1.2",
	"deficit":             "500",
	"water_min":           "2500",
	"water_max":           "3000",
	"snack":               "1",
	"remind_on":           "1",
	"t_weight":            "06:30",
	"t_med":               "08:00",
	"t_med2":              "12:00",
	"t_sleep":             "22:30",
	"remind_weight_times": "06:30",
	"remind_med_times":    "08:00,12:00",
	"remind_water_times":  "10:00,14:00,17:00,20:00",
	"remind_sleep_times":  "22:30",
}

func (s *Server) settings() map[string]string {
	out := map[string]string{}
	for k, v := range defaultSettings {
		out[k] = v
	}
	rows, err := s.db.Query(`SELECT key, value FROM settings`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var k, v string
		if rows.Scan(&k, &v) == nil {
			if _, ok := defaultSettings[k]; ok {
				out[k] = v
			}
		}
	}
	return out
}

func fnum(m map[string]string, k string) float64 {
	v, err := strconv.ParseFloat(m[k], 64)
	if err != nil {
		v, _ = strconv.ParseFloat(defaultSettings[k], 64)
	}
	return v
}

func (s *Server) latestWeight() (date string, kg float64, ok bool) {
	err := s.db.QueryRow(`SELECT date, kg FROM weight_log ORDER BY date DESC LIMIT 1`).Scan(&date, &kg)
	return date, kg, err == nil
}

// targetKcal tính năng lượng mục tiêu mỗi ngày (Mifflin–St Jeor cho nam, trừ thâm hụt).
func (s *Server) targetKcal(set map[string]string) int {
	w := fnum(set, "start_weight")
	if _, kg, ok := s.latestWeight(); ok {
		w = kg
	}
	bmr := 10*w + 6.25*fnum(set, "height") - 5*fnum(set, "age") + 5
	t := bmr*fnum(set, "activity") - fnum(set, "deficit")
	t = math.Round(t/50) * 50
	return int(math.Max(1500, math.Min(2400, t)))
}

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	set := s.settings()
	writeJSON(w, 200, map[string]any{"settings": set, "target_kcal": s.targetKcal(set), "user": s.currentUser(r)})
}

func validHM(v string) bool {
	t, err := time.Parse("15:04", v)
	return err == nil && t.Format("15:04") == v
}

func validHMList(v string) bool {
	v = strings.TrimSpace(v)
	if v == "" {
		return true // Cho phép rỗng nếu muốn tắt loại nhắc này
	}
	parts := strings.Split(v, ",")
	if len(parts) > 12 {
		return false
	}
	for _, p := range parts {
		if !validHM(strings.TrimSpace(p)) {
			return false
		}
	}
	return true
}

func (s *Server) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	var in map[string]string
	if !readJSON(w, r, &in) {
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		serverErr(w, err)
		return
	}
	defer tx.Rollback()
	for k, v := range in {
		if _, ok := defaultSettings[k]; !ok {
			continue
		}
		v = strings.TrimSpace(v)
		switch k {
		case "name":
			if v == "" || utf8.RuneCountInString(v) > 30 {
				httpErr(w, 400, "tên không hợp lệ")
				return
			}
		case "t_weight", "t_med", "t_med2", "t_sleep":
			if !validHM(v) {
				httpErr(w, 400, "giờ không hợp lệ (HH:MM)")
				return
			}
		case "remind_weight_times", "remind_med_times", "remind_water_times", "remind_sleep_times":
			if !validHMList(v) {
				httpErr(w, 400, "danh sách giờ không hợp lệ (HH:MM,...)")
				return
			}
		case "snack", "remind_on":
			if v != "0" && v != "1" {
				httpErr(w, 400, "giá trị không hợp lệ")
				return
			}
		default:
			n, err := strconv.ParseFloat(v, 64)
			if err != nil || n <= 0 || n > 10000 {
				httpErr(w, 400, "số không hợp lệ: "+k)
				return
			}
		}
		if _, err := tx.Exec(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, k, v); err != nil {
			serverErr(w, err)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}
	s.handleGetSettings(w, r)
}

// ---------- nước ----------

type waterEntry struct {
	ID int64 `json:"id"`
	Ts int64 `json:"ts"`
	Ml int   `json:"ml"`
}

func (s *Server) waterEntries(date string) ([]waterEntry, int) {
	out := []waterEntry{}
	total := 0
	rows, err := s.db.Query(`SELECT id, ts, ml FROM water_log WHERE date=? ORDER BY ts, id`, date)
	if err != nil {
		return out, 0
	}
	defer rows.Close()
	for rows.Next() {
		var e waterEntry
		if rows.Scan(&e.ID, &e.Ts, &e.Ml) == nil {
			out = append(out, e)
			total += e.Ml
		}
	}
	return out, total
}

func (s *Server) handleAddWater(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Ml  int    `json:"ml"`
		Cid string `json:"cid"`
		Ts  int64  `json:"ts"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if in.Ml < 1 || in.Ml > 2000 {
		httpErr(w, 400, "Lượng nước phải từ 1 đến 2000 ml")
		return
	}
	now := s.now()
	ts := now.Unix()
	if in.Ts > now.Add(-48*time.Hour).Unix() && in.Ts <= now.Add(5*time.Minute).Unix() {
		ts = in.Ts // hàng đợi offline gửi lại với thời điểm thật
	}
	var cid any
	if in.Cid != "" {
		if len(in.Cid) > 64 {
			httpErr(w, 400, "cid quá dài")
			return
		}
		cid = in.Cid
	}
	if _, err := s.db.Exec(`INSERT OR IGNORE INTO water_log(cid, ts, date, ml) VALUES(?,?,?,?)`, cid, ts, s.dateOf(ts), in.Ml); err != nil {
		serverErr(w, err)
		return
	}
	entries, total := s.waterEntries(s.today())
	writeJSON(w, 200, map[string]any{"total": total, "entries": entries})
}

func (s *Server) handleDelWater(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpErr(w, 400, "id không hợp lệ")
		return
	}
	if _, err := s.db.Exec(`DELETE FROM water_log WHERE id=?`, id); err != nil {
		serverErr(w, err)
		return
	}
	entries, total := s.waterEntries(s.today())
	writeJSON(w, 200, map[string]any{"total": total, "entries": entries})
}

// ---------- cân nặng ----------

type weightRow struct {
	Date string  `json:"date"`
	Kg   float64 `json:"kg"`
}

func (s *Server) weights(days int) []weightRow {
	from := addDays(s.today(), -days+1)
	out := []weightRow{}
	rows, err := s.db.Query(`SELECT date, kg FROM weight_log WHERE date>=? ORDER BY date`, from)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var x weightRow
		if rows.Scan(&x.Date, &x.Kg) == nil {
			out = append(out, x)
		}
	}
	return out
}

func (s *Server) handleGetWeight(w http.ResponseWriter, r *http.Request) {
	days := queryInt(r, "days", 90, 1, 3650)
	writeJSON(w, 200, map[string]any{"rows": s.weights(days)})
}

func (s *Server) handlePostWeight(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Kg   float64 `json:"kg"`
		Date string  `json:"date"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if in.Kg < 30 || in.Kg > 300 {
		httpErr(w, 400, "Cân nặng phải từ 30 đến 300 kg")
		return
	}
	if in.Date == "" {
		in.Date = s.today()
	}
	if !validDate(in.Date) || in.Date > s.today() {
		httpErr(w, 400, "ngày không hợp lệ")
		return
	}
	kg := math.Round(in.Kg*10) / 10
	if _, err := s.db.Exec(`INSERT INTO weight_log(date,kg,ts) VALUES(?,?,?) ON CONFLICT(date) DO UPDATE SET kg=excluded.kg, ts=excluded.ts`,
		in.Date, kg, s.now().Unix()); err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"rows": s.weights(90), "target_kcal": s.targetKcal(s.settings())})
}

func (s *Server) handleDelWeight(w http.ResponseWriter, r *http.Request) {
	d := r.PathValue("date")
	if !validDate(d) {
		httpErr(w, 400, "ngày không hợp lệ")
		return
	}
	if _, err := s.db.Exec(`DELETE FROM weight_log WHERE date=?`, d); err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"rows": s.weights(90)})
}

// ---------- thuốc ----------

func (s *Server) medTaken(date string) bool {
	var t int
	err := s.db.QueryRow(`SELECT taken FROM med_log WHERE date=?`, date).Scan(&t)
	return err == nil && t == 1
}

func (s *Server) handlePutMed(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Date  string `json:"date"`
		Taken bool   `json:"taken"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if in.Date == "" {
		in.Date = s.today()
	}
	if !validDate(in.Date) || in.Date > s.today() {
		httpErr(w, 400, "ngày không hợp lệ")
		return
	}
	t := 0
	if in.Taken {
		t = 1
	}
	if _, err := s.db.Exec(`INSERT INTO med_log(date,taken,ts) VALUES(?,?,?) ON CONFLICT(date) DO UPDATE SET taken=excluded.taken, ts=excluded.ts`,
		in.Date, t, s.now().Unix()); err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"date": in.Date, "taken": in.Taken})
}

func (s *Server) handleGetMed(w http.ResponseWriter, r *http.Request) {
	days := queryInt(r, "days", 30, 1, 366)
	from := addDays(s.today(), -days+1)
	out := []string{}
	rows, err := s.db.Query(`SELECT date FROM med_log WHERE date>=? AND taken=1 ORDER BY date`, from)
	if err != nil {
		serverErr(w, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var d string
		if rows.Scan(&d) == nil {
			out = append(out, d)
		}
	}
	writeJSON(w, 200, map[string]any{"taken": out, "today": s.today()})
}

// ---------- đường huyết ----------

type glucoseRow struct {
	ID   int64   `json:"id"`
	Ts   int64   `json:"ts"`
	Mmol float64 `json:"mmol"`
	Ctx  string  `json:"ctx"`
}

func (s *Server) glucose(days int) []glucoseRow {
	from := addDays(s.today(), -days+1)
	out := []glucoseRow{}
	rows, err := s.db.Query(`SELECT id, ts, mmol, ctx FROM glucose_log WHERE date>=? ORDER BY ts DESC`, from)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var g glucoseRow
		if rows.Scan(&g.ID, &g.Ts, &g.Mmol, &g.Ctx) == nil {
			out = append(out, g)
		}
	}
	return out
}

func (s *Server) handleGetGlucose(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"rows": s.glucose(queryInt(r, "days", 90, 1, 3650))})
}

func (s *Server) handlePostGlucose(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Mmol float64 `json:"mmol"`
		Ctx  string  `json:"ctx"`
		Ts   int64   `json:"ts"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if in.Mmol < 1 || in.Mmol > 40 {
		httpErr(w, 400, "Đường huyết phải từ 1 đến 40 mmol/L")
		return
	}
	switch in.Ctx {
	case "fasting", "after", "bedtime", "other":
	default:
		in.Ctx = "fasting"
	}
	now := s.now()
	ts := now.Unix()
	if in.Ts > now.Add(-48*time.Hour).Unix() && in.Ts <= now.Add(5*time.Minute).Unix() {
		ts = in.Ts
	}
	mmol := math.Round(in.Mmol*10) / 10
	if _, err := s.db.Exec(`INSERT INTO glucose_log(ts,date,mmol,ctx) VALUES(?,?,?,?)`, ts, s.dateOf(ts), mmol, in.Ctx); err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"rows": s.glucose(90)})
}

func (s *Server) handleDelGlucose(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpErr(w, 400, "id không hợp lệ")
		return
	}
	if _, err := s.db.Exec(`DELETE FROM glucose_log WHERE id=?`, id); err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"rows": s.glucose(90)})
}

// ---------- bữa ăn ----------

type mealRow struct {
	Date   string       `json:"date"`
	Slot   meals.Slot   `json:"slot"`
	Items  []meals.Item `json:"items"`
	Kcal   int          `json:"kcal"`
	Status string       `json:"status"`
	Note   string       `json:"note"`
}

func (s *Server) loadMeals(db interface {
	Query(string, ...any) (*sql.Rows, error)
}, from, to string) ([]mealRow, error) {
	rows, err := db.Query(`SELECT date, slot, items_json, kcal, status, actual_note FROM meal_plan WHERE date>=? AND date<=? ORDER BY date`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []mealRow{}
	for rows.Next() {
		var m mealRow
		var js string
		if err := rows.Scan(&m.Date, &m.Slot, &js, &m.Kcal, &m.Status, &m.Note); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(js), &m.Items); err != nil {
			continue
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func toPlan(rows []mealRow) map[string]meals.Day {
	p := map[string]meals.Day{}
	for _, m := range rows {
		if p[m.Date] == nil {
			p[m.Date] = meals.Day{}
		}
		p[m.Date][m.Slot] = meals.Meal{Items: m.Items, Kcal: m.Kcal}
	}
	return p
}

func (s *Server) handleGetMeals(w http.ResponseWriter, r *http.Request) {
	from := r.URL.Query().Get("from")
	if from == "" {
		from = s.today()
	}
	if !validDate(from) {
		httpErr(w, 400, "ngày không hợp lệ")
		return
	}
	days := queryInt(r, "days", 7, 1, 31)
	rows, err := s.loadMeals(s.db, from, addDays(from, days-1))
	if err != nil {
		serverErr(w, err)
		return
	}
	set := s.settings()
	writeJSON(w, 200, map[string]any{"rows": rows, "target_kcal": s.targetKcal(set), "today": s.today()})
}

func (s *Server) window() []string {
	t := s.today()
	out := make([]string, 7)
	for i := range out {
		out[i] = addDays(t, i)
	}
	return out
}

func insertMeal(tx *sql.Tx, date string, slot meals.Slot, m meals.Meal, now int64) error {
	js, _ := json.Marshal(m.Items)
	_, err := tx.Exec(`INSERT INTO meal_plan(date,slot,items_json,kcal,status,actual_note,updated_at) VALUES(?,?,?,?, 'pending','',?)
		ON CONFLICT(date,slot) DO UPDATE SET items_json=excluded.items_json, kcal=excluded.kcal, status='pending', actual_note='', updated_at=excluded.updated_at`,
		date, string(slot), string(js), m.Kcal, now)
	return err
}

func (s *Server) handleGenerateMeals(w http.ResponseWriter, r *http.Request) {
	dates := s.window()
	set := s.settings()
	target := s.targetKcal(set)
	snack := set["snack"] == "1"

	tx, err := s.db.Begin()
	if err != nil {
		serverErr(w, err)
		return
	}
	defer tx.Rollback()
	existing, err := s.loadMeals(tx, dates[0], dates[6])
	if err != nil {
		serverErr(w, err)
		return
	}
	fixed := map[string]meals.Day{}
	for _, m := range existing {
		if m.Status != "pending" { // giữ lại bữa đã tick / đã ghi chú
			if fixed[m.Date] == nil {
				fixed[m.Date] = meals.Day{}
			}
			fixed[m.Date][m.Slot] = meals.Meal{Items: m.Items, Kcal: m.Kcal}
		}
	}
	plan := meals.Generate(dates, fixed, target, snack, s.now().UnixNano())
	now := s.now().Unix()
	if _, err := tx.Exec(`DELETE FROM meal_plan WHERE date>=? AND date<=? AND status='pending'`, dates[0], dates[6]); err != nil {
		serverErr(w, err)
		return
	}
	for _, d := range dates {
		for slot, m := range plan[d] {
			if _, ok := fixed[d][slot]; ok {
				continue
			}
			if err := insertMeal(tx, d, slot, m, now); err != nil {
				serverErr(w, err)
				return
			}
		}
	}
	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}
	s.handleGetMeals(w, r)
}

func validSlot(sl string) bool {
	switch meals.Slot(sl) {
	case meals.Breakfast, meals.Lunch, meals.Dinner, meals.Snack:
		return true
	}
	return false
}

func (s *Server) handleSwapMeal(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Date string `json:"date"`
		Slot string `json:"slot"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	dates := s.window()
	if !validSlot(in.Slot) || in.Date < dates[0] || in.Date > dates[6] || !validDate(in.Date) {
		httpErr(w, 400, "chỉ đổi món cho 7 ngày tới")
		return
	}
	set := s.settings()
	rows, err := s.loadMeals(s.db, dates[0], dates[6])
	if err != nil {
		serverErr(w, err)
		return
	}
	var cur *mealRow
	for i := range rows {
		if rows[i].Date == in.Date && string(rows[i].Slot) == in.Slot {
			cur = &rows[i]
		}
	}
	if cur == nil {
		httpErr(w, 404, "chưa có bữa này, hãy tạo lịch trước")
		return
	}
	if cur.Status != "pending" {
		httpErr(w, 400, "bữa này đã được ghi nhận, hãy đặt lại 'Chưa ăn' trước khi đổi món")
		return
	}
	nd := meals.Swap(dates, toPlan(rows), in.Date, meals.Slot(in.Slot), s.targetKcal(set), set["snack"] == "1", s.now().UnixNano())
	nm, ok := nd[meals.Slot(in.Slot)]
	if !ok || len(nm.Items) == 0 {
		httpErr(w, 500, "không đổi được món")
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		serverErr(w, err)
		return
	}
	defer tx.Rollback()
	if err := insertMeal(tx, in.Date, meals.Slot(in.Slot), nm, s.now().Unix()); err != nil {
		serverErr(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, mealRow{Date: in.Date, Slot: meals.Slot(in.Slot), Items: nm.Items, Kcal: nm.Kcal, Status: "pending"})
}

func (s *Server) handleCheckMeal(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Date   string `json:"date"`
		Slot   string `json:"slot"`
		Status string `json:"status"`
		Note   string `json:"note"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if !validDate(in.Date) || !validSlot(in.Slot) {
		httpErr(w, 400, "dữ liệu không hợp lệ")
		return
	}
	switch in.Status {
	case "pending", "done", "swapped":
	default:
		httpErr(w, 400, "trạng thái không hợp lệ")
		return
	}
	note := strings.TrimSpace(in.Note)
	if in.Status != "swapped" {
		note = ""
	}
	if utf8.RuneCountInString(note) > 300 {
		httpErr(w, 400, "ghi chú tối đa 300 ký tự")
		return
	}
	res, err := s.db.Exec(`UPDATE meal_plan SET status=?, actual_note=?, updated_at=? WHERE date=? AND slot=?`,
		in.Status, note, s.now().Unix(), in.Date, in.Slot)
	if err != nil {
		serverErr(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		httpErr(w, 404, "không có bữa này")
		return
	}
	writeJSON(w, 200, map[string]any{"date": in.Date, "slot": in.Slot, "status": in.Status, "note": note})
}

func (s *Server) handleShopping(w http.ResponseWriter, r *http.Request) {
	from := r.URL.Query().Get("from")
	if from == "" {
		from = s.today()
	}
	if !validDate(from) {
		httpErr(w, 400, "ngày không hợp lệ")
		return
	}
	days := queryInt(r, "days", 7, 1, 14)
	rows, err := s.loadMeals(s.db, from, addDays(from, days-1))
	if err != nil {
		serverErr(w, err)
		return
	}
	var ds []meals.Day
	for _, m := range rows {
		if m.Status == "pending" {
			ds = append(ds, meals.Day{m.Slot: meals.Meal{Items: m.Items, Kcal: m.Kcal}})
		}
	}
	lines := meals.Shopping(ds)
	if lines == nil {
		lines = []meals.ShopLine{}
	}
	writeJSON(w, 200, map[string]any{"lines": lines, "from": from, "days": days})
}

// ---------- tổng hợp "hôm nay" ----------

func (s *Server) handleToday(w http.ResponseWriter, r *http.Request) {
	date := s.today()
	set := s.settings()
	entries, total := s.waterEntries(date)

	ws := s.weights(400)
	var todayKg *float64
	var last, prev *weightRow
	for i := range ws {
		if ws[i].Date == date {
			todayKg = &ws[i].Kg
		}
	}
	if n := len(ws); n > 0 {
		last = &ws[n-1]
		if n > 1 {
			prev = &ws[n-2]
		}
	}
	rows, err := s.loadMeals(s.db, date, addDays(date, 6))
	if err != nil {
		serverErr(w, err)
		return
	}
	planDays := map[string]bool{}
	todayMeals := []mealRow{}
	for _, m := range rows {
		planDays[m.Date] = true
		if m.Date == date {
			todayMeals = append(todayMeals, m)
		}
	}
	writeJSON(w, 200, map[string]any{
		"ok":         true,
		"user":       s.currentUser(r),
		"date":       date,
		"now":        s.now().Unix(),
		"settings":   set,
		"target_kcal": s.targetKcal(set),
		"water":      map[string]any{"total": total, "entries": entries},
		"weight":     map[string]any{"today": todayKg, "last": last, "prev": prev, "first": firstOrNil(ws)},
		"med":        map[string]any{"taken": s.medTaken(date)},
		"meals":      todayMeals,
		"plan_days":  len(planDays),
	})
}

func firstOrNil(ws []weightRow) *weightRow {
	if len(ws) == 0 {
		return nil
	}
	return &ws[0]
}

// ---------- báo cáo tuần ----------

func (s *Server) handleReport(w http.ResponseWriter, r *http.Request) {
	days := queryInt(r, "days", 7, 1, 31)
	to := s.today()
	from := addDays(to, -days+1)
	type dayRep struct {
		Date    string `json:"date"`
		Water   int    `json:"water"`
		Med     bool   `json:"med"`
		Done    int    `json:"meals_done"`
		Swapped int    `json:"meals_swapped"`
		Total   int    `json:"meals_total"`
	}
	idx := map[string]*dayRep{}
	out := make([]*dayRep, 0, days)
	for i := 0; i < days; i++ {
		d := addDays(from, i)
		dr := &dayRep{Date: d}
		idx[d] = dr
		out = append(out, dr)
	}
	if rows, err := s.db.Query(`SELECT date, SUM(ml) FROM water_log WHERE date>=? AND date<=? GROUP BY date`, from, to); err == nil {
		for rows.Next() {
			var d string
			var ml int
			if rows.Scan(&d, &ml) == nil && idx[d] != nil {
				idx[d].Water = ml
			}
		}
		rows.Close()
	}
	if rows, err := s.db.Query(`SELECT date FROM med_log WHERE date>=? AND date<=? AND taken=1`, from, to); err == nil {
		for rows.Next() {
			var d string
			if rows.Scan(&d) == nil && idx[d] != nil {
				idx[d].Med = true
			}
		}
		rows.Close()
	}
	if rows, err := s.db.Query(`SELECT date, status FROM meal_plan WHERE date>=? AND date<=? AND slot!='snack'`, from, to); err == nil {
		for rows.Next() {
			var d, st string
			if rows.Scan(&d, &st) == nil && idx[d] != nil {
				idx[d].Total++
				switch st {
				case "done":
					idx[d].Done++
				case "swapped":
					idx[d].Swapped++
				}
			}
		}
		rows.Close()
	}
	set := s.settings()
	var wRows []weightRow
	for _, x := range s.weights(days) {
		wRows = append(wRows, x)
	}
	writeJSON(w, 200, map[string]any{"days": out, "weights": wRows, "glucose": s.glucose(days),
		"water_min": fnum(set, "water_min"), "water_max": fnum(set, "water_max")})
}

