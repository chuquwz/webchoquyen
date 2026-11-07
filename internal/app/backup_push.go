package app

import (
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/SherClockHolmes/webpush-go"
	"quyenhealth/internal/meals"
)

// ---------- Sao lưu & Khôi phục JSON ----------

type backupData struct {
	Version  int               `json:"version"`
	ExportAt int64             `json:"export_at"`
	Settings map[string]string `json:"settings"`
	Water    []backupWater     `json:"water"`
	Weight   []backupWeight    `json:"weight"`
	Med      []backupMed       `json:"med"`
	Meals    []backupMeal      `json:"meals"`
	Glucose  []backupGlucose   `json:"glucose"`
}

type backupWater struct {
	Cid  *string `json:"cid,omitempty"`
	Ts   int64   `json:"ts"`
	Date string  `json:"date"`
	Ml   int     `json:"ml"`
}

type backupWeight struct {
	Date string  `json:"date"`
	Kg   float64 `json:"kg"`
	Ts   int64   `json:"ts"`
}

type backupMed struct {
	Date  string `json:"date"`
	Taken int    `json:"taken"`
	Ts    int64  `json:"ts"`
}

type backupMeal struct {
	Date      string `json:"date"`
	Slot      string `json:"slot"`
	ItemsJSON string `json:"items_json"`
	Kcal      int    `json:"kcal"`
	Status    string `json:"status"`
	Note      string `json:"actual_note"`
	UpdatedAt int64  `json:"updated_at"`
}

type backupGlucose struct {
	Ts   int64   `json:"ts"`
	Date string  `json:"date"`
	Mmol float64 `json:"mmol"`
	Ctx  string  `json:"ctx"`
}

func (s *Server) handleBackup(w http.ResponseWriter, r *http.Request) {
	b := backupData{
		Version:  1,
		ExportAt: s.now().Unix(),
		Settings: s.settings(),
		Water:    []backupWater{},
		Weight:   []backupWeight{},
		Med:      []backupMed{},
		Meals:    []backupMeal{},
		Glucose:  []backupGlucose{},
	}

	if rows, err := s.db.Query(`SELECT cid, ts, date, ml FROM water_log ORDER BY ts, id`); err == nil {
		for rows.Next() {
			var x backupWater
			var cid sql.NullString
			if rows.Scan(&cid, &x.Ts, &x.Date, &x.Ml) == nil {
				if cid.Valid {
					s := cid.String
					x.Cid = &s
				}
				b.Water = append(b.Water, x)
			}
		}
		rows.Close()
	}

	if rows, err := s.db.Query(`SELECT date, kg, ts FROM weight_log ORDER BY date`); err == nil {
		for rows.Next() {
			var x backupWeight
			if rows.Scan(&x.Date, &x.Kg, &x.Ts) == nil {
				b.Weight = append(b.Weight, x)
			}
		}
		rows.Close()
	}

	if rows, err := s.db.Query(`SELECT date, taken, ts FROM med_log ORDER BY date`); err == nil {
		for rows.Next() {
			var x backupMed
			if rows.Scan(&x.Date, &x.Taken, &x.Ts) == nil {
				b.Med = append(b.Med, x)
			}
		}
		rows.Close()
	}

	if rows, err := s.db.Query(`SELECT date, slot, items_json, kcal, status, actual_note, updated_at FROM meal_plan ORDER BY date, slot`); err == nil {
		for rows.Next() {
			var x backupMeal
			if rows.Scan(&x.Date, &x.Slot, &x.ItemsJSON, &x.Kcal, &x.Status, &x.Note, &x.UpdatedAt) == nil {
				b.Meals = append(b.Meals, x)
			}
		}
		rows.Close()
	}

	if rows, err := s.db.Query(`SELECT ts, date, mmol, ctx FROM glucose_log ORDER BY ts, id`); err == nil {
		for rows.Next() {
			var x backupGlucose
			if rows.Scan(&x.Ts, &x.Date, &x.Mmol, &x.Ctx) == nil {
				b.Glucose = append(b.Glucose, x)
			}
		}
		rows.Close()
	}

	fname := fmt.Sprintf("quyenhealth-backup-%s.json", s.today())
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, fname))
	writeJSON(w, 200, b)
}

