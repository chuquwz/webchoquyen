package app

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type workJob struct {
	ID       int64  `json:"id"`
	Date     string `json:"date"`
	Customer string `json:"customer"`
	Channel  string `json:"channel"`
	Service  string `json:"service"`
	Price    int    `json:"price"`
	Status   string `json:"status"` // "TT" hoặc "CTT"
	Note     string `json:"note"`
	Ts       int64  `json:"ts"`
}

type workLedger struct {
	ID       int64  `json:"id"`
	Date     string `json:"date"`
	Category string `json:"category"` // "expense" | "fund_in" | "fund_bal" | "borrow" | "repay"
	Amount   int    `json:"amount"`
	Note     string `json:"note"`
	Ts       int64  `json:"ts"`
}

type workSummary struct {
	TotalJobs     int `json:"total_jobs"`
	PaidJobs      int `json:"paid_jobs"`
	UnpaidJobs    int `json:"unpaid_jobs"`
	TotalRevenue  int `json:"total_revenue"`
	PaidAmount    int `json:"paid_amount"`
	UnpaidAmount  int `json:"unpaid_amount"`
	ExpenseAmount int `json:"expense_amount"`
	NetCash       int `json:"net_cash"`
	FundIn        int `json:"fund_in"`
	FundBal       int `json:"fund_bal"`
	BorrowAmount  int `json:"borrow_amount"`
	RepayAmount   int `json:"repay_amount"`
}

type unpaidCustomerGroup struct {
	Customer    string    `json:"customer"`
	Channel     string    `json:"channel"`
	JobCount    int       `json:"job_count"`
	TotalAmount int       `json:"total_amount"`
	Jobs        []workJob `json:"jobs"`
}

type workDayBrief struct {
	Date          string `json:"date"`
	JobCount      int    `json:"job_count"`
	TotalRevenue  int    `json:"total_revenue"`
	PaidAmount    int    `json:"paid_amount"`
	UnpaidAmount  int    `json:"unpaid_amount"`
	ExpenseAmount int    `json:"expense_amount"`
}

type servicePreset struct {
	Service string `json:"service"`
	Price   int    `json:"price"`
}

var defaultCustomers = []string{
	"Điện Thoại Nguyên Trường",
	"Thành Điện Thoại",
	"Bh Mobile",
	"Lường Văn Tiến",
	"Phan Thế Anh",
	"Chủ",
	"Trọng Thảo",
	"Dũng Mobile",
	"Đức Hiển",
	"Táo Service",
	"Dương Vũ",
}

var defaultServicePresets = []servicePreset{
	{Service: "FIX VOLTE OPPO ", Price: 70000},
	{Service: "FRP OPPO ", Price: 100000},
	{Service: "FRP SS ", Price: 100000},
	{Service: "BYPASS HELLO IP ", Price: 150000},
	{Service: "BYPASS MDM ", Price: 200000},
	{Service: "HIDE ", Price: 350000},
	{Service: "OFF MI CLOUD", Price: 250000},
	{Service: "UP VƯỢT QUYỀN ", Price: 350000},
}

func validMonth(m string) bool {
	if len(m) != 7 || m[4] != '-' {
		return false
	}
	_, err := strconv.Atoi(m[:4])
	if err != nil {
		return false
	}
	mo, err := strconv.Atoi(m[5:7])
	return err == nil && mo >= 1 && mo <= 12
}

func normalizeVND(amount int) int {
	if amount > 0 && amount < 1000 {
		return amount * 1000
	}
	return amount
}

func validChannel(ch string) string {
	switch strings.ToUpper(strings.TrimSpace(ch)) {
	case "FB":
		return "FB"
	case "KHAC":
		return "KHAC"
	default:
		return "ZL"
	}
}

func validJobStatus(st string) string {
	if strings.ToUpper(strings.TrimSpace(st)) == "CTT" {
		return "CTT"
	}
	return "TT"
}

func validLedgerCategory(cat string) bool {
	switch cat {
	case "expense", "fund_in", "fund_bal", "borrow", "repay":
		return true
	}
	return false
}

func categoryLabelVN(cat string) string {
	switch cat {
	case "expense":
		return "Chi tiêu / Phát sinh"
	case "fund_in":
		return "Nộp Quỹ"
	case "fund_bal":
		return "Số Quỹ"
	case "borrow":
		return "Mượn"
	case "repay":
		return "Trả Nợ"
	default:
		return cat
	}
}

