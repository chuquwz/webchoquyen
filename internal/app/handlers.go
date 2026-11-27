package app

import (
	"encoding/json"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// ---------- cài đặt ----------

var defaultSettings = map[string]string{
	"name":                "Quyền",
	"age":                 "22",
	"height":              "172",
	"goal_weight":         "70",
	"water_min":           "2500",
	"water_max":           "3000",
	"t_weight":            "06:30",
	"t_med":               "08:00",
	"t_med2":              "12:00",
	"t_sleep":             "22:30",
	"remind_weight_times": "06:30",
	"remind_med_times":    "08:00,12:30,20:00",
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

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	set := s.settings()
	writeJSON(w, 200, map[string]any{
		"settings":   set,
		"med_times":  s.medScheduleTimes(set),
		"med_target": s.medTargetCount(set),
		"user":       s.currentUser(r),
		"health_rev": s.healthRev.Load(),
	})
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
			if v != "" && !validHM(v) {
				httpErr(w, 400, "giờ không hợp lệ (HH:MM)")
				return
			}
		case "remind_weight_times", "remind_med_times", "remind_water_times", "remind_sleep_times":
			if !validHMList(v) {
				httpErr(w, 400, "danh sách giờ không hợp lệ (HH:MM,...)")
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
	s.bumpHealthRev()
	s.handleGetSettings(w, r)
}

// pruneOldHealthData xoá dữ liệu sức khoẻ của các ngày cũ (nước, thuốc, bữa ăn)
// và xoá lịch sử cân nặng cũ, chỉ giữ lại tối đa 1 mốc cân mới nhất trong weight_log.
func (s *Server) pruneOldHealthData(today string) {
	if today == "" {
		today = s.today()
	}
	_, _ = s.db.Exec(`DELETE FROM water_log WHERE date <> ?`, today)
	_, _ = s.db.Exec(`DELETE FROM med_log WHERE date <> ?`, today)
	_, _ = s.db.Exec(`DELETE FROM meal_plan WHERE date <> ?`, today)
	_, _ = s.db.Exec(`DELETE FROM weight_log WHERE date <> (SELECT date FROM weight_log ORDER BY date DESC LIMIT 1)`)
}

// ---------- nước ----------

type waterEntry struct {
	ID int64 `json:"id"`
	Ts int64 `json:"ts"`
	Ml int   `json:"ml"`
}

func (s *Server) waterTotal(date string) int {
	var total int
	_ = s.db.QueryRow(`SELECT COALESCE(SUM(ml), 0) FROM water_log WHERE date=?`, date).Scan(&total)
	return total
}

func (s *Server) waterEntries(date string) ([]waterEntry, int) {
	total := s.waterTotal(date)
	out := []waterEntry{}
	var e waterEntry
	if s.db.QueryRow(`SELECT id, ts, ml FROM water_log WHERE date=? ORDER BY ts DESC, id DESC LIMIT 1`, date).Scan(&e.ID, &e.Ts, &e.Ml) == nil {
		out = append(out, e)
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
	today := s.today()
	s.pruneOldHealthData(today)
	now := s.now()
	ts := now.Unix()
	if in.Ts > now.Add(-24*time.Hour).Unix() && in.Ts <= now.Add(5*time.Minute).Unix() && s.dateOf(in.Ts) == today {
		ts = in.Ts // hàng đợi offline cùng ngày gửi lại với thời điểm thật
	}
	var cid any
	if in.Cid != "" {
		if len(in.Cid) > 64 {
			httpErr(w, 400, "cid quá dài")
			return
		}
		cid = in.Cid
	}
	if _, err := s.db.Exec(`INSERT OR IGNORE INTO water_log(cid, ts, date, ml) VALUES(?,?,?,?)`, cid, ts, today, in.Ml); err != nil {
		serverErr(w, err)
		return
	}
	rev := s.bumpHealthRev()
	entries, total := s.waterEntries(today)
	writeJSON(w, 200, map[string]any{"total": total, "entries": entries, "health_rev": rev})
}

func (s *Server) handleDelWater(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpErr(w, 400, "id không hợp lệ")
		return
	}
	today := s.today()
	s.pruneOldHealthData(today)
	if _, err := s.db.Exec(`DELETE FROM water_log WHERE id=? AND date=?`, id, today); err != nil {
		serverErr(w, err)
		return
	}
	rev := s.bumpHealthRev()
	entries, total := s.waterEntries(today)
	writeJSON(w, 200, map[string]any{"total": total, "entries": entries, "health_rev": rev})
}

// ---------- cân nặng ----------

type weightRow struct {
	Date string  `json:"date"`
	Kg   float64 `json:"kg"`
	Ts   int64   `json:"ts"`
}

func (s *Server) latestWeight() *weightRow {
	var x weightRow
	if s.db.QueryRow(`SELECT date, kg, COALESCE(ts, 0) FROM weight_log ORDER BY date DESC LIMIT 1`).Scan(&x.Date, &x.Kg, &x.Ts) != nil {
		return nil
	}
	return &x
}

func (s *Server) handlePostWeight(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Kg float64 `json:"kg"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if in.Kg < 30 || in.Kg > 300 {
		httpErr(w, 400, "Cân nặng phải từ 30 đến 300 kg")
		return
	}
	kg := math.Round(in.Kg*10) / 10
	today := s.today()
	now := s.now().Unix()
	if _, err := s.db.Exec(`INSERT INTO weight_log(date,kg,ts) VALUES(?,?,?) ON CONFLICT(date) DO UPDATE SET kg=excluded.kg, ts=excluded.ts`,
		today, kg, now); err != nil {
		serverErr(w, err)
		return
	}
	_, _ = s.db.Exec(`DELETE FROM weight_log WHERE date <> ?`, today)
	rev := s.bumpHealthRev()
	writeJSON(w, 200, map[string]any{"today": kg, "last": &weightRow{Date: today, Kg: kg, Ts: now}, "health_rev": rev})
}

// ---------- thuốc ----------

func (s *Server) medScheduleTimes(set map[string]string) []string {
	fallback := set["t_med"]
	if set["t_med2"] != "" {
		fallback += "," + set["t_med2"]
	}
	return parseHMList(set["remind_med_times"], fallback)
}

func (s *Server) medTargetCount(set map[string]string) int {
	times := s.medScheduleTimes(set)
	if len(times) > 0 {
		return len(times)
	}
	return 1
}

func normalizeMedDoses(raw []bool, count, target int) ([]bool, int) {
	if target < 1 {
		target = 1
	}
	if raw != nil {
		doses := make([]bool, target)
		takenCount := 0
		for i := 0; i < target && i < len(raw); i++ {
			if raw[i] {
				doses[i] = true
				takenCount++
			}
		}
		return doses, takenCount
	}
	if count < 0 {
		count = 0
	}
	if count > target {
		count = target
	}
	doses := make([]bool, target)
	for i := 0; i < count; i++ {
		doses[i] = true
	}
	return doses, count
}

func (s *Server) medDoseState(date string, target int) (int, []bool) {
	if target < 1 {
		target = 1
	}
	var t int
	var rawJSON string
	err := s.db.QueryRow(`SELECT taken, COALESCE(doses_json, '') FROM med_log WHERE date=?`, date).Scan(&t, &rawJSON)
	if err != nil {
		doses, _ := normalizeMedDoses(nil, 0, target)
		return 0, doses
	}
	if rawJSON != "" {
		var parsed []bool
		if json.Unmarshal([]byte(rawJSON), &parsed) == nil {
			doses, cnt := normalizeMedDoses(parsed, t, target)
			return cnt, doses
		}
	}
	if t < 0 {
		t = 0
	}
	doses, _ := normalizeMedDoses(nil, t, target)
	return t, doses
}

func (s *Server) medTakenCount(date string) int {
	var t int
	err := s.db.QueryRow(`SELECT taken FROM med_log WHERE date=?`, date).Scan(&t)
	if err != nil || t < 0 {
		return 0
	}
	return t
}

func (s *Server) medTaken(date string) bool {
	target := s.medTargetCount(s.settings())
	return s.medTakenCount(date) >= target
}

func (s *Server) handlePutMed(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Date       string `json:"date"`
		Taken      *bool  `json:"taken"`
		TakenCount *int   `json:"taken_count"`
		Doses      []bool `json:"doses"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	today := s.today()
	s.pruneOldHealthData(today)
	set := s.settings()
	times := s.medScheduleTimes(set)
	target := s.medTargetCount(set)

	t := 0
	var doses []bool
	if in.Doses != nil {
		doses, t = normalizeMedDoses(in.Doses, 0, target)
	} else {
		if in.TakenCount != nil {
			t = *in.TakenCount
			if t < 0 {
				t = 0
			}
			if t > 20 {
				t = 20
			}
		} else if in.Taken != nil && *in.Taken {
			t = target
		}
		doses, _ = normalizeMedDoses(nil, t, target)
	}
	dosesBytes, _ := json.Marshal(doses)
	if _, err := s.db.Exec(`INSERT INTO med_log(date,taken,doses_json,ts) VALUES(?,?,?,?) ON CONFLICT(date) DO UPDATE SET taken=excluded.taken, doses_json=excluded.doses_json, ts=excluded.ts`,
		today, t, string(dosesBytes), s.now().Unix()); err != nil {
		serverErr(w, err)
		return
	}
	rev := s.bumpHealthRev()
	writeJSON(w, 200, map[string]any{
		"date":         today,
		"taken_count":  t,
		"target_count": target,
		"taken":        t >= target,
		"doses":        doses,
		"times":        times,
		"health_rev":   rev,
	})
}

func (s *Server) handleGetMed(w http.ResponseWriter, r *http.Request) {
	today := s.today()
	s.pruneOldHealthData(today)
	set := s.settings()
	target := s.medTargetCount(set)
	cnt, doses := s.medDoseState(today, target)
	out := []string{}
	counts := map[string]int{}
	if cnt > 0 {
		counts[today] = cnt
		if cnt >= target {
			out = append(out, today)
		}
	}
	writeJSON(w, 200, map[string]any{
		"taken":        out,
		"counts":       counts,
		"target_count": target,
		"doses":        doses,
		"times":        s.medScheduleTimes(set),
		"today":        today,
		"health_rev":   s.healthRev.Load(),
	})
}

// ---------- bữa ăn ----------

var defaultMealSlots = []string{"breakfast", "lunch", "dinner"}

func validSlot(sl string) bool {
	return sl == "breakfast" || sl == "lunch" || sl == "dinner"
}

type mealRow struct {
	Date   string `json:"date"`
	Slot   string `json:"slot"`
	Status string `json:"status"`
}

func (s *Server) loadTodayMeals(date string) ([]mealRow, error) {
	rows, err := s.db.Query(`SELECT slot, status FROM meal_plan WHERE date=?`, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	bySlot := make(map[string]string, 3)
	for rows.Next() {
		var sl, st string
		if err := rows.Scan(&sl, &st); err != nil {
			return nil, err
		}
		if st == "done" {
			bySlot[sl] = "done"
		} else {
			bySlot[sl] = "pending"
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]mealRow, 0, len(defaultMealSlots))
	for _, sl := range defaultMealSlots {
		st := bySlot[sl]
		if st == "" {
			st = "pending"
		}
		out = append(out, mealRow{Date: date, Slot: sl, Status: st})
	}
	return out, nil
}

func (s *Server) handleCheckMeal(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Slot   string `json:"slot"`
		Status string `json:"status"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if !validSlot(in.Slot) {
		httpErr(w, 400, "dữ liệu không hợp lệ")
		return
	}
	if in.Status != "pending" && in.Status != "done" {
		httpErr(w, 400, "trạng thái không hợp lệ")
		return
	}
	today := s.today()
	s.pruneOldHealthData(today)
	if _, err := s.db.Exec(`INSERT INTO meal_plan(date,slot,items_json,kcal,status,actual_note,updated_at) VALUES(?,?,'[]',0,?,'',?)
		ON CONFLICT(date,slot) DO UPDATE SET status=excluded.status, items_json='[]', kcal=0, actual_note='', updated_at=excluded.updated_at`,
		today, in.Slot, in.Status, s.now().Unix()); err != nil {
		serverErr(w, err)
		return
	}
	rev := s.bumpHealthRev()
	writeJSON(w, 200, map[string]any{"date": today, "slot": in.Slot, "status": in.Status, "health_rev": rev})
}

// ---------- tổng hợp "hôm nay" ----------

func (s *Server) handleToday(w http.ResponseWriter, r *http.Request) {
	date := s.today()
	s.pruneOldHealthData(date)
	set := s.settings()
	entries, total := s.waterEntries(date)

	last := s.latestWeight()
	var todayKg *float64
	if last != nil && last.Date == date {
		todayKg = &last.Kg
	}
	todayMeals, err := s.loadTodayMeals(date)
	if err != nil {
		serverErr(w, err)
		return
	}
	medTimes := s.medScheduleTimes(set)
	medTarget := s.medTargetCount(set)
	medCount, medDoses := s.medDoseState(date, medTarget)
	writeJSON(w, 200, map[string]any{
		"ok":         true,
		"user":       s.currentUser(r),
		"date":       date,
		"now":        s.now().Unix(),
		"health_rev": s.healthRev.Load(),
		"settings":   set,
		"water":      map[string]any{"total": total, "entries": entries},
		"weight":     map[string]any{"today": todayKg, "last": last},
		"med": map[string]any{
			"taken":        medCount >= medTarget,
			"taken_count":  medCount,
			"target_count": medTarget,
			"doses":        medDoses,
			"times":        medTimes,
		},
		"meals":        todayMeals,
		"meals_target": len(defaultMealSlots),
	})
}