func (s *Server) handleRestore(w http.ResponseWriter, r *http.Request) {
	var b backupData
	if !readJSON(w, r, &b) {
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		serverErr(w, err)
		return
	}
	defer tx.Rollback()

	for k, v := range b.Settings {
		if _, ok := defaultSettings[k]; !ok {
			continue
		}
		if _, err := tx.Exec(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, k, v); err != nil {
			serverErr(w, err)
			return
		}
	}

	if _, err := tx.Exec(`DELETE FROM water_log`); err != nil {
		serverErr(w, err)
		return
	}
	for _, x := range b.Water {
		if x.Ml < 1 || x.Ml > 5000 || !validDate(x.Date) {
			continue
		}
		var cid any
		if x.Cid != nil && *x.Cid != "" {
			cid = *x.Cid
		}
		if _, err := tx.Exec(`INSERT OR IGNORE INTO water_log(cid,ts,date,ml) VALUES(?,?,?,?)`, cid, x.Ts, x.Date, x.Ml); err != nil {
			serverErr(w, err)
			return
		}
	}

	for _, x := range b.Weight {
		if x.Kg < 30 || x.Kg > 300 || !validDate(x.Date) {
			continue
		}
		if _, err := tx.Exec(`INSERT INTO weight_log(date,kg,ts) VALUES(?,?,?) ON CONFLICT(date) DO UPDATE SET kg=excluded.kg, ts=excluded.ts`, x.Date, x.Kg, x.Ts); err != nil {
			serverErr(w, err)
			return
		}
	}

	for _, x := range b.Med {
		if !validDate(x.Date) {
			continue
		}
		t := 0
		if x.Taken != 0 {
			t = 1
		}
		if _, err := tx.Exec(`INSERT INTO med_log(date,taken,ts) VALUES(?,?,?) ON CONFLICT(date) DO UPDATE SET taken=excluded.taken, ts=excluded.ts`, x.Date, t, x.Ts); err != nil {
			serverErr(w, err)
			return
		}
	}

	for _, x := range b.Meals {
		if !validDate(x.Date) || !validSlot(x.Slot) {
			continue
		}
		var items []meals.Item
		if json.Unmarshal([]byte(x.ItemsJSON), &items) != nil {
			continue
		}
		if _, err := tx.Exec(`INSERT INTO meal_plan(date,slot,items_json,kcal,status,actual_note,updated_at) VALUES(?,?,?,?,?,?,?)
			ON CONFLICT(date,slot) DO UPDATE SET items_json=excluded.items_json, kcal=excluded.kcal, status=excluded.status, actual_note=excluded.actual_note, updated_at=excluded.updated_at`,
			x.Date, x.Slot, x.ItemsJSON, x.Kcal, x.Status, x.Note, x.UpdatedAt); err != nil {
			serverErr(w, err)
			return
		}
	}

	if _, err := tx.Exec(`DELETE FROM glucose_log`); err != nil {
		serverErr(w, err)
		return
	}
	for _, x := range b.Glucose {
		if x.Mmol < 1 || x.Mmol > 40 || !validDate(x.Date) {
			continue
		}
		if _, err := tx.Exec(`INSERT INTO glucose_log(ts,date,mmol,ctx) VALUES(?,?,?,?)`, x.Ts, x.Date, x.Mmol, x.Ctx); err != nil {
			serverErr(w, err)
			return
		}
	}

	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

// ---------- Web Push (VAPID) & Nhắc nhở ----------

func (s *Server) vapidKeys() (priv, pub string, err error) {
	err1 := s.db.QueryRow(`SELECT value FROM settings WHERE key='_vapid_priv'`).Scan(&priv)
	err2 := s.db.QueryRow(`SELECT value FROM settings WHERE key='_vapid_pub'`).Scan(&pub)
	if err1 == nil && err2 == nil && priv != "" && pub != "" {
		return priv, pub, nil
	}
	priv, pub, err = webpush.GenerateVAPIDKeys()
	if err != nil {
		return "", "", err
	}
	_, _ = s.db.Exec(`INSERT INTO settings(key,value) VALUES('_vapid_priv',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, priv)
	_, _ = s.db.Exec(`INSERT INTO settings(key,value) VALUES('_vapid_pub',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, pub)
	return priv, pub, nil
}

func (s *Server) handlePushKey(w http.ResponseWriter, r *http.Request) {
	_, pub, err := s.vapidKeys()
	if err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]string{"publicKey": pub})
}