func (s *Server) queryWorkJobsByDate(date string) ([]workJob, error) {
	rows, err := s.db.Query(`SELECT id, date, customer, channel, service, price, status, note, ts FROM work_jobs WHERE date=? ORDER BY id ASC`, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []workJob{}
	for rows.Next() {
		var j workJob
		if err := rows.Scan(&j.ID, &j.Date, &j.Customer, &j.Channel, &j.Service, &j.Price, &j.Status, &j.Note, &j.Ts); err != nil {
			return nil, err
		}
		out = append(out, j)
	}
	return out, rows.Err()
}

func (s *Server) queryWorkLedgerByDate(date string) ([]workLedger, error) {
	rows, err := s.db.Query(`SELECT id, date, category, amount, note, ts FROM work_ledger WHERE date=? ORDER BY id ASC`, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []workLedger{}
	for rows.Next() {
		var l workLedger
		if err := rows.Scan(&l.ID, &l.Date, &l.Category, &l.Amount, &l.Note, &l.Ts); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func (s *Server) computeWorkSummary(datePrefix string, exactDate bool) workSummary {
	var sum workSummary
	var jobWhere string
	var arg string
	if exactDate {
		jobWhere = `WHERE date = ?`
		arg = datePrefix
	} else {
		jobWhere = `WHERE date LIKE ?`
		arg = datePrefix + "-%"
	}

	rows, err := s.db.Query(`SELECT price, status FROM work_jobs `+jobWhere, arg)
	if err == nil {
		for rows.Next() {
			var price int
			var status string
			if rows.Scan(&price, &status) == nil {
				sum.TotalJobs++
				sum.TotalRevenue += price
				if status == "CTT" {
					sum.UnpaidJobs++
					sum.UnpaidAmount += price
				} else {
					sum.PaidJobs++
					sum.PaidAmount += price
				}
			}
		}
		rows.Close()
	}

	lrows, err := s.db.Query(`SELECT category, amount FROM work_ledger `+jobWhere+` ORDER BY id ASC`, arg)
	if err == nil {
		for lrows.Next() {
			var cat string
			var amt int
			if lrows.Scan(&cat, &amt) == nil {
				switch cat {
				case "expense":
					sum.ExpenseAmount += amt
				case "fund_in":
					sum.FundIn += amt
				case "fund_bal":
					sum.FundBal = amt // Số dư quỹ lấy bản ghi cập nhật mới nhất
				case "borrow":
					sum.BorrowAmount += amt
				case "repay":
					sum.RepayAmount += amt
				}
			}
		}
		lrows.Close()
	}

	sum.NetCash = sum.PaidAmount - sum.ExpenseAmount
	return sum
}

func (s *Server) queryUnpaidGroups() ([]unpaidCustomerGroup, int, int) {
	rows, err := s.db.Query(`SELECT id, date, customer, channel, service, price, status, note, ts FROM work_jobs WHERE status='CTT' ORDER BY date DESC, id DESC`)
	if err != nil {
		return []unpaidCustomerGroup{}, 0, 0
	}
	defer rows.Close()

	byKey := map[string]*unpaidCustomerGroup{}
	var orderKeys []string
	totalUnpaidAll := 0
	totalUnpaidJobs := 0

	for rows.Next() {
		var j workJob
		if rows.Scan(&j.ID, &j.Date, &j.Customer, &j.Channel, &j.Service, &j.Price, &j.Status, &j.Note, &j.Ts) != nil {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(j.Customer))
		g, ok := byKey[key]
		if !ok {
			g = &unpaidCustomerGroup{
				Customer: j.Customer,
				Channel:  j.Channel,
				Jobs:     []workJob{},
			}
			byKey[key] = g
			orderKeys = append(orderKeys, key)
		}
		g.JobCount++
		g.TotalAmount += j.Price
		g.Jobs = append(g.Jobs, j)
		totalUnpaidAll += j.Price
		totalUnpaidJobs++
	}

	out := make([]unpaidCustomerGroup, 0, len(orderKeys))
	for _, k := range orderKeys {
		out = append(out, *byKey[k])
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].TotalAmount != out[j].TotalAmount {
			return out[i].TotalAmount > out[j].TotalAmount
		}
		return out[i].Customer < out[j].Customer
	})
	return out, totalUnpaidAll, totalUnpaidJobs
}

func (s *Server) queryMonthDaysBrief(month string) []workDayBrief {
	likeArg := month + "-%"
	byDate := map[string]*workDayBrief{}

	rows, err := s.db.Query(`SELECT date, price, status FROM work_jobs WHERE date LIKE ?`, likeArg)
	if err == nil {
		for rows.Next() {
			var d, st string
			var p int
			if rows.Scan(&d, &p, &st) == nil {
				b := byDate[d]
				if b == nil {
					b = &workDayBrief{Date: d}
					byDate[d] = b
				}
				b.JobCount++
				b.TotalRevenue += p
				if st == "CTT" {
					b.UnpaidAmount += p
				} else {
					b.PaidAmount += p
				}
			}
		}
		rows.Close()
	}

	lrows, err := s.db.Query(`SELECT date, amount FROM work_ledger WHERE date LIKE ? AND category='expense'`, likeArg)
	if err == nil {
		for lrows.Next() {
			var d string
			var amt int
			if lrows.Scan(&d, &amt) == nil {
				b := byDate[d]
				if b == nil {
					b = &workDayBrief{Date: d}
					byDate[d] = b
				}
				b.ExpenseAmount += amt
			}
		}
		lrows.Close()
	}

	out := make([]workDayBrief, 0, len(byDate))
	for _, b := range byDate {
		out = append(out, *b)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Date > out[j].Date
	})
	return out
}

func (s *Server) workSuggestions() ([]string, []servicePreset) {
	seenCust := map[string]bool{}
	customers := []string{}

	rows, err := s.db.Query(`SELECT customer, COUNT(*) as cnt FROM work_jobs GROUP BY customer ORDER BY cnt DESC, MAX(ts) DESC LIMIT 18`)
	if err == nil {
		for rows.Next() {
			var c string
			var cnt int
			if rows.Scan(&c, &cnt) == nil && c != "" {
				key := strings.ToLower(strings.TrimSpace(c))
				if !seenCust[key] {
					seenCust[key] = true
					customers = append(customers, c)
				}
			}
		}
		rows.Close()
	}
	for _, dc := range defaultCustomers {
		if len(customers) >= 16 {
			break
		}
		key := strings.ToLower(strings.TrimSpace(dc))
		if !seenCust[key] {
			seenCust[key] = true
			customers = append(customers, dc)
		}
	}

	seenSvc := map[string]bool{}
	services := []servicePreset{}
	srows, err := s.db.Query(`SELECT service, price FROM work_jobs GROUP BY service ORDER BY COUNT(*) DESC, MAX(ts) DESC LIMIT 12`)
	if err == nil {
		for srows.Next() {
			var sv string
			var pr int
			if srows.Scan(&sv, &pr) == nil && sv != "" {
				key := strings.ToLower(strings.TrimSpace(sv))
				if !seenSvc[key] {
					seenSvc[key] = true
					services = append(services, servicePreset{Service: sv, Price: pr})
				}
			}
		}
		srows.Close()
	}
	for _, dp := range defaultServicePresets {
		if len(services) >= 12 {
			break
		}
		key := strings.ToLower(strings.TrimSpace(dp.Service))
		if !seenSvc[key] {
			seenSvc[key] = true
			services = append(services, dp)
		}
	}

	return customers, services
}

// GET /api/work
func (s *Server) handleGetWork(w http.ResponseWriter, r *http.Request) {
	date := r.URL.Query().Get("date")
	if date == "" || !validDate(date) {
		date = s.today()
	}
	month := r.URL.Query().Get("month")
	if !validMonth(month) {
		month = date[:7]
	}

	jobs, err := s.queryWorkJobsByDate(date)
	if err != nil {
		serverErr(w, err)
		return
	}
	ledger, err := s.queryWorkLedgerByDate(date)
	if err != nil {
		serverErr(w, err)
		return
	}

	daySum := s.computeWorkSummary(date, true)
	monthSum := s.computeWorkSummary(month, false)
	unpaidGroups, totalUnpaidAll, totalUnpaidJobs := s.queryUnpaidGroups()
	recentDays := s.queryMonthDaysBrief(month)
	customers, services := s.workSuggestions()
	allJobs := s.queryAllWorkJobs()
	allLedger := s.queryAllWorkLedger()

	writeJSON(w, 200, map[string]any{
		"ok":                true,
		"db_id":             s.dbInstanceID(),
		"date":              date,
		"month":             month,
		"today":             s.today(),
		"jobs":              jobs,
		"ledger":            ledger,
		"day_summary":       daySum,
		"month_summary":     monthSum,
		"unpaid_groups":     unpaidGroups,
		"total_unpaid_all":  totalUnpaidAll,
		"total_unpaid_jobs": totalUnpaidJobs,
		"recent_days":       recentDays,
		"vault_jobs":        allJobs,
		"vault_ledger":      allLedger,
		"suggestions": map[string]any{
			"customers": customers,
			"services":  services,
		},
	})
}

// POST /api/work/job
func (s *Server) handlePostWorkJob(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Date     string `json:"date"`
		Customer string `json:"customer"`
		Channel  string `json:"channel"`
		Service  string `json:"service"`
		Price    int    `json:"price"`
		Status   string `json:"status"`
		Note     string `json:"note"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if in.Date == "" {
		in.Date = s.today()
	}
	if !validDate(in.Date) {
		httpErr(w, 400, "Ngày không hợp lệ (YYYY-MM-DD)")
		return
	}
	cust := strings.TrimSpace(in.Customer)
	if cust == "" || utf8.RuneCountInString(cust) > 100 {
		httpErr(w, 400, "Nhập tên khách hàng (tối đa 100 ký tự)")
		return
	}
	svc := strings.TrimSpace(in.Service)
	if svc == "" || utf8.RuneCountInString(svc) > 150 {
		httpErr(w, 400, "Nhập tên dịch vụ / dòng máy (tối đa 150 ký tự)")
		return
	}
	price := normalizeVND(in.Price)
	if price < 1000 || price > 200000000 {
		httpErr(w, 400, "Giá tiền phải từ 1.000đ đến 200.000.000đ")
		return
	}
	note := strings.TrimSpace(in.Note)
	if utf8.RuneCountInString(note) > 300 {
		httpErr(w, 400, "Ghi chú tối đa 300 ký tự")
		return
	}
	ch := validChannel(in.Channel)
	st := validJobStatus(in.Status)

	res, err := s.db.Exec(
		`INSERT INTO work_jobs(date, customer, channel, service, price, status, note, ts) VALUES(?,?,?,?,?,?,?,?)`,
		in.Date, cust, ch, svc, price, st, note, s.now().Unix(),
	)
	if err != nil {
		serverErr(w, err)
		return
	}
	id, _ := res.LastInsertId()
	writeJSON(w, 200, map[string]any{"ok": true, "id": id})
}

// PUT /api/work/job/{id}
func (s *Server) handlePutWorkJob(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		httpErr(w, 400, "Mã đơn không hợp lệ")
		return
	}
	var in struct {
		Date     *string `json:"date"`
		Customer *string `json:"customer"`
		Channel  *string `json:"channel"`
		Service  *string `json:"service"`
		Price    *int    `json:"price"`
		Status   *string `json:"status"`
		Note     *string `json:"note"`
	}
	if !readJSON(w, r, &in) {
		return
	}

	var cur workJob
	err = s.db.QueryRow(`SELECT id, date, customer, channel, service, price, status, note, ts FROM work_jobs WHERE id=?`, id).
		Scan(&cur.ID, &cur.Date, &cur.Customer, &cur.Channel, &cur.Service, &cur.Price, &cur.Status, &cur.Note, &cur.Ts)
	if err != nil {
		httpErr(w, 404, "Không tìm thấy đơn dịch vụ này")
		return
	}

	if in.Date != nil && *in.Date != "" {
		if !validDate(*in.Date) {
			httpErr(w, 400, "Ngày không hợp lệ")
			return
		}
		cur.Date = *in.Date
	}
	if in.Customer != nil {
		c := strings.TrimSpace(*in.Customer)
		if c == "" || utf8.RuneCountInString(c) > 100 {
			httpErr(w, 400, "Tên khách hàng không hợp lệ")
			return
		}
		cur.Customer = c
	}
	if in.Channel != nil {
		cur.Channel = validChannel(*in.Channel)
	}
	if in.Service != nil {
		sv := strings.TrimSpace(*in.Service)
		if sv == "" || utf8.RuneCountInString(sv) > 150 {
			httpErr(w, 400, "Tên dịch vụ không hợp lệ")
			return
		}
		cur.Service = sv
	}
	if in.Price != nil {
		p := normalizeVND(*in.Price)
		if p < 1000 || p > 200000000 {
			httpErr(w, 400, "Giá tiền không hợp lệ")
			return
		}
		cur.Price = p
	}
	if in.Status != nil {
		cur.Status = validJobStatus(*in.Status)
	}
	if in.Note != nil {
		n := strings.TrimSpace(*in.Note)
		if utf8.RuneCountInString(n) > 300 {
			httpErr(w, 400, "Ghi chú tối đa 300 ký tự")
			return
		}
		cur.Note = n
	}

	if _, err := s.db.Exec(
		`UPDATE work_jobs SET date=?, customer=?, channel=?, service=?, price=?, status=?, note=? WHERE id=?`,
		cur.Date, cur.Customer, cur.Channel, cur.Service, cur.Price, cur.Status, cur.Note, id,
	); err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "job": cur})
}

// DELETE /api/work/job/{id}
func (s *Server) handleDelWorkJob(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		httpErr(w, 400, "Mã đơn không hợp lệ")
		return
	}
	if _, err := s.db.Exec(`DELETE FROM work_jobs WHERE id=?`, id); err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

// POST /api/work/job/pay-customer
func (s *Server) handlePayCustomerJobs(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Customer string `json:"customer"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	cust := strings.TrimSpace(in.Customer)
	if cust == "" {
		httpErr(w, 400, "Thiếu tên khách hàng")
		return
	}
	res, err := s.db.Exec(`UPDATE work_jobs SET status='TT' WHERE status='CTT' AND LOWER(TRIM(customer)) = LOWER(TRIM(?))`, cust)
	if err != nil {
		serverErr(w, err)
		return
	}
	affected, _ := res.RowsAffected()
	writeJSON(w, 200, map[string]any{"ok": true, "updated": affected})
}

// POST /api/work/ledger
func (s *Server) handlePostWorkLedger(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Date     string `json:"date"`
		Category string `json:"category"`
		Amount   int    `json:"amount"`
		Note     string `json:"note"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if in.Date == "" {
		in.Date = s.today()
	}
	if !validDate(in.Date) {
		httpErr(w, 400, "Ngày không hợp lệ")
		return
	}
	if !validLedgerCategory(in.Category) {
		httpErr(w, 400, "Phân loại thu chi không hợp lệ")
		return
	}
	amt := normalizeVND(in.Amount)
	if amt < 1000 || amt > 500000000 {
		httpErr(w, 400, "Số tiền phải từ 1.000đ đến 500.000.000đ")
		return
	}
	note := strings.TrimSpace(in.Note)
	if utf8.RuneCountInString(note) > 300 {
		httpErr(w, 400, "Nội dung ghi chú tối đa 300 ký tự")
		return
	}
	res, err := s.db.Exec(
		`INSERT INTO work_ledger(date, category, amount, note, ts) VALUES(?,?,?,?,?)`,
		in.Date, in.Category, amt, note, s.now().Unix(),
	)
	if err != nil {
		serverErr(w, err)
		return
	}
	id, _ := res.LastInsertId()
	writeJSON(w, 200, map[string]any{"ok": true, "id": id})
}

// DELETE /api/work/ledger/{id}
func (s *Server) handleDelWorkLedger(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		httpErr(w, 400, "Mã khoản thu chi không hợp lệ")
		return
	}
	if _, err := s.db.Exec(`DELETE FROM work_ledger WHERE id=?`, id); err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

// GET /api/work/export?month=YYYY-MM
func (s *Server) handleExportWorkCSV(w http.ResponseWriter, r *http.Request) {
	month := r.URL.Query().Get("month")
	if !validMonth(month) {
		month = s.today()[:7]
	}
	likeArg := month + "-%"

	monthSum := s.computeWorkSummary(month, false)
	unpaidGroups, totalUnpaidAll, _ := s.queryUnpaidGroups()

	var buf bytes.Buffer
	// Ghi UTF-8 BOM để Microsoft Excel trên Windows nhận diện đúng Tiếng Việt có dấu
	buf.Write([]byte{0xEF, 0xBB, 0xBF})

	cw := csv.NewWriter(&buf)

	// 1. Tiêu đề & Tổng hợp tháng
	_ = cw.Write([]string{fmt.Sprintf("SỔ CÔNG VIỆC CỦA QUYỀN - THÁNG %s", month)})
	_ = cw.Write([]string{
		"Tổng số đơn", strconv.Itoa(monthSum.TotalJobs),
		"Tổng doanh thu (VNĐ)", strconv.Itoa(monthSum.TotalRevenue),
		"Đã thu TT (VNĐ)", strconv.Itoa(monthSum.PaidAmount),
		"Khách nợ CTT trong tháng (VNĐ)", strconv.Itoa(monthSum.UnpaidAmount),
		"Tổng chi tiêu phát sinh (VNĐ)", strconv.Itoa(monthSum.ExpenseAmount),
		"Thực còn (Đã thu - Chi tiêu)", strconv.Itoa(monthSum.NetCash),
	})
	_ = cw.Write([]string{
		"Nộp Quỹ (VNĐ)", strconv.Itoa(monthSum.FundIn),
		"Số Quỹ gần nhất (VNĐ)", strconv.Itoa(monthSum.FundBal),
		"Mượn (VNĐ)", strconv.Itoa(monthSum.BorrowAmount),
		"Trả Nợ (VNĐ)", strconv.Itoa(monthSum.RepayAmount),
		"Tổng nợ CTT toàn bộ chưa thu (VNĐ)", strconv.Itoa(totalUnpaidAll),
	})
	_ = cw.Write([]string{})

	// 2. Bảng Đơn Dịch Vụ Khách Hàng
	_ = cw.Write([]string{"I. BẢNG ĐƠN DỊCH VỤ KHÁCH HÀNG TRONG THÁNG"})
	_ = cw.Write([]string{"Ngày", "STT Ngày", "Tên Khách Hàng", "FB/ZL", "Dịch Vụ", "Giá Tiền (VNĐ)", "Trạng Thái", "Tổng Kết Ngày (VNĐ)", "Ghi Chú"})

	rows, err := s.db.Query(`SELECT date, customer, channel, service, price, status, note FROM work_jobs WHERE date LIKE ? ORDER BY date ASC, id ASC`, likeArg)
	if err == nil {
		type rowItem struct {
			date, cust, ch, svc, st, note string
			price                         int
		}
		var allRows []rowItem
		dayTotal := map[string]int{}
		for rows.Next() {
			var x rowItem
			if rows.Scan(&x.date, &x.cust, &x.ch, &x.svc, &x.price, &x.st, &x.note) == nil {
				allRows = append(allRows, x)
				dayTotal[x.date] += x.price
			}
		}
		rows.Close()

		curDate := ""
		stt := 0
		for _, x := range allRows {
			daySumStr := ""
			dateCell := ""
			if x.date != curDate {
				curDate = x.date
				stt = 1
				dateCell = x.date
				daySumStr = strconv.Itoa(dayTotal[x.date])
			} else {
				stt++
			}
			_ = cw.Write([]string{
				dateCell,
				strconv.Itoa(stt),
				x.cust,
				x.ch,
				x.svc,
				strconv.Itoa(x.price),
				x.st,
				daySumStr,
				x.note,
			})
		}
	}
	_ = cw.Write([]string{})

	// 3. Bảng Sổ Nợ Khách Hàng (CTT chưa thanh toán)
	_ = cw.Write([]string{"II. SỔ NỢ KHÁCH HÀNG (CÁC ĐƠN CHƯA THANH TOÁN - CTT)"})
	_ = cw.Write([]string{"Tên Khách Hàng", "Kênh", "Ngày Làm", "Dịch Vụ", "Số Tiền Nợ (VNĐ)", "Tổng Nợ Của Khách (VNĐ)"})
	for _, g := range unpaidGroups {
		for idx, j := range g.Jobs {
			custCell := ""
			totCell := ""
			if idx == 0 {
				custCell = g.Customer
				totCell = strconv.Itoa(g.TotalAmount)
			}
			_ = cw.Write([]string{
				custCell,
				j.Channel,
				j.Date,
				j.Service,
				strconv.Itoa(j.Price),
				totCell,
			})
		}
	}
	_ = cw.Write([]string{})

	// 4. Bảng Thu Chi / Phát Sinh / Quỹ / Mượn / Trả Nợ
	_ = cw.Write([]string{"III. BẢNG CHI TIÊU PHÁT SINH, NỘP QUỸ, MƯỢN & TRẢ NỢ TRONG THÁNG"})
	_ = cw.Write([]string{"Ngày", "Phân Loại", "Số Tiền (VNĐ)", "Nội Dung Chi Tiết"})
	lrows, err := s.db.Query(`SELECT date, category, amount, note FROM work_ledger WHERE date LIKE ? ORDER BY date ASC, id ASC`, likeArg)
	if err == nil {
		for lrows.Next() {
			var d, cat, note string
			var amt int
			if lrows.Scan(&d, &cat, &amt, &note) == nil {
				_ = cw.Write([]string{d, categoryLabelVN(cat), strconv.Itoa(amt), note})
			}
		}
		lrows.Close()
	}

	cw.Flush()

	fname := fmt.Sprintf("so-cong-viec-quyen-%s.csv", month)
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, fname))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(200)
	_, _ = w.Write(buf.Bytes())
}

// ---------- Đồng bộ & Lưu trữ dữ liệu tài chính trên máy cá nhân (Chống mất dữ liệu khi Redeploy) ----------

func (s *Server) dbInstanceID() string {
	var id string
	err := s.db.QueryRow(`SELECT value FROM settings WHERE key='_db_instance_id'`).Scan(&id)
	if err == nil && id != "" {
		return id
	}
	id = fmt.Sprintf("db_%d", time.Now().UnixNano())
	_, _ = s.db.Exec(`INSERT INTO settings(key,value) VALUES('_db_instance_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, id)
	return id
}

func (s *Server) queryAllWorkJobs() []workJob {
	rows, err := s.db.Query(`SELECT id, date, customer, channel, service, price, status, note, ts FROM work_jobs ORDER BY date ASC, id ASC`)
	if err != nil {
		return []workJob{}
	}
	defer rows.Close()
	out := []workJob{}
	for rows.Next() {
		var j workJob
		if rows.Scan(&j.ID, &j.Date, &j.Customer, &j.Channel, &j.Service, &j.Price, &j.Status, &j.Note, &j.Ts) == nil {
			out = append(out, j)
		}
	}
	return out
}

func (s *Server) queryAllWorkLedger() []workLedger {
	rows, err := s.db.Query(`SELECT id, date, category, amount, note, ts FROM work_ledger ORDER BY date ASC, id ASC`)
	if err != nil {
		return []workLedger{}
	}
	defer rows.Close()
	out := []workLedger{}
	for rows.Next() {
		var l workLedger
		if rows.Scan(&l.ID, &l.Date, &l.Category, &l.Amount, &l.Note, &l.Ts) == nil {
			out = append(out, l)
		}
	}
	return out
}

// GET /api/work/vault
func (s *Server) handleGetWorkVault(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{
		"ok":     true,
		"db_id":  s.dbInstanceID(),
		"jobs":   s.queryAllWorkJobs(),
		"ledger": s.queryAllWorkLedger(),
	})
}

// POST /api/work/vault
func (s *Server) handleSyncWorkVault(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Mode   string       `json:"mode"` // "replace" hoặc "merge"
		Jobs   []workJob    `json:"jobs"`
		Ledger []workLedger `json:"ledger"`
	}
	if !readJSON(w, r, &in) {
		return
	}

	tx, err := s.db.Begin()
	if err != nil {
		serverErr(w, err)
		return
	}
	defer tx.Rollback()

	mode := strings.ToLower(strings.TrimSpace(in.Mode))
	if mode == "replace" {
		if _, err := tx.Exec(`DELETE FROM work_jobs`); err != nil {
			serverErr(w, err)
			return
		}
		if _, err := tx.Exec(`DELETE FROM work_ledger`); err != nil {
			serverErr(w, err)
			return
		}
		for _, j := range in.Jobs {
			cust := strings.TrimSpace(j.Customer)
			svc := strings.TrimSpace(j.Service)
			price := normalizeVND(j.Price)
			if !validDate(j.Date) || cust == "" || svc == "" || price < 1000 {
				continue
			}
			ts := j.Ts
			if ts <= 0 {
				ts = s.now().Unix()
			}
			if _, err := tx.Exec(
				`INSERT INTO work_jobs(date, customer, channel, service, price, status, note, ts) VALUES(?,?,?,?,?,?,?,?)`,
				j.Date, cust, validChannel(j.Channel), svc, price, validJobStatus(j.Status), strings.TrimSpace(j.Note), ts,
			); err != nil {
				serverErr(w, err)
				return
			}
		}
		for _, l := range in.Ledger {
			amt := normalizeVND(l.Amount)
			if !validDate(l.Date) || !validLedgerCategory(l.Category) || amt < 1000 {
				continue
			}
			ts := l.Ts
			if ts <= 0 {
				ts = s.now().Unix()
			}
			if _, err := tx.Exec(
				`INSERT INTO work_ledger(date, category, amount, note, ts) VALUES(?,?,?,?,?)`,
				l.Date, l.Category, amt, strings.TrimSpace(l.Note), ts,
			); err != nil {
				serverErr(w, err)
				return
			}
		}
	} else {
		// Chế độ "merge" thông minh: khôi phục toàn bộ bản ghi từ máy cá nhân lên server sau khi redeploy mà không tạo bản trùng
		existingJobs := map[string]struct {
			id     int64
			status string
		}{}
		jrows, err := tx.Query(`SELECT id, date, customer, channel, service, price, status, ts FROM work_jobs`)
		if err == nil {
			for jrows.Next() {
				var id, ts int64
				var d, cust, ch, svc, st string
				var pr int
				if jrows.Scan(&id, &d, &cust, &ch, &svc, &pr, &st, &ts) == nil {
					sig := fmt.Sprintf("%s|%s|%s|%s|%d|%d", d, strings.ToLower(strings.TrimSpace(cust)), validChannel(ch), strings.ToLower(strings.TrimSpace(svc)), normalizeVND(pr), ts)
					existingJobs[sig] = struct {
						id     int64
						status string
					}{id: id, status: st}
				}
			}
			jrows.Close()
		}

		for _, j := range in.Jobs {
			cust := strings.TrimSpace(j.Customer)
			svc := strings.TrimSpace(j.Service)
			price := normalizeVND(j.Price)
			if !validDate(j.Date) || cust == "" || svc == "" || price < 1000 {
				continue
			}
			ts := j.Ts
			if ts <= 0 {
				ts = s.now().Unix()
			}
			ch := validChannel(j.Channel)
			st := validJobStatus(j.Status)
			sig := fmt.Sprintf("%s|%s|%s|%s|%d|%d", j.Date, strings.ToLower(cust), ch, strings.ToLower(svc), price, ts)
			if ex, ok := existingJobs[sig]; ok {
				if ex.status != st {
					_, _ = tx.Exec(`UPDATE work_jobs SET status=? WHERE id=?`, st, ex.id)
				}
				continue
			}
			res, err := tx.Exec(
				`INSERT INTO work_jobs(date, customer, channel, service, price, status, note, ts) VALUES(?,?,?,?,?,?,?,?)`,
				j.Date, cust, ch, svc, price, st, strings.TrimSpace(j.Note), ts,
			)
			if err != nil {
				serverErr(w, err)
				return
			}
			newID, _ := res.LastInsertId()
			existingJobs[sig] = struct {
				id     int64
				status string
			}{id: newID, status: st}
		}

		existingLedger := map[string]bool{}
		lrows, err := tx.Query(`SELECT date, category, amount, note, ts FROM work_ledger`)
		if err == nil {
			for lrows.Next() {
				var d, cat, note string
				var amt int
				var ts int64
				if lrows.Scan(&d, &cat, &amt, &note, &ts) == nil {
					sig := fmt.Sprintf("%s|%s|%d|%s|%d", d, cat, normalizeVND(amt), strings.ToLower(strings.TrimSpace(note)), ts)
					existingLedger[sig] = true
				}
			}
			lrows.Close()
		}

		for _, l := range in.Ledger {
			amt := normalizeVND(l.Amount)
			if !validDate(l.Date) || !validLedgerCategory(l.Category) || amt < 1000 {
				continue
			}
			ts := l.Ts
			if ts <= 0 {
				ts = s.now().Unix()
			}
			note := strings.TrimSpace(l.Note)
			sig := fmt.Sprintf("%s|%s|%d|%s|%d", l.Date, l.Category, amt, strings.ToLower(note), ts)
			if existingLedger[sig] {
				continue
			}
			if _, err := tx.Exec(
				`INSERT INTO work_ledger(date, category, amount, note, ts) VALUES(?,?,?,?,?)`,
				l.Date, l.Category, amt, note, ts,
			); err != nil {
				serverErr(w, err)
				return
			}
			existingLedger[sig] = true
		}
	}

	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}

	writeJSON(w, 200, map[string]any{
		"ok":     true,
		"db_id":  s.dbInstanceID(),
		"jobs":   s.queryAllWorkJobs(),
		"ledger": s.queryAllWorkLedger(),
	})
}


