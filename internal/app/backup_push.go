package app

import (
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/SherClockHolmes/webpush-go"
	"quyenhealth/internal/meals"
)

// ---------- Sao lưu & Khôi phục JSON ----------

type backupData struct {
	Version    int                `json:"version"`
	ExportAt   int64              `json:"export_at"`
	Settings   map[string]string  `json:"settings"`
	Water      []backupWater      `json:"water"`
	Weight     []backupWeight     `json:"weight"`
	Med        []backupMed        `json:"med"`
	Meals      []backupMeal       `json:"meals"`
	Glucose    []backupGlucose    `json:"glucose"`
	WorkJobs   []backupWorkJob    `json:"work_jobs,omitempty"`
	WorkLedger []backupWorkLedger `json:"work_ledger,omitempty"`
}

type backupWorkJob struct {
	Date     string `json:"date"`
	Customer string `json:"customer"`
	Channel  string `json:"channel"`
	Service  string `json:"service"`
	Price    int    `json:"price"`
	Status   string `json:"status"`
	Note     string `json:"note"`
	Ts       int64  `json:"ts"`
}

type backupWorkLedger struct {
	Date     string `json:"date"`
	Category string `json:"category"`
	Amount   int    `json:"amount"`
	Note     string `json:"note"`
	Ts       int64  `json:"ts"`
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

	if rows, err := s.db.Query(`SELECT date, customer, channel, service, price, status, note, ts FROM work_jobs ORDER BY date, id`); err == nil {
		for rows.Next() {
			var x backupWorkJob
			if rows.Scan(&x.Date, &x.Customer, &x.Channel, &x.Service, &x.Price, &x.Status, &x.Note, &x.Ts) == nil {
				b.WorkJobs = append(b.WorkJobs, x)
			}
		}
		rows.Close()
	}

	if rows, err := s.db.Query(`SELECT date, category, amount, note, ts FROM work_ledger ORDER BY date, id`); err == nil {
		for rows.Next() {
			var x backupWorkLedger
			if rows.Scan(&x.Date, &x.Category, &x.Amount, &x.Note, &x.Ts) == nil {
				b.WorkLedger = append(b.WorkLedger, x)
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

	if b.WorkJobs != nil {
		if _, err := tx.Exec(`DELETE FROM work_jobs`); err != nil {
			serverErr(w, err)
			return
		}
		for _, x := range b.WorkJobs {
			if !validDate(x.Date) || strings.TrimSpace(x.Customer) == "" || strings.TrimSpace(x.Service) == "" || x.Price <= 0 {
				continue
			}
			if _, err := tx.Exec(`INSERT INTO work_jobs(date,customer,channel,service,price,status,note,ts) VALUES(?,?,?,?,?,?,?,?)`,
				x.Date, strings.TrimSpace(x.Customer), validChannel(x.Channel), strings.TrimSpace(x.Service), normalizeVND(x.Price), validJobStatus(x.Status), x.Note, x.Ts); err != nil {
				serverErr(w, err)
				return
			}
		}
	}

	if b.WorkLedger != nil {
		if _, err := tx.Exec(`DELETE FROM work_ledger`); err != nil {
			serverErr(w, err)
			return
		}
		for _, x := range b.WorkLedger {
			if !validDate(x.Date) || !validLedgerCategory(x.Category) || x.Amount <= 0 {
				continue
			}
			if _, err := tx.Exec(`INSERT INTO work_ledger(date,category,amount,note,ts) VALUES(?,?,?,?,?)`,
				x.Date, x.Category, normalizeVND(x.Amount), x.Note, x.Ts); err != nil {
				serverErr(w, err)
				return
			}
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

type pushResult struct {
	Sent      int    `json:"sent"`
	Total     int    `json:"total"`
	LastCode  int    `json:"status"`
	LastError string `json:"error,omitempty"`
}

func (s *Server) handlePushTest(w http.ResponseWriter, r *http.Request) {
	res, err := s.sendPushDetailed("QuyenHealth", "Thông báo thử thành công! Nhắc nhở sức khoẻ hoạt động tốt.", "/")
	if err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{
		"ok":     true,
		"sent":   res.Sent,
		"total":  res.Total,
		"status": res.LastCode,
		"error":  res.LastError,
	})
}

func (s *Server) sendPushDetailed(title, body, url string) (pushResult, error) {
	var res pushResult
	priv, pub, err := s.vapidKeys()
	if err != nil {
		return res, err
	}
	rows, err := s.db.Query(`SELECT endpoint, p256dh, auth FROM push_sub`)
	if err != nil {
		return res, err
	}
	defer rows.Close()

	type subRow struct{ ep, p256dh, auth string }
	var subs []subRow
	for rows.Next() {
		var x subRow
		if rows.Scan(&x.ep, &x.p256dh, &x.auth) == nil {
			subs = append(subs, x)
		}
	}
	res.Total = len(subs)
	if len(subs) == 0 {
		return res, nil
	}
	payload, _ := json.Marshal(map[string]string{"title": title, "body": body, "url": url})
	sub := s.cfg.VapidSubject
	if sub == "" {
		sub = "quyenhealth.app@gmail.com"
	} else {
		sub = strings.TrimPrefix(sub, "mailto:")
	}
	for _, x := range subs {
		resp, err := webpush.SendNotification(payload, &webpush.Subscription{
			Endpoint: x.ep,
			Keys:     webpush.Keys{P256dh: x.p256dh, Auth: x.auth},
		}, &webpush.Options{
			Subscriber:      sub,
			VAPIDPublicKey:  pub,
			VAPIDPrivateKey: priv,
			TTL:             3600,
			Urgency:         webpush.UrgencyHigh,
		})
		if err != nil {
			res.LastError = err.Error()
			log.Printf("[PUSH ERROR] ep=%s: %v", x.ep, err)
			continue
		}
		code := resp.StatusCode
		bodyBytes, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		res.LastCode = code

		if code >= 200 && code < 300 {
			res.Sent++
			log.Printf("[PUSH SUCCESS] code=%d ep=%s", code, x.ep)
		} else {
			res.LastError = strings.TrimSpace(string(bodyBytes))
			log.Printf("[PUSH FAIL] code=%d body=%s ep=%s", code, res.LastError, x.ep)
			if code == http.StatusGone || code == http.StatusNotFound {
				_, _ = s.db.Exec(`DELETE FROM push_sub WHERE endpoint=?`, x.ep)
			}
		}
	}
	return res, nil
}

func (s *Server) sendPush(title, body, url string) (int, error) {
	res, err := s.sendPushDetailed(title, body, url)
	return res.Sent, err
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

func parseHMList(raw, fallback string) []string {
	s := strings.TrimSpace(raw)
	if s == "" {
		s = strings.TrimSpace(fallback)
	}
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	var out []string
	seen := map[string]bool{}
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if validHM(p) && !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	sort.Strings(out)
	return out
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

	// 1. Nhắc đo cân nặng buổi sáng (hỗ trợ nhiều mốc tự chọn)
	weightTimes := parseHMList(set["remind_weight_times"], set["t_weight"])
	for i, hm := range weightTimes {
		if reachedHM(nowVN, hm) {
			var kg float64
			if err := s.db.QueryRow(`SELECT kg FROM weight_log WHERE date=?`, date).Scan(&kg); err != nil {
				key := fmt.Sprintf("%s|weight_%s", date, hm)
				if s.markNotified(key, now) {
					msg := "Quyền ơi, nhớ bước lên cân trước khi ăn sáng nhé!"
					if i > 0 {
						msg = fmt.Sprintf("Mốc nhắc %s: Quyền chưa ghi nhận cân nặng hôm nay, nhớ cân và lưu nhé!", hm)
					}
					_, _ = s.sendPush("Đo cân buổi sáng", msg, "/#weight")
					fired = append(fired, key)
				}
			}
		}
	}

	// 2. Nhắc uống thuốc (hỗ trợ nhiều mốc tự chọn)
	fallbackMed := set["t_med"]
	if set["t_med2"] != "" {
		fallbackMed += "," + set["t_med2"]
	}
	medTimes := parseHMList(set["remind_med_times"], fallbackMed)
	if !s.medTaken(date) {
		for i, hm := range medTimes {
			if reachedHM(nowVN, hm) {
				key := fmt.Sprintf("%s|med_%s", date, hm)
				if s.markNotified(key, now) {
					msg := "Đến giờ uống thuốc hôm nay rồi Quyền ơi!"
					if i > 0 {
						msg = fmt.Sprintf("Mốc nhắc %s: Quyền đã uống thuốc chưa? Nhớ bấm xác nhận nhé.", hm)
					}
					_, _ = s.sendPush("Nhắc uống thuốc", msg, "/")
					fired = append(fired, key)
				}
			}
		}
	}

	// 3. Nhắc uống nước theo các mốc giờ tự chọn
	waterTimes := parseHMList(set["remind_water_times"], "10:00,14:00,17:00,20:00")
	_, waterTotal := s.waterEntries(date)
	waterMin := int(fnum(set, "water_min"))
	if waterMin <= 0 {
		waterMin = 2500
	}
	numWaterTimes := len(waterTimes)
	if numWaterTimes > 0 {
		for i, hm := range waterTimes {
			ratio := float64(i+1) / float64(numWaterTimes)
			if ratio > 0.92 {
				ratio = 0.92
			}
			need := int(float64(waterMin) * ratio)
			if reachedHM(nowVN, hm) && waterTotal < need {
				key := fmt.Sprintf("%s|water_%s", date, hm)
				if s.markNotified(key, now) {
					msg := fmt.Sprintf("Mới uống %d/%dml hôm nay. Làm thêm 1 cốc nước lọc nhé!", waterTotal, waterMin)
					_, _ = s.sendPush("Uống thêm nước lọc", msg, "/")
					fired = append(fired, key)
				}
			}
		}
	}

	// 4. Nhắc đi ngủ sớm (hỗ trợ nhiều mốc tự chọn)
	sleepTimes := parseHMList(set["remind_sleep_times"], set["t_sleep"])
	for i, hm := range sleepTimes {
		if reachedHM(nowVN, hm) {
			key := fmt.Sprintf("%s|sleep_%s", date, hm)
			if s.markNotified(key, now) {
				msg := "Bác sĩ dặn hạn chế thức khuya để tốt cho gan. Chuẩn bị đi ngủ thôi Quyền ơi!"
				if i > 0 {
					msg = fmt.Sprintf("Mốc nhắc %s: Đã muộn rồi, Quyền hãy nghỉ ngơi và đi ngủ để bảo vệ gan nhé.", hm)
				}
				_, _ = s.sendPush("Đến giờ nghỉ ngơi", msg, "/")
				fired = append(fired, key)
			}
		}
	}

	return fired
}

