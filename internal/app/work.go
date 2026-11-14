package app

import (
	"bytes"
	"database/sql"
	"encoding/csv"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type workJobPayment struct {
	ID     int64  `json:"id"`
	JobID  int64  `json:"job_id"`
	Date   string `json:"date"`
	Amount int    `json:"amount"`
	Note   string `json:"note"`
	Ts     int64  `json:"ts"`
}

type workJob struct {
	ID              int64            `json:"id"`
	Date            string           `json:"date"`
	Customer        string           `json:"customer"`
	Channel         string           `json:"channel"`
	Service         string           `json:"service"`
	Price           int              `json:"price"`
	PaidAmount      int              `json:"paid_amount"`
	RemainingAmount int              `json:"remaining_amount"`
	Payments        []workJobPayment `json:"payments,omitempty"`
	Status          string           `json:"status"` // "TT" hoặc "CTT"
	Note            string           `json:"note"`
	Ts              int64            `json:"ts"`
}

type workLedgerRepayment struct {
	ID       int64  `json:"id"`
	LedgerID int64  `json:"ledger_id"`
	Date     string `json:"date"`
	Amount   int    `json:"amount"`
	Note     string `json:"note"`
	Ts       int64  `json:"ts"`
}

type workBorrowRepaymentView struct {
	ID              int64  `json:"id"`
	LedgerID        int64  `json:"ledger_id"`
	BorrowDate      string `json:"borrow_date"`
	BorrowNote      string `json:"borrow_note"`
	BorrowAmount    int    `json:"borrow_amount"`
	RemainingAmount int    `json:"remaining_amount"`
	Date            string `json:"date"`
	Amount          int    `json:"amount"`
	Note            string `json:"note"`
	Ts              int64  `json:"ts"`
}

type workLedger struct {
	ID              int64                 `json:"id"`
	Date            string                `json:"date"`
	Category        string                `json:"category"` // "expense" | "fund_in" | "fund_bal" | "borrow" | "repay"
	Amount          int                   `json:"amount"`
	PaidAmount      int                   `json:"paid_amount"`
	RemainingAmount int                   `json:"remaining_amount"`
	Repayments      []workLedgerRepayment `json:"repayments,omitempty"`
	Note            string                `json:"note"`
	Ts              int64                 `json:"ts"`
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
	Customer       string    `json:"customer"`
	Channel        string    `json:"channel"`
	JobCount       int       `json:"job_count"`
	TotalJobCount  int       `json:"total_job_count"`
	SettledCount   int       `json:"settled_count"`
	TotalAmount    int       `json:"total_amount"`
	OriginalAmount int       `json:"original_amount"`
	PaidAmount     int       `json:"paid_amount"`
	Settled        bool      `json:"settled"`
	Jobs           []workJob `json:"jobs"`
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

func normalizeInstallmentAmount(rawAmount, remBefore int) int {
	amt := normalizeVND(rawAmount)
	if remBefore > 0 && rawAmount > 0 && rawAmount == remBefore && remBefore < 1000 {
		amt = remBefore
	}
	return amt
}

func installmentSig(date string, amt int, note string, ts int64) string {
	return fmt.Sprintf("%s|%d|%s|%d", date, amt, strings.ToLower(strings.TrimSpace(note)), ts)
}

func (s *Server) attachJobPayments(out []workJob) error {
	jobIDs := make([]int64, 0, len(out))
	idxByID := make(map[int64]int, len(out))
	for i := range out {
		out[i].Payments = []workJobPayment{}
		if out[i].Status == "TT" {
			out[i].PaidAmount = out[i].Price
			out[i].RemainingAmount = 0
		} else {
			out[i].PaidAmount = 0
			out[i].RemainingAmount = out[i].Price
		}
		if out[i].ID > 0 {
			idxByID[out[i].ID] = i
			jobIDs = append(jobIDs, out[i].ID)
		}
	}
	if len(jobIDs) == 0 {
		return nil
	}

	placeholders := strings.Repeat("?,", len(jobIDs)-1) + "?"
	args := make([]any, len(jobIDs))
	for i, id := range jobIDs {
		args[i] = id
	}
	q := `SELECT id, job_id, date, amount, note, ts FROM work_job_payments WHERE job_id IN (` + placeholders + `) ORDER BY date ASC, id ASC`
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return err
	}
	defer rows.Close()

	hasPayments := make(map[int64]bool)
	for rows.Next() {
		var p workJobPayment
		if err := rows.Scan(&p.ID, &p.JobID, &p.Date, &p.Amount, &p.Note, &p.Ts); err != nil {
			return err
		}
		if idx, ok := idxByID[p.JobID]; ok {
			if !hasPayments[p.JobID] {
				out[idx].PaidAmount = 0
				hasPayments[p.JobID] = true
			}
			out[idx].Payments = append(out[idx].Payments, p)
			out[idx].PaidAmount += p.Amount
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for id, i := range idxByID {
		if !hasPayments[id] {
			continue
		}
		rem := out[i].Price - out[i].PaidAmount
		if rem < 0 || out[i].Status == "TT" {
			rem = 0
		}
		out[i].RemainingAmount = rem
	}
	return nil
}

func (s *Server) queryWorkJobsByDate(date string) ([]workJob, error) {
	rows, err := s.db.Query(`SELECT id, date, customer, channel, service, price, status, note, ts FROM work_jobs WHERE date=? ORDER BY id ASC`, date)
	if err != nil {
		return nil, err
	}
	out := []workJob{}
	for rows.Next() {
		var j workJob
		if err := rows.Scan(&j.ID, &j.Date, &j.Customer, &j.Channel, &j.Service, &j.Price, &j.Status, &j.Note, &j.Ts); err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, j)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	if err := s.attachJobPayments(out); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Server) attachLedgerRepayments(out []workLedger) error {
	borrowIDs := make([]int64, 0)
	idxByID := make(map[int64]int)
	for i := range out {
		if out[i].Category == "borrow" {
			out[i].Repayments = []workLedgerRepayment{}
			out[i].PaidAmount = 0
			out[i].RemainingAmount = out[i].Amount
			if out[i].ID > 0 {
				idxByID[out[i].ID] = i
				borrowIDs = append(borrowIDs, out[i].ID)
			}
		}
	}
	if len(borrowIDs) == 0 {
		return nil
	}

	placeholders := strings.Repeat("?,", len(borrowIDs)-1) + "?"
	args := make([]any, len(borrowIDs))
	for i, id := range borrowIDs {
		args[i] = id
	}
	q := `SELECT id, ledger_id, date, amount, note, ts FROM work_ledger_repayments WHERE ledger_id IN (` + placeholders + `) ORDER BY date ASC, id ASC`
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var rep workLedgerRepayment
		if err := rows.Scan(&rep.ID, &rep.LedgerID, &rep.Date, &rep.Amount, &rep.Note, &rep.Ts); err != nil {
			return err
		}
		if idx, ok := idxByID[rep.LedgerID]; ok {
			out[idx].Repayments = append(out[idx].Repayments, rep)
			out[idx].PaidAmount += rep.Amount
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, i := range idxByID {
		rem := out[i].Amount - out[i].PaidAmount
		if rem < 0 {
			rem = 0
		}
		out[i].RemainingAmount = rem
	}
	return nil
}

func (s *Server) queryWorkLedgerByDate(date string) ([]workLedger, error) {
	rows, err := s.db.Query(`SELECT id, date, category, amount, note, ts FROM work_ledger WHERE date=? ORDER BY id ASC`, date)
	if err != nil {
		return nil, err
	}
	out := []workLedger{}
	for rows.Next() {
		var l workLedger
		if err := rows.Scan(&l.ID, &l.Date, &l.Category, &l.Amount, &l.Note, &l.Ts); err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, l)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	if err := s.attachLedgerRepayments(out); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Server) queryWorkRepaymentsByDate(date string) ([]workBorrowRepaymentView, error) {
	rows, err := s.db.Query(`
		SELECT r.id, r.ledger_id, wl.date, wl.note, wl.amount,
		       COALESCE((SELECT SUM(r2.amount) FROM work_ledger_repayments r2 WHERE r2.ledger_id = wl.id), 0),
		       r.date, r.amount, r.note, r.ts
		FROM work_ledger_repayments r
		JOIN work_ledger wl ON wl.id = r.ledger_id
		WHERE r.date=?
		ORDER BY r.id ASC`, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []workBorrowRepaymentView{}
	for rows.Next() {
		var v workBorrowRepaymentView
		var totalPaid int
		if err := rows.Scan(&v.ID, &v.LedgerID, &v.BorrowDate, &v.BorrowNote, &v.BorrowAmount, &totalPaid, &v.Date, &v.Amount, &v.Note, &v.Ts); err != nil {
			return nil, err
		}
		rem := v.BorrowAmount - totalPaid
		if rem < 0 {
			rem = 0
		}
		v.RemainingAmount = rem
		out = append(out, v)
	}
	return out, rows.Err()
}

func (s *Server) computeWorkSummary(datePrefix string, exactDate bool) workSummary {
	var sum workSummary
	var jobWhere, ledgerWhere, repayWhere, payWhere string
	var arg string
	if exactDate {
		jobWhere = `WHERE work_jobs.date = ?`
		ledgerWhere = `WHERE wl.date = ?`
		repayWhere = `WHERE date = ?`
		payWhere = `WHERE date = ?`
		arg = datePrefix
	} else {
		jobWhere = `WHERE work_jobs.date LIKE ?`
		ledgerWhere = `WHERE wl.date LIKE ?`
		repayWhere = `WHERE date LIKE ?`
		payWhere = `WHERE date LIKE ?`
		arg = datePrefix + "-%"
	}

	rows, err := s.db.Query(`
		SELECT work_jobs.price, work_jobs.status,
		       COALESCE((SELECT SUM(p.amount) FROM work_job_payments p WHERE p.job_id = work_jobs.id), 0),
		       EXISTS(SELECT 1 FROM work_job_payments p WHERE p.job_id = work_jobs.id)
		FROM work_jobs `+jobWhere, arg)
	if err == nil {
		for rows.Next() {
			var price, sumPaid int
			var status string
			var hasPays bool
			if rows.Scan(&price, &status, &sumPaid, &hasPays) == nil {
				sum.TotalJobs++
				sum.TotalRevenue += price
				if hasPays {
					rem := price - sumPaid
					if rem < 0 || status == "TT" {
						rem = 0
					}
					if rem > 0 {
						sum.UnpaidJobs++
						sum.UnpaidAmount += rem
					} else {
						sum.PaidJobs++
					}
				} else if status == "CTT" {
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

	var jobPaidCollections int
	if err := s.db.QueryRow(`SELECT COALESCE(SUM(amount), 0) FROM work_job_payments `+payWhere, arg).Scan(&jobPaidCollections); err == nil {
		sum.PaidAmount += jobPaidCollections
	}

	lrows, err := s.db.Query(`
		SELECT wl.category, wl.amount, COALESCE((SELECT SUM(r.amount) FROM work_ledger_repayments r WHERE r.ledger_id = wl.id), 0)
		FROM work_ledger wl `+ledgerWhere+` ORDER BY wl.id ASC`, arg)
	if err == nil {
		for lrows.Next() {
			var cat string
			var amt, repaid int
			if lrows.Scan(&cat, &amt, &repaid) == nil {
				switch cat {
				case "expense":
					sum.ExpenseAmount += amt
				case "fund_in":
					sum.FundIn += amt
				case "fund_bal":
					sum.FundBal = amt // Số dư quỹ lấy bản ghi cập nhật mới nhất
				case "borrow":
					rem := amt - repaid
					if rem < 0 {
						rem = 0
					}
					sum.BorrowAmount += rem
				case "repay":
					sum.RepayAmount += amt
				}
			}
		}
		lrows.Close()
	}

	var repayPaid int
	if err := s.db.QueryRow(`SELECT COALESCE(SUM(amount), 0) FROM work_ledger_repayments `+repayWhere, arg).Scan(&repayPaid); err == nil {
		sum.RepayAmount += repayPaid
	}

	sum.NetCash = sum.PaidAmount - sum.ExpenseAmount
	return sum
}

func (s *Server) queryDebtGroups() ([]unpaidCustomerGroup, []unpaidCustomerGroup, int, int) {
	rows, err := s.db.Query(`
		SELECT id, date, customer, channel, service, price, status, note, ts
		FROM work_jobs
		WHERE status='CTT' OR EXISTS(SELECT 1 FROM work_job_payments p WHERE p.job_id = work_jobs.id)
		ORDER BY date DESC, id DESC`)
	if err != nil {
		return []unpaidCustomerGroup{}, []unpaidCustomerGroup{}, 0, 0
	}
	allDebtJobs := []workJob{}
	for rows.Next() {
		var j workJob
		if rows.Scan(&j.ID, &j.Date, &j.Customer, &j.Channel, &j.Service, &j.Price, &j.Status, &j.Note, &j.Ts) == nil {
			allDebtJobs = append(allDebtJobs, j)
		}
	}
	rows.Close()
	_ = s.attachJobPayments(allDebtJobs)

	byKey := map[string]*unpaidCustomerGroup{}
	var orderKeys []string
	totalUnpaidAll := 0
	totalUnpaidJobs := 0

	for _, j := range allDebtJobs {
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
		rem := j.RemainingAmount
		g.TotalJobCount++
		g.OriginalAmount += j.Price
		g.PaidAmount += j.PaidAmount
		g.TotalAmount += rem
		if rem > 0 {
			g.JobCount++
			totalUnpaidAll += rem
			totalUnpaidJobs++
		} else {
			g.SettledCount++
		}
		g.Jobs = append(g.Jobs, j)
	}

	allDebt := make([]unpaidCustomerGroup, 0, len(orderKeys))
	unpaidOnly := make([]unpaidCustomerGroup, 0, len(orderKeys))
	for _, k := range orderKeys {
		g := *byKey[k]
		g.Settled = (g.TotalAmount == 0 && len(g.Jobs) > 0)
		allDebt = append(allDebt, g)
		if g.TotalAmount > 0 {
			ug := g
			ug.Jobs = make([]workJob, 0, g.JobCount)
			for _, j := range g.Jobs {
				if j.RemainingAmount > 0 {
					ug.Jobs = append(ug.Jobs, j)
				}
			}
			unpaidOnly = append(unpaidOnly, ug)
		}
	}

	sort.Slice(allDebt, func(i, j int) bool {
		iu := allDebt[i].TotalAmount > 0
		ju := allDebt[j].TotalAmount > 0
		if iu != ju {
			return iu
		}
		if allDebt[i].TotalAmount != allDebt[j].TotalAmount {
			return allDebt[i].TotalAmount > allDebt[j].TotalAmount
		}
		if allDebt[i].OriginalAmount != allDebt[j].OriginalAmount {
			return allDebt[i].OriginalAmount > allDebt[j].OriginalAmount
		}
		return allDebt[i].Customer < allDebt[j].Customer
	})
	sort.Slice(unpaidOnly, func(i, j int) bool {
		if unpaidOnly[i].TotalAmount != unpaidOnly[j].TotalAmount {
			return unpaidOnly[i].TotalAmount > unpaidOnly[j].TotalAmount
		}
		return unpaidOnly[i].Customer < unpaidOnly[j].Customer
	})

	return unpaidOnly, allDebt, totalUnpaidAll, totalUnpaidJobs
}

func (s *Server) queryUnpaidGroups() ([]unpaidCustomerGroup, int, int) {
	unpaidOnly, _, totalUnpaidAll, totalUnpaidJobs := s.queryDebtGroups()
	return unpaidOnly, totalUnpaidAll, totalUnpaidJobs
}

func (s *Server) queryMonthDaysBrief(month string) []workDayBrief {
	likeArg := month + "-%"
	byDate := map[string]*workDayBrief{}
	ensureDay := func(d string) *workDayBrief {
		b := byDate[d]
		if b == nil {
			b = &workDayBrief{Date: d}
			byDate[d] = b
		}
		return b
	}

	rows, err := s.db.Query(`
		SELECT work_jobs.date, work_jobs.price, work_jobs.status,
		       COALESCE((SELECT SUM(p.amount) FROM work_job_payments p WHERE p.job_id = work_jobs.id), 0),
		       EXISTS(SELECT 1 FROM work_job_payments p WHERE p.job_id = work_jobs.id)
		FROM work_jobs WHERE work_jobs.date LIKE ?`, likeArg)
	if err == nil {
		for rows.Next() {
			var d, st string
			var p, sumPaid int
			var hasPays bool
			if rows.Scan(&d, &p, &st, &sumPaid, &hasPays) == nil {
				b := ensureDay(d)
				b.JobCount++
				b.TotalRevenue += p
				if hasPays {
					rem := p - sumPaid
					if rem < 0 || st == "TT" {
						rem = 0
					}
					b.UnpaidAmount += rem
				} else if st == "CTT" {
					b.UnpaidAmount += p
				} else {
					b.PaidAmount += p
				}
			}
		}
		rows.Close()
	}

	prows, err := s.db.Query(`SELECT date, amount FROM work_job_payments WHERE date LIKE ?`, likeArg)
	if err == nil {
		for prows.Next() {
			var d string
			var amt int
			if prows.Scan(&d, &amt) == nil {
				ensureDay(d).PaidAmount += amt
			}
		}
		prows.Close()
	}

	lrows, err := s.db.Query(`SELECT date, amount FROM work_ledger WHERE date LIKE ? AND category='expense'`, likeArg)
	if err == nil {
		for lrows.Next() {
			var d string
			var amt int
			if lrows.Scan(&d, &amt) == nil {
				ensureDay(d).ExpenseAmount += amt
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
	dayRepayments, err := s.queryWorkRepaymentsByDate(date)
	if err != nil {
		serverErr(w, err)
		return
	}

	daySum := s.computeWorkSummary(date, true)
	monthSum := s.computeWorkSummary(month, false)
	unpaidGroups, debtGroups, totalUnpaidAll, totalUnpaidJobs := s.queryDebtGroups()
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
		"day_repayments":    dayRepayments,
		"day_summary":       daySum,
		"month_summary":     monthSum,
		"unpaid_groups":     unpaidGroups,
		"debt_groups":       debtGroups,
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

	tx, err := s.db.Begin()
	if err != nil {
		serverErr(w, err)
		return
	}
	defer tx.Rollback()

	type pendingJob struct {
		id    int64
		price int
	}
	rows, err := tx.Query(`SELECT id, price FROM work_jobs WHERE status='CTT' AND LOWER(TRIM(customer)) = LOWER(TRIM(?))`, cust)
	if err != nil {
		serverErr(w, err)
		return
	}
	var pending []pendingJob
	for rows.Next() {
		var p pendingJob
		if err := rows.Scan(&p.id, &p.price); err == nil {
			pending = append(pending, p)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		serverErr(w, err)
		return
	}
	rows.Close()

	today := s.today()
	ts := s.now().Unix()
	for _, p := range pending {
		var paid int
		if err := tx.QueryRow(`SELECT COALESCE(SUM(amount), 0) FROM work_job_payments WHERE job_id=?`, p.id).Scan(&paid); err != nil {
			serverErr(w, err)
			return
		}
		rem := p.price - paid
		if rem > 0 {
			if _, err := tx.Exec(
				`INSERT INTO work_job_payments(job_id, date, amount, note, ts) VALUES(?,?,?,?,?)`,
				p.id, today, rem, "Trả hết nợ", ts,
			); err != nil {
				serverErr(w, err)
				return
			}
		}
	}

	res, err := tx.Exec(`UPDATE work_jobs SET status='TT' WHERE status='CTT' AND LOWER(TRIM(customer)) = LOWER(TRIM(?))`, cust)
	if err != nil {
		serverErr(w, err)
		return
	}
	affected, _ := res.RowsAffected()
	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "updated": affected})
}

// POST /api/work/job/{id}/pay
func (s *Server) handlePayWorkJob(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		httpErr(w, 400, "Mã đơn việc không hợp lệ")
		return
	}
	var in struct {
		Date   string `json:"date"`
		Amount int    `json:"amount"`
		Note   string `json:"note"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if in.Date == "" {
		in.Date = s.today()
	}
	if !validDate(in.Date) {
		httpErr(w, 400, "Ngày trả tiền không hợp lệ (YYYY-MM-DD)")
		return
	}
	note := strings.TrimSpace(in.Note)
	if utf8.RuneCountInString(note) > 300 {
		httpErr(w, 400, "Ghi chú tối đa 300 ký tự")
		return
	}

	tx, err := s.db.Begin()
	if err != nil {
		serverErr(w, err)
		return
	}
	defer tx.Rollback()

	var jobPrice int
	var jobStatus string
	err = tx.QueryRow(`SELECT price, status FROM work_jobs WHERE id=?`, id).Scan(&jobPrice, &jobStatus)
	if err == sql.ErrNoRows {
		httpErr(w, 404, "Không tìm thấy đơn việc này")
		return
	}
	if err != nil {
		serverErr(w, err)
		return
	}

	var paid int
	var payCount int
	if err := tx.QueryRow(`SELECT COALESCE(SUM(amount), 0), COUNT(*) FROM work_job_payments WHERE job_id=?`, id).Scan(&paid, &payCount); err != nil {
		serverErr(w, err)
		return
	}
	if jobStatus == "TT" && payCount == 0 {
		httpErr(w, 400, "Đơn việc này đã thanh toán đủ ngay từ đầu")
		return
	}
	remBefore := jobPrice - paid
	if remBefore < 0 || jobStatus == "TT" {
		remBefore = 0
	}

	payAmt := normalizeInstallmentAmount(in.Amount, remBefore)
	if payAmt <= 0 || (payAmt < 1000 && !(remBefore > 0 && payAmt == remBefore)) {
		httpErr(w, 400, "Số tiền trả phải từ 1.000đ trở lên")
		return
	}

	ts := s.now().Unix()
	res, err := tx.Exec(
		`INSERT INTO work_job_payments(job_id, date, amount, note, ts) VALUES(?,?,?,?,?)`,
		id, in.Date, payAmt, note, ts,
	)
	if err != nil {
		serverErr(w, err)
		return
	}
	payID, _ := res.LastInsertId()

	newPaid := paid + payAmt
	newRemaining := jobPrice - newPaid
	if newRemaining < 0 {
		newRemaining = 0
	}
	overpaid := newPaid - jobPrice
	if overpaid < 0 {
		overpaid = 0
	}
	newStatus := "CTT"
	if newRemaining == 0 {
		newStatus = "TT"
	}
	if _, err := tx.Exec(`UPDATE work_jobs SET status=? WHERE id=?`, newStatus, id); err != nil {
		serverErr(w, err)
		return
	}

	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}

	writeJSON(w, 200, map[string]any{
		"ok":               true,
		"payment_id":       payID,
		"job_id":           id,
		"status":           newStatus,
		"paid_amount":      newPaid,
		"remaining_amount": newRemaining,
		"overpaid_amount":  overpaid,
		"settled":          newRemaining == 0,
		"payment": workJobPayment{
			ID:     payID,
			JobID:  id,
			Date:   in.Date,
			Amount: payAmt,
			Note:   note,
			Ts:     ts,
		},
	})
}

// DELETE /api/work/job-payment/{id}
func (s *Server) handleDelWorkJobPayment(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		httpErr(w, 400, "Mã lần trả tiền không hợp lệ")
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		serverErr(w, err)
		return
	}
	defer tx.Rollback()

	var jobID int64
	err = tx.QueryRow(`SELECT job_id FROM work_job_payments WHERE id=?`, id).Scan(&jobID)
	if err == sql.ErrNoRows {
		writeJSON(w, 200, map[string]any{"ok": true})
		return
	}
	if err != nil {
		serverErr(w, err)
		return
	}
	if _, err := tx.Exec(`DELETE FROM work_job_payments WHERE id=?`, id); err != nil {
		serverErr(w, err)
		return
	}
	var jobPrice int
	var paid int
	if err := tx.QueryRow(`SELECT price FROM work_jobs WHERE id=?`, jobID).Scan(&jobPrice); err == nil {
		_ = tx.QueryRow(`SELECT COALESCE(SUM(amount), 0) FROM work_job_payments WHERE job_id=?`, jobID).Scan(&paid)
		newStatus := "CTT"
		if paid >= jobPrice {
			newStatus = "TT"
		}
		if _, err := tx.Exec(`UPDATE work_jobs SET status=? WHERE id=?`, newStatus, jobID); err != nil {
			serverErr(w, err)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
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

// POST /api/work/ledger/{id}/repay
func (s *Server) handleRepayWorkLedger(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		httpErr(w, 400, "Mã khoản mượn không hợp lệ")
		return
	}
	var in struct {
		Date   string `json:"date"`
		Amount int    `json:"amount"`
		Note   string `json:"note"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if in.Date == "" {
		in.Date = s.today()
	}
	if !validDate(in.Date) {
		httpErr(w, 400, "Ngày trả tiền không hợp lệ (YYYY-MM-DD)")
		return
	}
	note := strings.TrimSpace(in.Note)
	if utf8.RuneCountInString(note) > 300 {
		httpErr(w, 400, "Ghi chú tối đa 300 ký tự")
		return
	}

	tx, err := s.db.Begin()
	if err != nil {
		serverErr(w, err)
		return
	}
	defer tx.Rollback()

	var cat string
	var borrowAmt int
	err = tx.QueryRow(`SELECT category, amount FROM work_ledger WHERE id=?`, id).Scan(&cat, &borrowAmt)
	if err == sql.ErrNoRows {
		httpErr(w, 404, "Không tìm thấy khoản mượn này")
		return
	}
	if err != nil {
		serverErr(w, err)
		return
	}
	if cat != "borrow" {
		httpErr(w, 400, "Chỉ áp dụng trả tiền cho khoản mục Mượn")
		return
	}

	var paid int
	if err := tx.QueryRow(`SELECT COALESCE(SUM(amount), 0) FROM work_ledger_repayments WHERE ledger_id=?`, id).Scan(&paid); err != nil {
		serverErr(w, err)
		return
	}
	remBefore := borrowAmt - paid
	if remBefore < 0 {
		remBefore = 0
	}

	payAmt := normalizeInstallmentAmount(in.Amount, remBefore)
	if payAmt <= 0 || (payAmt < 1000 && !(remBefore > 0 && payAmt == remBefore)) {
		httpErr(w, 400, "Số tiền trả phải từ 1.000đ trở lên")
		return
	}

	ts := s.now().Unix()
	res, err := tx.Exec(
		`INSERT INTO work_ledger_repayments(ledger_id, date, amount, note, ts) VALUES(?,?,?,?,?)`,
		id, in.Date, payAmt, note, ts,
	)
	if err != nil {
		serverErr(w, err)
		return
	}
	repayID, _ := res.LastInsertId()
	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}

	newPaid := paid + payAmt
	newRemaining := borrowAmt - newPaid
	if newRemaining < 0 {
		newRemaining = 0
	}
	overpaid := newPaid - borrowAmt
	if overpaid < 0 {
		overpaid = 0
	}
	writeJSON(w, 200, map[string]any{
		"ok":               true,
		"repayment_id":     repayID,
		"ledger_id":        id,
		"paid_amount":      newPaid,
		"remaining_amount": newRemaining,
		"overpaid_amount":  overpaid,
		"settled":          newRemaining == 0,
		"repayment": workLedgerRepayment{
			ID:       repayID,
			LedgerID: id,
			Date:     in.Date,
			Amount:   payAmt,
			Note:     note,
			Ts:       ts,
		},
	})
}

// DELETE /api/work/repayment/{id}
func (s *Server) handleDelWorkLedgerRepayment(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		httpErr(w, 400, "Mã lần trả tiền không hợp lệ")
		return
	}
	if _, err := s.db.Exec(`DELETE FROM work_ledger_repayments WHERE id=?`, id); err != nil {
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
			svcCell := j.Service
			if j.PaidAmount > 0 {
				svcCell = fmt.Sprintf("%s (Gốc %dđ, đã thu %dđ)", j.Service, j.Price, j.PaidAmount)
			}
			_ = cw.Write([]string{
				custCell,
				j.Channel,
				j.Date,
				svcCell,
				strconv.Itoa(j.RemainingAmount),
				totCell,
			})
		}
	}
	_ = cw.Write([]string{})

	// 4. Bảng Thu Chi / Phát Sinh / Quỹ / Mượn / Trả Nợ
	_ = cw.Write([]string{"III. BẢNG CHI TIÊU PHÁT SINH, NỘP QUỸ, MƯỢN & TRẢ NỢ TRONG THÁNG"})
	_ = cw.Write([]string{"Ngày", "Phân Loại", "Số Tiền (VNĐ)", "Nội Dung Chi Tiết"})
	type csvLedgerRow struct {
		id         int64
		d, cat     string
		amt        int
		note       string
	}
	var ledgerRows []csvLedgerRow
	lrows, err := s.db.Query(`SELECT id, date, category, amount, note FROM work_ledger WHERE date LIKE ? ORDER BY date ASC, id ASC`, likeArg)
	if err == nil {
		for lrows.Next() {
			var r csvLedgerRow
			if lrows.Scan(&r.id, &r.d, &r.cat, &r.amt, &r.note) == nil {
				ledgerRows = append(ledgerRows, r)
			}
		}
		lrows.Close()
	}

	paidByBorrowID := map[int64]int{}
	prows, err := s.db.Query(`SELECT ledger_id, COALESCE(SUM(amount), 0) FROM work_ledger_repayments GROUP BY ledger_id`)
	if err == nil {
		for prows.Next() {
			var lid int64
			var paid int
			if prows.Scan(&lid, &paid) == nil {
				paidByBorrowID[lid] = paid
			}
		}
		prows.Close()
	}

	for _, r := range ledgerRows {
		amtOut := r.amt
		noteOut := r.note
		if r.cat == "borrow" {
			paid := paidByBorrowID[r.id]
			rem := r.amt - paid
			if rem < 0 {
				rem = 0
			}
			amtOut = rem
			if paid > r.amt {
				noteOut = fmt.Sprintf("%s (Đã trả xong - Mượn gốc %dđ, đã trả %dđ, trả thừa %dđ)", r.note, r.amt, paid, paid-r.amt)
			} else if rem == 0 && paid > 0 {
				noteOut = fmt.Sprintf("%s (Đã trả xong - Mượn gốc %dđ)", r.note, r.amt)
			} else if paid > 0 {
				noteOut = fmt.Sprintf("%s (Mượn gốc %dđ, đã trả %dđ)", r.note, r.amt, paid)
			}
		}
		_ = cw.Write([]string{r.d, categoryLabelVN(r.cat), strconv.Itoa(amtOut), noteOut})
	}

	type csvRepayRow struct {
		d          string
		amt        int
		note       string
		borrowDate string
		borrowNote string
	}
	var repayRows []csvRepayRow
	rrows, err := s.db.Query(`
		SELECT r.date, r.amount, r.note, wl.date, wl.note
		FROM work_ledger_repayments r
		JOIN work_ledger wl ON wl.id = r.ledger_id
		WHERE r.date LIKE ?
		ORDER BY r.date ASC, r.id ASC`, likeArg)
	if err == nil {
		for rrows.Next() {
			var x csvRepayRow
			if rrows.Scan(&x.d, &x.amt, &x.note, &x.borrowDate, &x.borrowNote) == nil {
				repayRows = append(repayRows, x)
			}
		}
		rrows.Close()
	}
	for _, x := range repayRows {
		desc := fmt.Sprintf("Trả tiền: %s (mượn %s)", x.borrowNote, x.borrowDate)
		if x.note != "" {
			desc += " - " + x.note
		}
		_ = cw.Write([]string{x.d, categoryLabelVN("repay"), strconv.Itoa(x.amt), desc})
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
	out := []workJob{}
	for rows.Next() {
		var j workJob
		if rows.Scan(&j.ID, &j.Date, &j.Customer, &j.Channel, &j.Service, &j.Price, &j.Status, &j.Note, &j.Ts) == nil {
			out = append(out, j)
		}
	}
	rows.Close()
	_ = s.attachJobPayments(out)
	return out
}

func (s *Server) queryAllWorkLedger() []workLedger {
	rows, err := s.db.Query(`SELECT id, date, category, amount, note, ts FROM work_ledger ORDER BY date ASC, id ASC`)
	if err != nil {
		return []workLedger{}
	}
	out := []workLedger{}
	for rows.Next() {
		var l workLedger
		if rows.Scan(&l.ID, &l.Date, &l.Category, &l.Amount, &l.Note, &l.Ts) == nil {
			out = append(out, l)
		}
	}
	rows.Close()
	_ = s.attachLedgerRepayments(out)
	return out
}

func (s *Server) insertVaultJobPayments(tx *sql.Tx, jobID int64, price int, fallbackTs int64, pays []workJobPayment, existing map[string]bool) error {
	if len(pays) == 0 {
		return nil
	}
	var currentPaid int
	_ = tx.QueryRow(`SELECT COALESCE(SUM(amount), 0) FROM work_job_payments WHERE job_id=?`, jobID).Scan(&currentPaid)

	for _, pay := range pays {
		if !validDate(pay.Date) {
			continue
		}
		payAmt := normalizeInstallmentAmount(pay.Amount, price-currentPaid)
		if payAmt <= 0 {
			continue
		}
		payTs := pay.Ts
		if payTs <= 0 {
			payTs = fallbackTs
		}
		payNote := strings.TrimSpace(pay.Note)
		sig := installmentSig(pay.Date, payAmt, payNote, payTs)
		if existing != nil && existing[sig] {
			continue
		}
		if _, err := tx.Exec(
			`INSERT INTO work_job_payments(job_id, date, amount, note, ts) VALUES(?,?,?,?,?)`,
			jobID, pay.Date, payAmt, payNote, payTs,
		); err != nil {
			return err
		}
		currentPaid += payAmt
		if existing != nil {
			existing[sig] = true
		}
	}
	if currentPaid >= price {
		_, _ = tx.Exec(`UPDATE work_jobs SET status='TT' WHERE id=? AND status='CTT'`, jobID)
	}
	return nil
}

func (s *Server) insertVaultRepayments(tx *sql.Tx, ledgerID int64, borrowAmt int, fallbackTs int64, reps []workLedgerRepayment, existing map[string]bool) error {
	if len(reps) == 0 {
		return nil
	}
	var currentPaid int
	_ = tx.QueryRow(`SELECT COALESCE(SUM(amount), 0) FROM work_ledger_repayments WHERE ledger_id=?`, ledgerID).Scan(&currentPaid)

	for _, rep := range reps {
		if !validDate(rep.Date) {
			continue
		}
		repAmt := normalizeInstallmentAmount(rep.Amount, borrowAmt-currentPaid)
		if repAmt <= 0 {
			continue
		}
		repTs := rep.Ts
		if repTs <= 0 {
			repTs = fallbackTs
		}
		repNote := strings.TrimSpace(rep.Note)
		sig := installmentSig(rep.Date, repAmt, repNote, repTs)
		if existing != nil && existing[sig] {
			continue
		}
		if _, err := tx.Exec(
			`INSERT INTO work_ledger_repayments(ledger_id, date, amount, note, ts) VALUES(?,?,?,?,?)`,
			ledgerID, rep.Date, repAmt, repNote, repTs,
		); err != nil {
			return err
		}
		currentPaid += repAmt
		if existing != nil {
			existing[sig] = true
		}
	}
	return nil
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
		if _, err := tx.Exec(`DELETE FROM work_job_payments`); err != nil {
			serverErr(w, err)
			return
		}
		if _, err := tx.Exec(`DELETE FROM work_jobs`); err != nil {
			serverErr(w, err)
			return
		}
		if _, err := tx.Exec(`DELETE FROM work_ledger_repayments`); err != nil {
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
			res, err := tx.Exec(
				`INSERT INTO work_jobs(date, customer, channel, service, price, status, note, ts) VALUES(?,?,?,?,?,?,?,?)`,
				j.Date, cust, validChannel(j.Channel), svc, price, validJobStatus(j.Status), strings.TrimSpace(j.Note), ts,
			)
			if err != nil {
				serverErr(w, err)
				return
			}
			if len(j.Payments) > 0 {
				jobID, _ := res.LastInsertId()
				if err := s.insertVaultJobPayments(tx, jobID, price, ts, j.Payments, nil); err != nil {
					serverErr(w, err)
					return
				}
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
			res, err := tx.Exec(
				`INSERT INTO work_ledger(date, category, amount, note, ts) VALUES(?,?,?,?,?)`,
				l.Date, l.Category, amt, strings.TrimSpace(l.Note), ts,
			)
			if err != nil {
				serverErr(w, err)
				return
			}
			if l.Category == "borrow" && len(l.Repayments) > 0 {
				ledgerID, _ := res.LastInsertId()
				if err := s.insertVaultRepayments(tx, ledgerID, amt, ts, l.Repayments, nil); err != nil {
					serverErr(w, err)
					return
				}
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

		existingJobPays := map[int64]map[string]bool{}
		jprows, err := tx.Query(`SELECT job_id, date, amount, note, ts FROM work_job_payments`)
		if err == nil {
			for jprows.Next() {
				var jid, pts int64
				var pd, pnote string
				var pamt int
				if jprows.Scan(&jid, &pd, &pamt, &pnote, &pts) == nil {
					if existingJobPays[jid] == nil {
						existingJobPays[jid] = map[string]bool{}
					}
					existingJobPays[jid][installmentSig(pd, pamt, pnote, pts)] = true
				}
			}
			jprows.Close()
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
			var targetJobID int64
			if ex, ok := existingJobs[sig]; ok {
				targetJobID = ex.id
				if ex.status == "CTT" && st == "TT" {
					_, _ = tx.Exec(`UPDATE work_jobs SET status=? WHERE id=?`, st, ex.id)
				}
			} else {
				res, err := tx.Exec(
					`INSERT INTO work_jobs(date, customer, channel, service, price, status, note, ts) VALUES(?,?,?,?,?,?,?,?)`,
					j.Date, cust, ch, svc, price, st, strings.TrimSpace(j.Note), ts,
				)
				if err != nil {
					serverErr(w, err)
					return
				}
				targetJobID, _ = res.LastInsertId()
				existingJobs[sig] = struct {
					id     int64
					status string
				}{id: targetJobID, status: st}
			}
			if len(j.Payments) > 0 {
				if existingJobPays[targetJobID] == nil {
					existingJobPays[targetJobID] = map[string]bool{}
				}
				if err := s.insertVaultJobPayments(tx, targetJobID, price, ts, j.Payments, existingJobPays[targetJobID]); err != nil {
					serverErr(w, err)
					return
				}
			}
		}

		existingLedger := map[string]int64{}
		lrows, err := tx.Query(`SELECT id, date, category, amount, note, ts FROM work_ledger`)
		if err == nil {
			for lrows.Next() {
				var id, ts int64
				var d, cat, note string
				var amt int
				if lrows.Scan(&id, &d, &cat, &amt, &note, &ts) == nil {
					sig := fmt.Sprintf("%s|%s|%d|%s|%d", d, cat, normalizeVND(amt), strings.ToLower(strings.TrimSpace(note)), ts)
					existingLedger[sig] = id
				}
			}
			lrows.Close()
		}

		existingRepays := map[int64]map[string]bool{}
		rrows, err := tx.Query(`SELECT ledger_id, date, amount, note, ts FROM work_ledger_repayments`)
		if err == nil {
			for rrows.Next() {
				var lid, rts int64
				var rd, rnote string
				var ramt int
				if rrows.Scan(&lid, &rd, &ramt, &rnote, &rts) == nil {
					if existingRepays[lid] == nil {
						existingRepays[lid] = map[string]bool{}
					}
					rsig := fmt.Sprintf("%s|%d|%s|%d", rd, normalizeVND(ramt), strings.ToLower(strings.TrimSpace(rnote)), rts)
					existingRepays[lid][rsig] = true
				}
			}
			rrows.Close()
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
			targetID, ok := existingLedger[sig]
			if !ok {
				res, err := tx.Exec(
					`INSERT INTO work_ledger(date, category, amount, note, ts) VALUES(?,?,?,?,?)`,
					l.Date, l.Category, amt, note, ts,
				)
				if err != nil {
					serverErr(w, err)
					return
				}
				targetID, _ = res.LastInsertId()
				existingLedger[sig] = targetID
			}
			if l.Category == "borrow" && len(l.Repayments) > 0 {
				if existingRepays[targetID] == nil {
					existingRepays[targetID] = map[string]bool{}
				}
				if err := s.insertVaultRepayments(tx, targetID, amt, ts, l.Repayments, existingRepays[targetID]); err != nil {
					serverErr(w, err)
					return
				}
			}
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