func (s *Server) handlePushSubscribe(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Endpoint string `json:"endpoint"`
		Keys     struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if in.Endpoint == "" || in.Keys.P256dh == "" || in.Keys.Auth == "" {
		httpErr(w, 400, "subscription thiếu thông tin")
		return
	}
	if _, err := s.db.Exec(`INSERT INTO push_sub(endpoint,p256dh,auth) VALUES(?,?,?)
		ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth`,
		in.Endpoint, in.Keys.P256dh, in.Keys.Auth); err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) handlePushTest(w http.ResponseWriter, r *http.Request) {
	sent, err := s.sendPush("QuyenHealth 🔔", "Thông báo thử thành công! Nhắc nhở đã hoạt động.", "/")
	if err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "sent": sent})
}

func (s *Server) sendPush(title, body, url string) (int, error) {
	priv, pub, err := s.vapidKeys()
	if err != nil {
		return 0, err
	}
	rows, err := s.db.Query(`SELECT endpoint, p256dh, auth FROM push_sub`)
	if err != nil {
		return 0, err
	}
	type subRow struct{ ep, p256dh, auth string }
	var subs []subRow
	for rows.Next() {
		var x subRow
		if rows.Scan(&x.ep, &x.p256dh, &x.auth) == nil {
			subs = append(subs, x)
		}
	}
	rows.Close()
	if len(subs) == 0 {
		return 0, nil
	}
	payload, _ := json.Marshal(map[string]string{"title": title, "body": body, "url": url})
	sub := s.cfg.VapidSubject
	if sub == "" {
		sub = "mailto:quyenhealth@example.com"
	}
	sent := 0
	for _, x := range subs {
		resp, err := webpush.SendNotification(payload, &webpush.Subscription{
			Endpoint: x.ep,
			Keys:     webpush.Keys{P256dh: x.p256dh, Auth: x.auth},
		}, &webpush.Options{
			Subscriber:      sub,
			VAPIDPublicKey:  pub,
			VAPIDPrivateKey: priv,
			TTL:             3600,
		})
		if err != nil {
			log.Printf("push lỗi: %v", err)
			continue
		}
		code := resp.StatusCode
		_ = resp.Body.Close()
		if code == http.StatusGone || code == http.StatusNotFound {
			_, _ = s.db.Exec(`DELETE FROM push_sub WHERE endpoint=?`, x.ep)
			continue
		}
		if code >= 200 && code < 300 {
			sent++
		}
	}
	return sent, nil
}

// handleTick dùng cho cron bên ngoài (cron-job.org / UptimeRobot) ping giữ/đánh thức Koyeb
// và kích hoạt kiểm tra nhắc nhở.
func (s *Server) handleTick(w http.ResponseWriter, r *http.Request) {
	if s.cfg.TickToken != "" {
		tok := r.URL.Query().Get("token")
		if tok == "" {
			tok = r.Header.Get("X-Tick-Token")
		}
		if subtle.ConstantTimeCompare([]byte(tok), []byte(s.cfg.TickToken)) != 1 && !s.authed(r) {
			httpErr(w, http.StatusUnauthorized, "sai tick token")
			return
		}
	}
	triggered := s.tick(s.now())
	writeJSON(w, 200, map[string]any{"ok": true, "triggered": triggered, "date": s.today()})
}

func (s *Server) markNotified(key string, now time.Time) bool {
	var ts int64
	if err := s.db.QueryRow(`SELECT ts FROM notif_log WHERE key=?`, key).Scan(&ts); err == nil {
		return false
	}
	_, err := s.db.Exec(`INSERT OR IGNORE INTO notif_log(key,ts) VALUES(?,?)`, key, now.Unix())
	return err == nil
}

// reachedHM kiểm tra hiện tại đã qua giờ hm ("HH:MM") trong ngày và không trễ quá 90 phút.
func reachedHM(nowVN time.Time, hm string) bool {
	t, err := time.Parse("15:04", hm)
	if err != nil {
		return false
	}
	cur := nowVN.Hour()*60 + nowVN.Minute()
	due := t.Hour()*60 + t.Minute()
	return cur >= due && cur <= due+90
}

func (s *Server) tick(now time.Time) []string {
	set := s.settings()
	if set["remind_on"] != "1" {
		return nil
	}
	nowVN := now.In(s.loc)
	date := nowVN.Format("2006-01-02")
	var fired []string

	// Dọn notif_log cũ hơn 7 ngày
	_, _ = s.db.Exec(`DELETE FROM notif_log WHERE ts < ?`, now.Add(-7*24*time.Hour).Unix())

	// 1. Nhắc đo cân nặng buổi sáng
	if reachedHM(nowVN, set["t_weight"]) {
		var kg float64
		if err := s.db.QueryRow(`SELECT kg FROM weight_log WHERE date=?`, date).Scan(&kg); err != nil {
			key := date + "|weight"
			if s.markNotified(key, now) {
				_, _ = s.sendPush("⚖️ Đo cân buổi sáng", "Quyền ơi, nhớ bước lên cân trước khi ăn sáng nhé!", "/#weight")
				fired = append(fired, key)
			}
		}
	}

	// 2. Nhắc uống thuốc lần 1 & lần 2
	if !s.medTaken(date) {
		if reachedHM(nowVN, set["t_med"]) {
			key := date + "|med1"
			if s.markNotified(key, now) {
				_, _ = s.sendPush("💊 Nhắc uống thuốc", "Đến giờ uống thuốc hôm nay rồi Quyền ơi!", "/")
				fired = append(fired, key)
			}
		} else if reachedHM(nowVN, set["t_med2"]) {
			key := date + "|med2"
			if s.markNotified(key, now) {
				_, _ = s.sendPush("💊 Chưa tích uống thuốc", "Hôm nay Quyền đã uống thuốc chưa? Nhớ bấm xác nhận nhé.", "/")
				fired = append(fired, key)
			}
		}
	}

	// 3. Nhắc uống nước theo mốc giờ trong ngày (10h, 14h, 17h, 20h)
	_, waterTotal := s.waterEntries(date)
	waterMin := int(fnum(set, "water_min"))
	if waterMin <= 0 {
		waterMin = 2500
	}
	waterChecks := []struct {
		hm    string
		ratio float64
	}{
		{"10:00", 0.25},
		{"14:00", 0.50},
		{"17:00", 0.75},
		{"20:00", 0.92},
	}
	for _, wc := range waterChecks {
		need := int(float64(waterMin) * wc.ratio)
		if reachedHM(nowVN, wc.hm) && waterTotal < need {
			key := fmt.Sprintf("%s|water_%s", date, wc.hm)
			if s.markNotified(key, now) {
				msg := fmt.Sprintf("Mới uống %d/%dml hôm nay. Làm thêm 1 cốc nước lọc nhé!", waterTotal, waterMin)
				_, _ = s.sendPush("💧 Uống thêm nước lọc", msg, "/")
				fired = append(fired, key)
			}
		}
	}

	// 4. Nhắc đi ngủ sớm (hạn chế thức khuya - gan nhiễm mỡ)
	if reachedHM(nowVN, set["t_sleep"]) {
		key := date + "|sleep"
		if s.markNotified(key, now) {
			_, _ = s.sendPush("🌙 Đến giờ nghỉ ngơi", "Bác sĩ dặn hạn chế thức khuya để tốt cho gan. Chuẩn bị đi ngủ thôi Quyền ơi!", "/")
			fired = append(fired, key)
		}
	}

	return fired
}

