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
	UID    string `json:"uid,omitempty"`
	JobID  int64  `json:"job_id"`
	Date   string `json:"date"`
	Amount int    `json:"amount"`
	Note   string `json:"note"`
	Ts     int64  `json:"ts"`
}

type workJob struct {
	ID              int64            `json:"id"`
	UID             string           `json:"uid,omitempty"`
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
	UpdatedAt       int64            `json:"updated_at,omitempty"`
}

type workLedgerRepayment struct {
	ID       int64  `json:"id"`
	UID      string `json:"uid,omitempty"`
	LedgerID int64  `json:"ledger_id"`
	Date     string `json:"date"`
	Amount   int    `json:"amount"`
	Note     string `json:"note"`
	Ts       int64  `json:"ts"`
}

type workLedger struct {
	ID              int64                 `json:"id"`
	UID             string                `json:"uid,omitempty"`
	Date            string                `json:"date"`
	Category        string                `json:"category"` // "expense" | "fund_in" | "fund_bal" | "borrow" | "repay"
	Amount          int                   `json:"amount"`
	PaidAmount      int                   `json:"paid_amount"`
	RemainingAmount int                   `json:"remaining_amount"`
	Repayments      []workLedgerRepayment `json:"repayments,omitempty"`
	Note            string                `json:"note"`
	Ts              int64                 `json:"ts"`
	UpdatedAt       int64                 `json:"updated_at,omitempty"`
}

type workTombstone struct {
	UID       string `json:"uid"`
	Kind      string `json:"kind"`
	Sig       string `json:"sig,omitempty"`
	DeletedAt int64  `json:"deleted_at"`
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

func sanitizeSyncUID(v string) string {
	v = strings.TrimSpace(v)
	if len(v) > 80 {
		v = v[:80]
	}
	return v
}

func validTombstoneKind(kind string) bool {
	switch kind {
	case "job", "job_payment", "ledger", "repayment":
		return true
	}
	return false
}

func workJobSig(date, customer, channel, service string, price int, ts int64) string {
	return fmt.Sprintf("%s|%s|%s|%s|%d|%d",
		date,
		strings.ToLower(strings.TrimSpace(customer)),
		validChannel(channel),
		strings.ToLower(strings.TrimSpace(service)),
		normalizeVND(price),
		ts,
	)
}

func workLedgerSig(date, category string, amount int, note string, ts int64) string {
	return fmt.Sprintf("%s|%s|%d|%s|%d",
		date,
		category,
		normalizeVND(amount),
		strings.ToLower(strings.TrimSpace(note)),
		ts,
	)
}

func installmentSig(date string, amt int, note string, ts int64) string {
	return fmt.Sprintf("%s|%d|%s|%d", date, amt, strings.ToLower(strings.TrimSpace(note)), ts)
}

func recordTombstoneTx(tx *sql.Tx, kind, uid, sig string, deletedAt int64) error {
	if !validTombstoneKind(kind) {
		return nil
	}
	uid = sanitizeSyncUID(uid)
	sig = strings.TrimSpace(sig)
	key := uid
	if key == "" && sig != "" {
		key = "sig:" + kind + ":" + sig
		if len(key) > 220 {
			key = key[:220]
		}
	}
	if key == "" {
		return nil
	}
	if deletedAt <= 0 {
		deletedAt = time.Now().Unix()
	}
	_, err := tx.Exec(
		`INSERT INTO work_tombstones(uid, kind, sig, deleted_at) VALUES(?,?,?,?)
		 ON CONFLICT(uid) DO UPDATE SET
		   sig = CASE WHEN excluded.sig <> '' THEN excluded.sig ELSE work_tombstones.sig END,
		   deleted_at = MAX(work_tombstones.deleted_at, excluded.deleted_at)`,
		key, kind, sig, deletedAt,
	)
	return err
}

func pruneTombstonesTx(tx *sql.Tx, nowSec int64) {
	var cnt int
	if tx.QueryRow(`SELECT COUNT(*) FROM work_tombstones`).Scan(&cnt) != nil || cnt <= 2500 {
		return
	}
	cutoff := nowSec - 180*86400
	_, _ = tx.Exec(`DELETE FROM work_tombstones WHERE deleted_at < ?`, cutoff)
	if tx.QueryRow(`SELECT COUNT(*) FROM work_tombstones`).Scan(&cnt) == nil && cnt > 2000 {
		_, _ = tx.Exec(`DELETE FROM work_tombstones WHERE uid NOT IN (SELECT uid FROM work_tombstones ORDER BY deleted_at DESC LIMIT 2000)`)
	}
}

func (s *Server) queryAllTombstones() []workTombstone {
	rows, err := s.db.Query(`SELECT uid, kind, sig, deleted_at FROM work_tombstones ORDER BY deleted_at DESC LIMIT 2000`)
	if err != nil {
		return []workTombstone{}
	}
	defer rows.Close()
	out := []workTombstone{}
	for rows.Next() {
		var tb workTombstone
		if rows.Scan(&tb.UID, &tb.Kind, &tb.Sig, &tb.DeletedAt) == nil {
			out = append(out, tb)
		}
	}
	return out
}

func (s *Server) attachJobPayments(out []workJob) error {
	return s.attachJobPaymentsMode(out, false)
}

func (s *Server) attachJobPaymentsMode(out []workJob, all bool) error {
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

	var rows *sql.Rows
	var err error
	if all {
		rows, err = s.db.Query(`SELECT id, COALESCE(uid, ''), job_id, date, amount, note, ts FROM work_job_payments ORDER BY date ASC, id ASC`)
	} else {
		placeholders := strings.Repeat("?,", len(jobIDs)-1) + "?"
		args := make([]any, len(jobIDs))
		for i, id := range jobIDs {
			args[i] = id
		}
		q := `SELECT id, COALESCE(uid, ''), job_id, date, amount, note, ts FROM work_job_payments WHERE job_id IN (` + placeholders + `) ORDER BY date ASC, id ASC`
		rows, err = s.db.Query(q, args...)
	}
	if err != nil {
		return err
	}
	defer rows.Close()

	hasPayments := make(map[int64]bool)
	for rows.Next() {
		var p workJobPayment
		if err := rows.Scan(&p.ID, &p.UID, &p.JobID, &p.Date, &p.Amount, &p.Note, &p.Ts); err != nil {
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

func (s *Server) attachLedgerRepaymentsMode(out []workLedger, all bool) error {
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

	var rows *sql.Rows
	var err error
	if all {
		rows, err = s.db.Query(`SELECT id, COALESCE(uid, ''), ledger_id, date, amount, note, ts FROM work_ledger_repayments ORDER BY date ASC, id ASC`)
	} else {
		placeholders := strings.Repeat("?,", len(borrowIDs)-1) + "?"
		args := make([]any, len(borrowIDs))
		for i, id := range borrowIDs {
			args[i] = id
		}
		q := `SELECT id, COALESCE(uid, ''), ledger_id, date, amount, note, ts FROM work_ledger_repayments WHERE ledger_id IN (` + placeholders + `) ORDER BY date ASC, id ASC`
		rows, err = s.db.Query(q, args...)
	}
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var rep workLedgerRepayment
		if err := rows.Scan(&rep.ID, &rep.UID, &rep.LedgerID, &rep.Date, &rep.Amount, &rep.Note, &rep.Ts); err != nil {
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

func monthDateRange(month string) (string, string) {
	return month + "-", month + "."
}

func (s *Server) computeWorkSummary(datePrefix string, exactDate bool) workSummary {
	var sum workSummary
	var jobWhere, ledgerWhere, repayWhere, payWhere string
	var args []any
	if exactDate {
		jobWhere = `WHERE work_jobs.date = ?`
		ledgerWhere = `WHERE wl.date = ?`
		repayWhere = `WHERE date = ?`
		payWhere = `WHERE date = ?`
		args = []any{datePrefix}
	} else {
		start, end := monthDateRange(datePrefix)
		jobWhere = `WHERE work_jobs.date >= ? AND work_jobs.date < ?`
		ledgerWhere = `WHERE wl.date >= ? AND wl.date < ?`
		repayWhere = `WHERE date >= ? AND date < ?`
		payWhere = `WHERE date >= ? AND date < ?`
		args = []any{start, end}
	}

	rows, err := s.db.Query(`
		SELECT work_jobs.price, work_jobs.status,
		       (SELECT SUM(p.amount) FROM work_job_payments p WHERE p.job_id = work_jobs.id)
		FROM work_jobs `+jobWhere, args...)
	if err == nil {
		for rows.Next() {
			var price int
			var status string
			var sumPaid sql.NullInt64
			if rows.Scan(&price, &status, &sumPaid) == nil {
				sum.TotalJobs++
				sum.TotalRevenue += price
				if sumPaid.Valid {
					rem := price - int(sumPaid.Int64)
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
	if err := s.db.QueryRow(`SELECT COALESCE(SUM(amount), 0) FROM work_job_payments `+payWhere, args...).Scan(&jobPaidCollections); err == nil {
		sum.PaidAmount += jobPaidCollections
	}

	lrows, err := s.db.Query(`
		SELECT wl.category, wl.amount, COALESCE((SELECT SUM(r.amount) FROM work_ledger_repayments r WHERE r.ledger_id = wl.id), 0)
		FROM work_ledger wl `+ledgerWhere+` ORDER BY wl.id ASC`, args...)
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
	if err := s.db.QueryRow(`SELECT COALESCE(SUM(amount), 0) FROM work_ledger_repayments `+repayWhere, args...).Scan(&repayPaid); err == nil {
		sum.RepayAmount += repayPaid
	}

	sum.NetCash = sum.PaidAmount - sum.ExpenseAmount
	return sum
}

func buildDebtGroups(jobs []workJob, reverse bool) ([]unpaidCustomerGroup, []unpaidCustomerGroup, int, int) {
	byKey := map[string]*unpaidCustomerGroup{}
	var orderKeys []string
	totalUnpaidAll := 0
	totalUnpaidJobs := 0

	addJob := func(j workJob) {
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

	if reverse {
		for i := len(jobs) - 1; i >= 0; i-- {
			j := jobs[i]
			if j.Status == "CTT" || len(j.Payments) > 0 {
				addJob(j)
			}
		}
	} else {
		for _, j := range jobs {
			addJob(j)
		}
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

func (s *Server) queryDebtGroups() ([]unpaidCustomerGroup, []unpaidCustomerGroup, int, int) {
	rows, err := s.db.Query(`
		SELECT id, COALESCE(uid, ''), date, customer, channel, service, price, status, note, ts, COALESCE(updated_at, 0)
		FROM work_jobs
		WHERE status='CTT' OR EXISTS(SELECT 1 FROM work_job_payments p WHERE p.job_id = work_jobs.id)
		ORDER BY date DESC, id DESC`)
	if err != nil {
		return []unpaidCustomerGroup{}, []unpaidCustomerGroup{}, 0, 0
	}
	allDebtJobs := []workJob{}
	for rows.Next() {
		var j workJob
		if rows.Scan(&j.ID, &j.UID, &j.Date, &j.Customer, &j.Channel, &j.Service, &j.Price, &j.Status, &j.Note, &j.Ts, &j.UpdatedAt) == nil {
			allDebtJobs = append(allDebtJobs, j)
		}
	}
	rows.Close()
	_ = s.attachJobPayments(allDebtJobs)
	return buildDebtGroups(allDebtJobs, false)
}

func (s *Server) queryUnpaidGroups() ([]unpaidCustomerGroup, int, int) {
	unpaidOnly, _, totalUnpaidAll, totalUnpaidJobs := s.queryDebtGroups()
	return unpaidOnly, totalUnpaidAll, totalUnpaidJobs
}

func (s *Server) queryMonthDaysBrief(month string) []workDayBrief {
	start, end := monthDateRange(month)
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
		       (SELECT SUM(p.amount) FROM work_job_payments p WHERE p.job_id = work_jobs.id)
		FROM work_jobs WHERE work_jobs.date >= ? AND work_jobs.date < ?`, start, end)
	if err == nil {
		for rows.Next() {
			var d, st string
			var p int
			var sumPaid sql.NullInt64
			if rows.Scan(&d, &p, &st, &sumPaid) == nil {
				b := ensureDay(d)
				b.JobCount++
				b.TotalRevenue += p
				if sumPaid.Valid {
					rem := p - int(sumPaid.Int64)
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

	prows, err := s.db.Query(`SELECT date, amount FROM work_job_payments WHERE date >= ? AND date < ?`, start, end)
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

	lrows, err := s.db.Query(`SELECT date, amount FROM work_ledger WHERE date >= ? AND date < ? AND category='expense'`, start, end)
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

func computeWorkSummaryFromSlices(allJobs []workJob, allLedger []workLedger, datePrefix string, exactDate bool) workSummary {
	var sum workSummary
	var start, end string
	if !exactDate {
		start, end = monthDateRange(datePrefix)
	}
	matchDate := func(d string) bool {
		if exactDate {
			return d == datePrefix
		}
		return d >= start && d < end
	}

	for _, j := range allJobs {
		if matchDate(j.Date) {
			sum.TotalJobs++
			sum.TotalRevenue += j.Price
			if len(j.Payments) > 0 {
				if j.RemainingAmount > 0 {
					sum.UnpaidJobs++
					sum.UnpaidAmount += j.RemainingAmount
				} else {
					sum.PaidJobs++
				}
			} else if j.Status == "CTT" {
				sum.UnpaidJobs++
				sum.UnpaidAmount += j.Price
			} else {
				sum.PaidJobs++
				sum.PaidAmount += j.Price
			}
		}
		for _, p := range j.Payments {
			if matchDate(p.Date) {
				sum.PaidAmount += p.Amount
			}
		}
	}

	var maxFundBalID int64 = -1
	for _, l := range allLedger {
		if matchDate(l.Date) {
			switch l.Category {
			case "expense":
				sum.ExpenseAmount += l.Amount
			case "fund_in":
				sum.FundIn += l.Amount
			case "fund_bal":
				if l.ID > maxFundBalID {
					maxFundBalID = l.ID
					sum.FundBal = l.Amount
				}
			case "borrow":
				sum.BorrowAmount += l.RemainingAmount
			case "repay":
				sum.RepayAmount += l.Amount
			}
		}
		if l.Category == "borrow" {
			for _, rep := range l.Repayments {
				if matchDate(rep.Date) {
					sum.RepayAmount += rep.Amount
				}
			}
		}
	}

	sum.NetCash = sum.PaidAmount - sum.ExpenseAmount
	return sum
}

func computeMonthDaysBriefFromSlices(allJobs []workJob, allLedger []workLedger, month string) []workDayBrief {
	start, end := monthDateRange(month)
	byDate := map[string]*workDayBrief{}
	ensureDay := func(d string) *workDayBrief {
		b := byDate[d]
		if b == nil {
			b = &workDayBrief{Date: d}
			byDate[d] = b
		}
		return b
	}

	for _, j := range allJobs {
		if j.Date >= start && j.Date < end {
			b := ensureDay(j.Date)
			b.JobCount++
			b.TotalRevenue += j.Price
			if len(j.Payments) > 0 {
				b.UnpaidAmount += j.RemainingAmount
			} else if j.Status == "CTT" {
				b.UnpaidAmount += j.Price
			} else {
				b.PaidAmount += j.Price
			}
		}
		for _, p := range j.Payments {
			if p.Date >= start && p.Date < end {
				ensureDay(p.Date).PaidAmount += p.Amount
			}
		}
	}

	for _, l := range allLedger {
		if l.Category == "expense" && l.Date >= start && l.Date < end {
			ensureDay(l.Date).ExpenseAmount += l.Amount
		}
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

	allJobs, err := s.queryAllWorkJobsErr()
	if err != nil {
		serverErr(w, err)
		return
	}
	allLedger, err := s.queryAllWorkLedgerErr()
	if err != nil {
		serverErr(w, err)
		return
	}

	jobs := []workJob{}
	for _, j := range allJobs {
		if j.Date == date {
			jobs = append(jobs, j)
		}
	}
	ledger := []workLedger{}
	for _, l := range allLedger {
		if l.Date == date {
			ledger = append(ledger, l)
		}
	}

	daySum := computeWorkSummaryFromSlices(allJobs, allLedger, date, true)
	monthSum := computeWorkSummaryFromSlices(allJobs, allLedger, month, false)
	unpaidGroups, debtGroups, totalUnpaidAll, totalUnpaidJobs := buildDebtGroups(allJobs, true)
	recentDays := computeMonthDaysBriefFromSlices(allJobs, allLedger, month)
	customers, services := s.workSuggestions()
	tombstones := s.queryAllTombstones()

	writeJSON(w, 200, map[string]any{
		"ok":                true,
		"db_id":             s.dbInstanceID(),
		"work_rev":          s.workRev.Load(),
		"date":              date,
		"month":             month,
		"today":             s.today(),
		"jobs":              jobs,
		"ledger":            ledger,
		"day_summary":       daySum,
		"month_summary":     monthSum,
		"unpaid_groups":     unpaidGroups,
		"debt_groups":       debtGroups,
		"total_unpaid_all":  totalUnpaidAll,
		"total_unpaid_jobs": totalUnpaidJobs,
		"recent_days":       recentDays,
		"vault_jobs":        allJobs,
		"vault_ledger":      allLedger,
		"tombstones":        tombstones,
		"suggestions": map[string]any{
			"customers": customers,
			"services":  services,
		},
	})
}

// POST /api/work/job
func (s *Server) handlePostWorkJob(w http.ResponseWriter, r *http.Request) {
	var in struct {
		UID      string `json:"uid"`
		Date     string `json:"date"`
		Customer string `json:"customer"`
		Channel  string `json:"channel"`
		Service  string `json:"service"`
		Price    int    `json:"price"`
		Status   string `json:"status"`
		Note     string `json:"note"`
		Ts       int64  `json:"ts"`
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

	uid := sanitizeSyncUID(in.UID)
	if uid != "" {
		var existingID int64
		if s.db.QueryRow(`SELECT id FROM work_jobs WHERE uid=?`, uid).Scan(&existingID) == nil && existingID > 0 {
			writeJSON(w, 200, map[string]any{"ok": true, "id": existingID, "uid": uid, "work_rev": s.workRev.Load()})
			return
		}
	} else {
		uid = s.nextUID("job")
	}

	nowSec := s.now().Unix()
	ts := nowSec
	if in.Ts > 0 && in.Ts <= nowSec+300 {
		ts = in.Ts
	}

	res, err := s.db.Exec(
		`INSERT INTO work_jobs(uid, date, customer, channel, service, price, status, note, ts, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
		uid, in.Date, cust, ch, svc, price, st, note, ts, nowSec,
	)
	if err != nil {
		serverErr(w, err)
		return
	}
	id, _ := res.LastInsertId()
	rev := s.bumpWorkRev()
	writeJSON(w, 200, map[string]any{"ok": true, "id": id, "uid": uid, "work_rev": rev})
}

// PUT /api/work/job/{id}
func (s *Server) handlePutWorkJob(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 0 {
		httpErr(w, 400, "Mã đơn không hợp lệ")
		return
	}
	var in struct {
		UID      *string `json:"uid"`
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

	lookupUID := sanitizeSyncUID(r.URL.Query().Get("uid"))
	if lookupUID == "" && in.UID != nil {
		lookupUID = sanitizeSyncUID(*in.UID)
	}
	if id == 0 && lookupUID == "" {
		httpErr(w, 400, "Mã đơn không hợp lệ")
		return
	}

	var cur workJob
	err = sql.ErrNoRows
	if id > 0 {
		err = s.db.QueryRow(`SELECT id, COALESCE(uid, ''), date, customer, channel, service, price, status, note, ts, COALESCE(updated_at, 0) FROM work_jobs WHERE id=?`, id).
			Scan(&cur.ID, &cur.UID, &cur.Date, &cur.Customer, &cur.Channel, &cur.Service, &cur.Price, &cur.Status, &cur.Note, &cur.Ts, &cur.UpdatedAt)
	}
	if err == sql.ErrNoRows && lookupUID != "" {
		err = s.db.QueryRow(`SELECT id, COALESCE(uid, ''), date, customer, channel, service, price, status, note, ts, COALESCE(updated_at, 0) FROM work_jobs WHERE uid=?`, lookupUID).
			Scan(&cur.ID, &cur.UID, &cur.Date, &cur.Customer, &cur.Channel, &cur.Service, &cur.Price, &cur.Status, &cur.Note, &cur.Ts, &cur.UpdatedAt)
	}
	if err != nil {
		httpErr(w, 404, "Không tìm thấy đơn dịch vụ này")
		return
	}

	if cur.UID == "" {
		if lookupUID != "" {
			cur.UID = lookupUID
		} else {
			cur.UID = s.nextUID("job")
		}
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

	cur.UpdatedAt = s.now().Unix()
	if _, err := s.db.Exec(
		`UPDATE work_jobs SET uid=?, date=?, customer=?, channel=?, service=?, price=?, status=?, note=?, updated_at=? WHERE id=?`,
		cur.UID, cur.Date, cur.Customer, cur.Channel, cur.Service, cur.Price, cur.Status, cur.Note, cur.UpdatedAt, cur.ID,
	); err != nil {
		serverErr(w, err)
		return
	}
	rev := s.bumpWorkRev()
	writeJSON(w, 200, map[string]any{"ok": true, "job": cur, "work_rev": rev})
}

// DELETE /api/work/job/{id}
func (s *Server) handleDelWorkJob(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	reqUID := sanitizeSyncUID(r.URL.Query().Get("uid"))
	reqSig := strings.TrimSpace(r.URL.Query().Get("sig"))
	if err != nil || id < 0 || (id == 0 && reqUID == "" && reqSig == "") {
		httpErr(w, 400, "Mã đơn không hợp lệ")
		return
	}

	tx, err := s.db.Begin()
	if err != nil {
		serverErr(w, err)
		return
	}
	defer tx.Rollback()

	nowSec := s.now().Unix()
	var j workJob
	qErr := sql.ErrNoRows
	if id > 0 {
		qErr = tx.QueryRow(`SELECT id, COALESCE(uid, ''), date, customer, channel, service, price, ts FROM work_jobs WHERE id=?`, id).
			Scan(&j.ID, &j.UID, &j.Date, &j.Customer, &j.Channel, &j.Service, &j.Price, &j.Ts)
	}
	if qErr == sql.ErrNoRows && reqUID != "" {
		qErr = tx.QueryRow(`SELECT id, COALESCE(uid, ''), date, customer, channel, service, price, ts FROM work_jobs WHERE uid=?`, reqUID).
			Scan(&j.ID, &j.UID, &j.Date, &j.Customer, &j.Channel, &j.Service, &j.Price, &j.Ts)
	}

	if qErr == nil {
		prows, pErr := tx.Query(`SELECT COALESCE(uid, ''), date, amount, note, ts FROM work_job_payments WHERE job_id=?`, j.ID)
		if pErr == nil {
			type payInfo struct {
				uid, date, note string
				amt             int
				ts              int64
			}
			var pList []payInfo
			for prows.Next() {
				var p payInfo
				if prows.Scan(&p.uid, &p.date, &p.amt, &p.note, &p.ts) == nil {
					pList = append(pList, p)
				}
			}
			prows.Close()
			for _, p := range pList {
				if err := recordTombstoneTx(tx, "job_payment", p.uid, installmentSig(p.date, p.amt, p.note, p.ts), nowSec); err != nil {
					serverErr(w, err)
					return
				}
			}
		}
		sig := workJobSig(j.Date, j.Customer, j.Channel, j.Service, j.Price, j.Ts)
		if err := recordTombstoneTx(tx, "job", j.UID, sig, nowSec); err != nil {
			serverErr(w, err)
			return
		}
		if _, err := tx.Exec(`DELETE FROM work_jobs WHERE id=?`, j.ID); err != nil {
			serverErr(w, err)
			return
		}
	} else if qErr == sql.ErrNoRows {
		if reqUID != "" || reqSig != "" {
			if err := recordTombstoneTx(tx, "job", reqUID, reqSig, nowSec); err != nil {
				serverErr(w, err)
				return
			}
		}
	} else {
		serverErr(w, qErr)
		return
	}

	pruneTombstonesTx(tx, nowSec)
	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}
	s.bumpWorkRev()
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
				`INSERT INTO work_job_payments(uid, job_id, date, amount, note, ts) VALUES(?,?,?,?,?,?)`,
				s.nextUID("jpay"), p.id, today, rem, "Trả hết nợ", ts,
			); err != nil {
				serverErr(w, err)
				return
			}
		}
	}

	res, err := tx.Exec(`UPDATE work_jobs SET status='TT', updated_at=? WHERE status='CTT' AND LOWER(TRIM(customer)) = LOWER(TRIM(?))`, ts, cust)
	if err != nil {
		serverErr(w, err)
		return
	}
	affected, _ := res.RowsAffected()
	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}
	s.bumpWorkRev()
	writeJSON(w, 200, map[string]any{"ok": true, "updated": affected})
}

// POST /api/work/job/{id}/pay
func (s *Server) handlePayWorkJob(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 0 {
		httpErr(w, 400, "Mã đơn việc không hợp lệ")
		return
	}
	var in struct {
		UID    string `json:"uid"`
		JobUID string `json:"job_uid"`
		Date   string `json:"date"`
		Amount int    `json:"amount"`
		Note   string `json:"note"`
		Ts     int64  `json:"ts"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	jobUID := sanitizeSyncUID(in.JobUID)
	if jobUID == "" {
		jobUID = sanitizeSyncUID(r.URL.Query().Get("job_uid"))
	}
	if id == 0 && jobUID == "" {
		httpErr(w, 400, "Mã đơn việc không hợp lệ")
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

	var jobID int64
	var jobPrice int
	var jobStatus string
	err = sql.ErrNoRows
	if id > 0 {
		err = tx.QueryRow(`SELECT id, price, status FROM work_jobs WHERE id=?`, id).Scan(&jobID, &jobPrice, &jobStatus)
	}
	if err == sql.ErrNoRows && jobUID != "" {
		err = tx.QueryRow(`SELECT id, price, status FROM work_jobs WHERE uid=?`, jobUID).Scan(&jobID, &jobPrice, &jobStatus)
	}
	if err == sql.ErrNoRows {
		httpErr(w, 404, "Không tìm thấy đơn việc này")
		return
	}
	if err != nil {
		serverErr(w, err)
		return
	}

	payUID := sanitizeSyncUID(in.UID)
	if payUID != "" {
		var exPay workJobPayment
		if tx.QueryRow(`SELECT id, COALESCE(uid, ''), job_id, date, amount, note, ts FROM work_job_payments WHERE uid=?`, payUID).
			Scan(&exPay.ID, &exPay.UID, &exPay.JobID, &exPay.Date, &exPay.Amount, &exPay.Note, &exPay.Ts) == nil {
			var curPaid int
			_ = tx.QueryRow(`SELECT COALESCE(SUM(amount), 0) FROM work_job_payments WHERE job_id=?`, jobID).Scan(&curPaid)
			curRem := jobPrice - curPaid
			if curRem < 0 {
				curRem = 0
			}
			over := curPaid - jobPrice
			if over < 0 {
				over = 0
			}
			writeJSON(w, 200, map[string]any{
				"ok":               true,
				"payment_id":       exPay.ID,
				"job_id":           jobID,
				"status":           jobStatus,
				"paid_amount":      curPaid,
				"remaining_amount": curRem,
				"overpaid_amount":  over,
				"settled":          curRem == 0,
				"payment":          exPay,
			})
			return
		}
	} else {
		payUID = s.nextUID("jpay")
	}

	var paid int
	var payCount int
	if err := tx.QueryRow(`SELECT COALESCE(SUM(amount), 0), COUNT(*) FROM work_job_payments WHERE job_id=?`, jobID).Scan(&paid, &payCount); err != nil {
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

	nowSec := s.now().Unix()
	ts := nowSec
	if in.Ts > 0 && in.Ts <= nowSec+300 {
		ts = in.Ts
	}
	res, err := tx.Exec(
		`INSERT INTO work_job_payments(uid, job_id, date, amount, note, ts) VALUES(?,?,?,?,?,?)`,
		payUID, jobID, in.Date, payAmt, note, ts,
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
	if _, err := tx.Exec(`UPDATE work_jobs SET status=?, updated_at=? WHERE id=?`, newStatus, nowSec, jobID); err != nil {
		serverErr(w, err)
		return
	}

	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}
	rev := s.bumpWorkRev()

	writeJSON(w, 200, map[string]any{
		"ok":               true,
		"work_rev":         rev,
		"payment_id":       payID,
		"job_id":           jobID,
		"status":           newStatus,
		"paid_amount":      newPaid,
		"remaining_amount": newRemaining,
		"overpaid_amount":  overpaid,
		"settled":          newRemaining == 0,
		"payment": workJobPayment{
			ID:     payID,
			UID:    payUID,
			JobID:  jobID,
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
	reqUID := sanitizeSyncUID(r.URL.Query().Get("uid"))
	reqSig := strings.TrimSpace(r.URL.Query().Get("sig"))
	if err != nil || id < 0 || (id == 0 && reqUID == "" && reqSig == "") {
		httpErr(w, 400, "Mã lần trả tiền không hợp lệ")
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		serverErr(w, err)
		return
	}
	defer tx.Rollback()

	nowSec := s.now().Unix()
	var pay workJobPayment
	qErr := sql.ErrNoRows
	if id > 0 {
		qErr = tx.QueryRow(`SELECT id, COALESCE(uid, ''), job_id, date, amount, note, ts FROM work_job_payments WHERE id=?`, id).
			Scan(&pay.ID, &pay.UID, &pay.JobID, &pay.Date, &pay.Amount, &pay.Note, &pay.Ts)
	}
	if qErr == sql.ErrNoRows && reqUID != "" {
		qErr = tx.QueryRow(`SELECT id, COALESCE(uid, ''), job_id, date, amount, note, ts FROM work_job_payments WHERE uid=?`, reqUID).
			Scan(&pay.ID, &pay.UID, &pay.JobID, &pay.Date, &pay.Amount, &pay.Note, &pay.Ts)
	}

	if qErr == sql.ErrNoRows {
		if reqUID != "" || reqSig != "" {
			if err := recordTombstoneTx(tx, "job_payment", reqUID, reqSig, nowSec); err != nil {
				serverErr(w, err)
				return
			}
			pruneTombstonesTx(tx, nowSec)
			if err := tx.Commit(); err != nil {
				serverErr(w, err)
				return
			}
			s.bumpWorkRev()
		}
		writeJSON(w, 200, map[string]any{"ok": true})
		return
	}
	if qErr != nil {
		serverErr(w, qErr)
		return
	}

	if err := recordTombstoneTx(tx, "job_payment", pay.UID, installmentSig(pay.Date, pay.Amount, pay.Note, pay.Ts), nowSec); err != nil {
		serverErr(w, err)
		return
	}
	if _, err := tx.Exec(`DELETE FROM work_job_payments WHERE id=?`, pay.ID); err != nil {
		serverErr(w, err)
		return
	}
	var jobPrice int
	var paid int
	if err := tx.QueryRow(`SELECT price FROM work_jobs WHERE id=?`, pay.JobID).Scan(&jobPrice); err == nil {
		_ = tx.QueryRow(`SELECT COALESCE(SUM(amount), 0) FROM work_job_payments WHERE job_id=?`, pay.JobID).Scan(&paid)
		newStatus := "CTT"
		if paid >= jobPrice {
			newStatus = "TT"
		}
		if _, err := tx.Exec(`UPDATE work_jobs SET status=?, updated_at=? WHERE id=?`, newStatus, nowSec, pay.JobID); err != nil {
			serverErr(w, err)
			return
		}
	}
	pruneTombstonesTx(tx, nowSec)
	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}
	s.bumpWorkRev()
	writeJSON(w, 200, map[string]any{"ok": true})
}

// POST /api/work/ledger
func (s *Server) handlePostWorkLedger(w http.ResponseWriter, r *http.Request) {
	var in struct {
		UID      string `json:"uid"`
		Date     string `json:"date"`
		Category string `json:"category"`
		Amount   int    `json:"amount"`
		Note     string `json:"note"`
		Ts       int64  `json:"ts"`
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

	uid := sanitizeSyncUID(in.UID)
	if uid != "" {
		var existingID int64
		if s.db.QueryRow(`SELECT id FROM work_ledger WHERE uid=?`, uid).Scan(&existingID) == nil && existingID > 0 {
			writeJSON(w, 200, map[string]any{"ok": true, "id": existingID, "uid": uid, "work_rev": s.workRev.Load()})
			return
		}
	} else {
		uid = s.nextUID("ldg")
	}

	nowSec := s.now().Unix()
	ts := nowSec
	if in.Ts > 0 && in.Ts <= nowSec+300 {
		ts = in.Ts
	}

	res, err := s.db.Exec(
		`INSERT INTO work_ledger(uid, date, category, amount, note, ts, updated_at) VALUES(?,?,?,?,?,?,?)`,
		uid, in.Date, in.Category, amt, note, ts, nowSec,
	)
	if err != nil {
		serverErr(w, err)
		return
	}
	id, _ := res.LastInsertId()
	rev := s.bumpWorkRev()
	writeJSON(w, 200, map[string]any{"ok": true, "id": id, "uid": uid, "work_rev": rev})
}

// DELETE /api/work/ledger/{id}
func (s *Server) handleDelWorkLedger(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	reqUID := sanitizeSyncUID(r.URL.Query().Get("uid"))
	reqSig := strings.TrimSpace(r.URL.Query().Get("sig"))
	if err != nil || id < 0 || (id == 0 && reqUID == "" && reqSig == "") {
		httpErr(w, 400, "Mã khoản thu chi không hợp lệ")
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		serverErr(w, err)
		return
	}
	defer tx.Rollback()

	nowSec := s.now().Unix()
	var l workLedger
	qErr := sql.ErrNoRows
	if id > 0 {
		qErr = tx.QueryRow(`SELECT id, COALESCE(uid, ''), date, category, amount, note, ts FROM work_ledger WHERE id=?`, id).
			Scan(&l.ID, &l.UID, &l.Date, &l.Category, &l.Amount, &l.Note, &l.Ts)
	}
	if qErr == sql.ErrNoRows && reqUID != "" {
		qErr = tx.QueryRow(`SELECT id, COALESCE(uid, ''), date, category, amount, note, ts FROM work_ledger WHERE uid=?`, reqUID).
			Scan(&l.ID, &l.UID, &l.Date, &l.Category, &l.Amount, &l.Note, &l.Ts)
	}

	if qErr == nil {
		rrows, rErr := tx.Query(`SELECT COALESCE(uid, ''), date, amount, note, ts FROM work_ledger_repayments WHERE ledger_id=?`, l.ID)
		if rErr == nil {
			type repInfo struct {
				uid, date, note string
				amt             int
				ts              int64
			}
			var rList []repInfo
			for rrows.Next() {
				var rep repInfo
				if rrows.Scan(&rep.uid, &rep.date, &rep.amt, &rep.note, &rep.ts) == nil {
					rList = append(rList, rep)
				}
			}
			rrows.Close()
			for _, rep := range rList {
				if err := recordTombstoneTx(tx, "repayment", rep.uid, installmentSig(rep.date, rep.amt, rep.note, rep.ts), nowSec); err != nil {
					serverErr(w, err)
					return
				}
			}
		}
		sig := workLedgerSig(l.Date, l.Category, l.Amount, l.Note, l.Ts)
		if err := recordTombstoneTx(tx, "ledger", l.UID, sig, nowSec); err != nil {
			serverErr(w, err)
			return
		}
		if _, err := tx.Exec(`DELETE FROM work_ledger WHERE id=?`, l.ID); err != nil {
			serverErr(w, err)
			return
		}
	} else if qErr == sql.ErrNoRows {
		if reqUID != "" || reqSig != "" {
			if err := recordTombstoneTx(tx, "ledger", reqUID, reqSig, nowSec); err != nil {
				serverErr(w, err)
				return
			}
		}
	} else {
		serverErr(w, qErr)
		return
	}

	pruneTombstonesTx(tx, nowSec)
	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}
	s.bumpWorkRev()
	writeJSON(w, 200, map[string]any{"ok": true})
}

// POST /api/work/ledger/{id}/repay
func (s *Server) handleRepayWorkLedger(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 0 {
		httpErr(w, 400, "Mã khoản mượn không hợp lệ")
		return
	}
	var in struct {
		UID       string `json:"uid"`
		LedgerUID string `json:"ledger_uid"`
		Date      string `json:"date"`
		Amount    int    `json:"amount"`
		Note      string `json:"note"`
		Ts        int64  `json:"ts"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	ledgerUID := sanitizeSyncUID(in.LedgerUID)
	if ledgerUID == "" {
		ledgerUID = sanitizeSyncUID(r.URL.Query().Get("ledger_uid"))
	}
	if id == 0 && ledgerUID == "" {
		httpErr(w, 400, "Mã khoản mượn không hợp lệ")
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

	var ledgerID int64
	var cat string
	var borrowAmt int
	err = sql.ErrNoRows
	if id > 0 {
		err = tx.QueryRow(`SELECT id, category, amount FROM work_ledger WHERE id=?`, id).Scan(&ledgerID, &cat, &borrowAmt)
	}
	if err == sql.ErrNoRows && ledgerUID != "" {
		err = tx.QueryRow(`SELECT id, category, amount FROM work_ledger WHERE uid=?`, ledgerUID).Scan(&ledgerID, &cat, &borrowAmt)
	}
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

	repUID := sanitizeSyncUID(in.UID)
	if repUID != "" {
		var exRep workLedgerRepayment
		if tx.QueryRow(`SELECT id, COALESCE(uid, ''), ledger_id, date, amount, note, ts FROM work_ledger_repayments WHERE uid=?`, repUID).
			Scan(&exRep.ID, &exRep.UID, &exRep.LedgerID, &exRep.Date, &exRep.Amount, &exRep.Note, &exRep.Ts) == nil {
			var curPaid int
			_ = tx.QueryRow(`SELECT COALESCE(SUM(amount), 0) FROM work_ledger_repayments WHERE ledger_id=?`, ledgerID).Scan(&curPaid)
			curRem := borrowAmt - curPaid
			if curRem < 0 {
				curRem = 0
			}
			over := curPaid - borrowAmt
			if over < 0 {
				over = 0
			}
			writeJSON(w, 200, map[string]any{
				"ok":               true,
				"repayment_id":     exRep.ID,
				"ledger_id":        ledgerID,
				"paid_amount":      curPaid,
				"remaining_amount": curRem,
				"overpaid_amount":  over,
				"settled":          curRem == 0,
				"repayment":        exRep,
			})
			return
		}
	} else {
		repUID = s.nextUID("lrep")
	}

	var paid int
	if err := tx.QueryRow(`SELECT COALESCE(SUM(amount), 0) FROM work_ledger_repayments WHERE ledger_id=?`, ledgerID).Scan(&paid); err != nil {
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

	nowSec := s.now().Unix()
	ts := nowSec
	if in.Ts > 0 && in.Ts <= nowSec+300 {
		ts = in.Ts
	}
	res, err := tx.Exec(
		`INSERT INTO work_ledger_repayments(uid, ledger_id, date, amount, note, ts) VALUES(?,?,?,?,?,?)`,
		repUID, ledgerID, in.Date, payAmt, note, ts,
	)
	if err != nil {
		serverErr(w, err)
		return
	}
	repayID, _ := res.LastInsertId()
	_, _ = tx.Exec(`UPDATE work_ledger SET updated_at=? WHERE id=?`, nowSec, ledgerID)
	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}
	rev := s.bumpWorkRev()

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
		"work_rev":         rev,
		"repayment_id":     repayID,
		"ledger_id":        ledgerID,
		"paid_amount":      newPaid,
		"remaining_amount": newRemaining,
		"overpaid_amount":  overpaid,
		"settled":          newRemaining == 0,
		"repayment": workLedgerRepayment{
			ID:       repayID,
			UID:      repUID,
			LedgerID: ledgerID,
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
	reqUID := sanitizeSyncUID(r.URL.Query().Get("uid"))
	reqSig := strings.TrimSpace(r.URL.Query().Get("sig"))
	if err != nil || id < 0 || (id == 0 && reqUID == "" && reqSig == "") {
		httpErr(w, 400, "Mã lần trả tiền không hợp lệ")
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		serverErr(w, err)
		return
	}
	defer tx.Rollback()

	nowSec := s.now().Unix()
	var rep workLedgerRepayment
	qErr := sql.ErrNoRows
	if id > 0 {
		qErr = tx.QueryRow(`SELECT id, COALESCE(uid, ''), ledger_id, date, amount, note, ts FROM work_ledger_repayments WHERE id=?`, id).
			Scan(&rep.ID, &rep.UID, &rep.LedgerID, &rep.Date, &rep.Amount, &rep.Note, &rep.Ts)
	}
	if qErr == sql.ErrNoRows && reqUID != "" {
		qErr = tx.QueryRow(`SELECT id, COALESCE(uid, ''), ledger_id, date, amount, note, ts FROM work_ledger_repayments WHERE uid=?`, reqUID).
			Scan(&rep.ID, &rep.UID, &rep.LedgerID, &rep.Date, &rep.Amount, &rep.Note, &rep.Ts)
	}

	if qErr == nil {
		if err := recordTombstoneTx(tx, "repayment", rep.UID, installmentSig(rep.Date, rep.Amount, rep.Note, rep.Ts), nowSec); err != nil {
			serverErr(w, err)
			return
		}
		if _, err := tx.Exec(`DELETE FROM work_ledger_repayments WHERE id=?`, rep.ID); err != nil {
			serverErr(w, err)
			return
		}
		_, _ = tx.Exec(`UPDATE work_ledger SET updated_at=? WHERE id=?`, nowSec, rep.LedgerID)
	} else if qErr == sql.ErrNoRows {
		if reqUID != "" || reqSig != "" {
			if err := recordTombstoneTx(tx, "repayment", reqUID, reqSig, nowSec); err != nil {
				serverErr(w, err)
				return
			}
		}
	} else {
		serverErr(w, qErr)
		return
	}

	pruneTombstonesTx(tx, nowSec)
	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}
	s.bumpWorkRev()
	writeJSON(w, 200, map[string]any{"ok": true})
}

// GET /api/work/export?month=YYYY-MM
func (s *Server) handleExportWorkCSV(w http.ResponseWriter, r *http.Request) {
	month := r.URL.Query().Get("month")
	if !validMonth(month) {
		month = s.today()[:7]
	}
	start, end := monthDateRange(month)

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

	rows, err := s.db.Query(`SELECT date, customer, channel, service, price, status, note FROM work_jobs WHERE date >= ? AND date < ? ORDER BY date ASC, id ASC`, start, end)
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
	lrows, err := s.db.Query(`SELECT id, date, category, amount, note FROM work_ledger WHERE date >= ? AND date < ? ORDER BY date ASC, id ASC`, start, end)
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
		WHERE r.date >= ? AND r.date < ?
		ORDER BY r.date ASC, r.id ASC`, start, end)
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
	s.dbIDOnce.Do(func() {
		var id string
		err := s.db.QueryRow(`SELECT value FROM settings WHERE key='_db_instance_id'`).Scan(&id)
		if err == nil && id != "" {
			s.dbID = id
			return
		}
		id = fmt.Sprintf("db_%d", time.Now().UnixNano())
		_, _ = s.db.Exec(`INSERT INTO settings(key,value) VALUES('_db_instance_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, id)
		s.dbID = id
	})
	return s.dbID
}

func (s *Server) queryAllWorkJobsErr() ([]workJob, error) {
	rows, err := s.db.Query(`SELECT id, COALESCE(uid, ''), date, customer, channel, service, price, status, note, ts, COALESCE(updated_at, 0) FROM work_jobs ORDER BY date ASC, id ASC`)
	if err != nil {
		return nil, err
	}
	out := []workJob{}
	for rows.Next() {
		var j workJob
		if err := rows.Scan(&j.ID, &j.UID, &j.Date, &j.Customer, &j.Channel, &j.Service, &j.Price, &j.Status, &j.Note, &j.Ts, &j.UpdatedAt); err != nil {
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
	if err := s.attachJobPaymentsMode(out, true); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Server) queryAllWorkJobs() []workJob {
	out, err := s.queryAllWorkJobsErr()
	if err != nil {
		return []workJob{}
	}
	return out
}

func (s *Server) queryAllWorkLedgerErr() ([]workLedger, error) {
	rows, err := s.db.Query(`SELECT id, COALESCE(uid, ''), date, category, amount, note, ts, COALESCE(updated_at, 0) FROM work_ledger ORDER BY date ASC, id ASC`)
	if err != nil {
		return nil, err
	}
	out := []workLedger{}
	for rows.Next() {
		var l workLedger
		if err := rows.Scan(&l.ID, &l.UID, &l.Date, &l.Category, &l.Amount, &l.Note, &l.Ts, &l.UpdatedAt); err != nil {
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
	if err := s.attachLedgerRepaymentsMode(out, true); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Server) queryAllWorkLedger() []workLedger {
	out, err := s.queryAllWorkLedgerErr()
	if err != nil {
		return []workLedger{}
	}
	return out
}

func tombstoneBlocksItem(deadUID map[string]int64, deadSig map[string]int64, uid, sig string, itemTime int64) bool {
	if uid != "" && deadUID != nil && deadUID[uid] > 0 {
		return true
	}
	if sig != "" && deadSig != nil {
		if delAt := deadSig[sig]; delAt > 0 && (itemTime <= 0 || delAt >= itemTime) {
			return true
		}
	}
	return false
}

func (s *Server) insertVaultJobPayments(tx *sql.Tx, jobID int64, price int, fallbackTs int64, pays []workJobPayment, existing map[string]bool) error {
	return s.insertVaultJobPaymentsFiltered(tx, jobID, price, fallbackTs, pays, nil, existing, nil, nil)
}

func (s *Server) insertVaultJobPaymentsFiltered(
	tx *sql.Tx,
	jobID int64,
	price int,
	fallbackTs int64,
	pays []workJobPayment,
	existingUID map[string]bool,
	existingSig map[string]bool,
	deadUID map[string]int64,
	deadSig map[string]int64,
) error {
	if len(pays) == 0 {
		return nil
	}
	var currentPaid int
	_ = tx.QueryRow(`SELECT COALESCE(SUM(amount), 0) FROM work_job_payments WHERE job_id=?`, jobID).Scan(&currentPaid)

	for _, pay := range pays {
		if !validDate(pay.Date) {
			continue
		}
		payTs := pay.Ts
		if payTs <= 0 {
			payTs = fallbackTs
		}
		payNote := strings.TrimSpace(pay.Note)
		payUID := sanitizeSyncUID(pay.UID)
		rawSig := installmentSig(pay.Date, normalizeVND(pay.Amount), payNote, payTs)
		if tombstoneBlocksItem(deadUID, deadSig, payUID, rawSig, payTs) {
			continue
		}
		if payUID != "" && existingUID != nil && existingUID[payUID] {
			continue
		}
		payAmt := normalizeInstallmentAmount(pay.Amount, price-currentPaid)
		if payAmt <= 0 {
			continue
		}
		sig := installmentSig(pay.Date, payAmt, payNote, payTs)
		if tombstoneBlocksItem(deadUID, deadSig, payUID, sig, payTs) {
			continue
		}
		if existingSig != nil && existingSig[sig] {
			continue
		}
		if payUID == "" {
			payUID = s.nextUID("jpay")
		}
		if _, err := tx.Exec(
			`INSERT INTO work_job_payments(uid, job_id, date, amount, note, ts) VALUES(?,?,?,?,?,?)`,
			payUID, jobID, pay.Date, payAmt, payNote, payTs,
		); err != nil {
			return err
		}
		currentPaid += payAmt
		if existingUID != nil {
			existingUID[payUID] = true
		}
		if existingSig != nil {
			existingSig[sig] = true
		}
	}
	if currentPaid >= price {
		_, _ = tx.Exec(`UPDATE work_jobs SET status='TT', updated_at=MAX(COALESCE(updated_at,0), ?) WHERE id=? AND status='CTT'`, s.now().Unix(), jobID)
	}
	return nil
}

func (s *Server) insertVaultRepayments(tx *sql.Tx, ledgerID int64, borrowAmt int, fallbackTs int64, reps []workLedgerRepayment, existing map[string]bool) error {
	return s.insertVaultRepaymentsFiltered(tx, ledgerID, borrowAmt, fallbackTs, reps, nil, existing, nil, nil)
}

func (s *Server) insertVaultRepaymentsFiltered(
	tx *sql.Tx,
	ledgerID int64,
	borrowAmt int,
	fallbackTs int64,
	reps []workLedgerRepayment,
	existingUID map[string]bool,
	existingSig map[string]bool,
	deadUID map[string]int64,
	deadSig map[string]int64,
) error {
	if len(reps) == 0 {
		return nil
	}
	var currentPaid int
	_ = tx.QueryRow(`SELECT COALESCE(SUM(amount), 0) FROM work_ledger_repayments WHERE ledger_id=?`, ledgerID).Scan(&currentPaid)

	for _, rep := range reps {
		if !validDate(rep.Date) {
			continue
		}
		repTs := rep.Ts
		if repTs <= 0 {
			repTs = fallbackTs
		}
		repNote := strings.TrimSpace(rep.Note)
		repUID := sanitizeSyncUID(rep.UID)
		rawSig := installmentSig(rep.Date, normalizeVND(rep.Amount), repNote, repTs)
		if tombstoneBlocksItem(deadUID, deadSig, repUID, rawSig, repTs) {
			continue
		}
		if repUID != "" && existingUID != nil && existingUID[repUID] {
			continue
		}
		repAmt := normalizeInstallmentAmount(rep.Amount, borrowAmt-currentPaid)
		if repAmt <= 0 {
			continue
		}
		sig := installmentSig(rep.Date, repAmt, repNote, repTs)
		if tombstoneBlocksItem(deadUID, deadSig, repUID, sig, repTs) {
			continue
		}
		if existingSig != nil && existingSig[sig] {
			continue
		}
		if repUID == "" {
			repUID = s.nextUID("lrep")
		}
		if _, err := tx.Exec(
			`INSERT INTO work_ledger_repayments(uid, ledger_id, date, amount, note, ts) VALUES(?,?,?,?,?,?)`,
			repUID, ledgerID, rep.Date, repAmt, repNote, repTs,
		); err != nil {
			return err
		}
		currentPaid += repAmt
		if existingUID != nil {
			existingUID[repUID] = true
		}
		if existingSig != nil {
			existingSig[sig] = true
		}
	}
	return nil
}

// GET /api/work/vault
func (s *Server) handleGetWorkVault(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{
		"ok":         true,
		"db_id":      s.dbInstanceID(),
		"work_rev":   s.workRev.Load(),
		"jobs":       s.queryAllWorkJobs(),
		"ledger":     s.queryAllWorkLedger(),
		"tombstones": s.queryAllTombstones(),
	})
}

// POST /api/work/vault
func (s *Server) handleSyncWorkVault(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Mode       string          `json:"mode"` // "replace" hoặc "merge"
		Jobs       []workJob       `json:"jobs"`
		Ledger     []workLedger    `json:"ledger"`
		Tombstones []workTombstone `json:"tombstones"`
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

	nowSec := s.now().Unix()
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
		if _, err := tx.Exec(`DELETE FROM work_tombstones`); err != nil {
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
				ts = nowSec
			}
			upd := j.UpdatedAt
			if upd < ts {
				upd = ts
			}
			uid := sanitizeSyncUID(j.UID)
			if uid == "" {
				uid = s.nextUID("job")
			}
			res, err := tx.Exec(
				`INSERT INTO work_jobs(uid, date, customer, channel, service, price, status, note, ts, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
				uid, j.Date, cust, validChannel(j.Channel), svc, price, validJobStatus(j.Status), strings.TrimSpace(j.Note), ts, upd,
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
				ts = nowSec
			}
			upd := l.UpdatedAt
			if upd < ts {
				upd = ts
			}
			uid := sanitizeSyncUID(l.UID)
			if uid == "" {
				uid = s.nextUID("ldg")
			}
			res, err := tx.Exec(
				`INSERT INTO work_ledger(uid, date, category, amount, note, ts, updated_at) VALUES(?,?,?,?,?,?,?)`,
				uid, l.Date, l.Category, amt, strings.TrimSpace(l.Note), ts, upd,
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
		for _, tb := range in.Tombstones {
			tbUID := tb.UID
			if strings.HasPrefix(tbUID, "sig:") {
				tbUID = ""
			}
			if err := recordTombstoneTx(tx, tb.Kind, tbUID, tb.Sig, tb.DeletedAt); err != nil {
				serverErr(w, err)
				return
			}
		}
	} else {
		// Chế độ "merge" đa thiết bị: hợp nhất tombstone xóa trước khi gộp dữ liệu theo uid/updated_at để tránh hồi sinh bản ghi đã xóa
		for _, tb := range in.Tombstones {
			tbUID := tb.UID
			if strings.HasPrefix(tbUID, "sig:") {
				tbUID = ""
			}
			if err := recordTombstoneTx(tx, tb.Kind, tbUID, tb.Sig, tb.DeletedAt); err != nil {
				serverErr(w, err)
				return
			}
		}

		deadUID := map[string]map[string]int64{}
		deadSig := map[string]map[string]int64{}
		trows, err := tx.Query(`SELECT uid, kind, sig, deleted_at FROM work_tombstones`)
		if err == nil {
			for trows.Next() {
				var tb workTombstone
				if trows.Scan(&tb.UID, &tb.Kind, &tb.Sig, &tb.DeletedAt) == nil {
					if tb.UID != "" && !strings.HasPrefix(tb.UID, "sig:") {
						if deadUID[tb.Kind] == nil {
							deadUID[tb.Kind] = map[string]int64{}
						}
						if tb.DeletedAt > deadUID[tb.Kind][tb.UID] {
							deadUID[tb.Kind][tb.UID] = tb.DeletedAt
						}
					}
					if tb.Sig != "" {
						if deadSig[tb.Kind] == nil {
							deadSig[tb.Kind] = map[string]int64{}
						}
						if tb.DeletedAt > deadSig[tb.Kind][tb.Sig] {
							deadSig[tb.Kind][tb.Sig] = tb.DeletedAt
						}
					}
				}
			}
			trows.Close()
		}

		// Áp dụng tombstone xóa lên các bản ghi đang có trên DB trước khi merge (đóng Rows trước mọi Exec trên tx)
		if len(deadUID["job_payment"]) > 0 || len(deadSig["job_payment"]) > 0 {
			type dbPayRow struct {
				id, jobID, ts int64
				uid, date     string
				amt           int
				note          string
			}
			var delPays []dbPayRow
			prows, err := tx.Query(`SELECT id, COALESCE(uid,''), job_id, date, amount, note, ts FROM work_job_payments`)
			if err == nil {
				for prows.Next() {
					var p dbPayRow
					if prows.Scan(&p.id, &p.uid, &p.jobID, &p.date, &p.amt, &p.note, &p.ts) == nil {
						if tombstoneBlocksItem(deadUID["job_payment"], deadSig["job_payment"], p.uid, installmentSig(p.date, p.amt, p.note, p.ts), p.ts) {
							delPays = append(delPays, p)
						}
					}
				}
				prows.Close()
			}
			affectedJobs := map[int64]bool{}
			for _, p := range delPays {
				if _, err := tx.Exec(`DELETE FROM work_job_payments WHERE id=?`, p.id); err != nil {
					serverErr(w, err)
					return
				}
				affectedJobs[p.jobID] = true
			}
			for jid := range affectedJobs {
				var price, paid int
				if tx.QueryRow(`SELECT price FROM work_jobs WHERE id=?`, jid).Scan(&price) == nil {
					_ = tx.QueryRow(`SELECT COALESCE(SUM(amount),0) FROM work_job_payments WHERE job_id=?`, jid).Scan(&paid)
					if paid < price {
						_, _ = tx.Exec(`UPDATE work_jobs SET status='CTT', updated_at=? WHERE id=? AND status='TT'`, nowSec, jid)
					}
				}
			}
		}

		if len(deadUID["job"]) > 0 || len(deadSig["job"]) > 0 {
			var delJobIDs []int64
			jdelRows, err := tx.Query(`SELECT id, COALESCE(uid,''), date, customer, channel, service, price, ts, COALESCE(updated_at,0) FROM work_jobs`)
			if err == nil {
				for jdelRows.Next() {
					var id, ts, upd int64
					var uid, d, cust, ch, svc string
					var pr int
					if jdelRows.Scan(&id, &uid, &d, &cust, &ch, &svc, &pr, &ts, &upd) == nil {
						itemTime := upd
						if itemTime < ts {
							itemTime = ts
						}
						if tombstoneBlocksItem(deadUID["job"], deadSig["job"], uid, workJobSig(d, cust, ch, svc, pr, ts), itemTime) {
							delJobIDs = append(delJobIDs, id)
						}
					}
				}
				jdelRows.Close()
			}
			for _, id := range delJobIDs {
				_, _ = tx.Exec(`DELETE FROM work_job_payments WHERE job_id=?`, id)
				_, _ = tx.Exec(`DELETE FROM work_jobs WHERE id=?`, id)
			}
		}

		if len(deadUID["repayment"]) > 0 || len(deadSig["repayment"]) > 0 {
			var delRepIDs []int64
			rdelRows, err := tx.Query(`SELECT id, COALESCE(uid,''), date, amount, note, ts FROM work_ledger_repayments`)
			if err == nil {
				for rdelRows.Next() {
					var id, ts int64
					var uid, d, note string
					var amt int
					if rdelRows.Scan(&id, &uid, &d, &amt, &note, &ts) == nil {
						if tombstoneBlocksItem(deadUID["repayment"], deadSig["repayment"], uid, installmentSig(d, amt, note, ts), ts) {
							delRepIDs = append(delRepIDs, id)
						}
					}
				}
				rdelRows.Close()
			}
			for _, id := range delRepIDs {
				_, _ = tx.Exec(`DELETE FROM work_ledger_repayments WHERE id=?`, id)
			}
		}

		if len(deadUID["ledger"]) > 0 || len(deadSig["ledger"]) > 0 {
			var delLedgerIDs []int64
			ldelRows, err := tx.Query(`SELECT id, COALESCE(uid,''), date, category, amount, note, ts, COALESCE(updated_at,0) FROM work_ledger`)
			if err == nil {
				for ldelRows.Next() {
					var id, ts, upd int64
					var uid, d, cat, note string
					var amt int
					if ldelRows.Scan(&id, &uid, &d, &cat, &amt, &note, &ts, &upd) == nil {
						itemTime := upd
						if itemTime < ts {
							itemTime = ts
						}
						if tombstoneBlocksItem(deadUID["ledger"], deadSig["ledger"], uid, workLedgerSig(d, cat, amt, note, ts), itemTime) {
							delLedgerIDs = append(delLedgerIDs, id)
						}
					}
				}
				ldelRows.Close()
			}
			for _, id := range delLedgerIDs {
				_, _ = tx.Exec(`DELETE FROM work_ledger_repayments WHERE ledger_id=?`, id)
				_, _ = tx.Exec(`DELETE FROM work_ledger WHERE id=?`, id)
			}
		}

		type existingJobInfo struct {
			id        int64
			uid       string
			status    string
			updatedAt int64
		}
		existingJobsByUID := map[string]*existingJobInfo{}
		existingJobsBySig := map[string]*existingJobInfo{}
		jrows, err := tx.Query(`SELECT id, COALESCE(uid,''), date, customer, channel, service, price, status, ts, COALESCE(updated_at,0) FROM work_jobs`)
		if err == nil {
			for jrows.Next() {
				var id, ts, upd int64
				var uid, d, cust, ch, svc, st string
				var pr int
				if jrows.Scan(&id, &uid, &d, &cust, &ch, &svc, &pr, &st, &ts, &upd) == nil {
					info := &existingJobInfo{id: id, uid: uid, status: st, updatedAt: upd}
					sig := workJobSig(d, cust, ch, svc, pr, ts)
					if uid != "" {
						existingJobsByUID[uid] = info
					}
					existingJobsBySig[sig] = info
				}
			}
			jrows.Close()
		}

		existingPayUID := map[int64]map[string]bool{}
		existingPaySig := map[int64]map[string]bool{}
		jprows, err := tx.Query(`SELECT COALESCE(uid,''), job_id, date, amount, note, ts FROM work_job_payments`)
		if err == nil {
			for jprows.Next() {
				var jid, pts int64
				var puid, pd, pnote string
				var pamt int
				if jprows.Scan(&puid, &jid, &pd, &pamt, &pnote, &pts) == nil {
					if existingPayUID[jid] == nil {
						existingPayUID[jid] = map[string]bool{}
					}
					if existingPaySig[jid] == nil {
						existingPaySig[jid] = map[string]bool{}
					}
					if puid != "" {
						existingPayUID[jid][puid] = true
					}
					existingPaySig[jid][installmentSig(pd, pamt, pnote, pts)] = true
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
				ts = nowSec
			}
			upd := j.UpdatedAt
			if upd < ts {
				upd = ts
			}
			ch := validChannel(j.Channel)
			st := validJobStatus(j.Status)
			note := strings.TrimSpace(j.Note)
			uid := sanitizeSyncUID(j.UID)
			sig := workJobSig(j.Date, cust, ch, svc, price, ts)
			if tombstoneBlocksItem(deadUID["job"], deadSig["job"], uid, sig, upd) {
				continue
			}

			var ex *existingJobInfo
			if uid != "" {
				ex = existingJobsByUID[uid]
			}
			if ex == nil {
				ex = existingJobsBySig[sig]
			}

			var targetJobID int64
			if ex != nil {
				targetJobID = ex.id
				if ex.uid == "" && uid != "" {
					_, _ = tx.Exec(`UPDATE work_jobs SET uid=? WHERE id=?`, uid, ex.id)
					ex.uid = uid
					existingJobsByUID[uid] = ex
				}
				if j.UpdatedAt > ex.updatedAt && j.UpdatedAt > 0 {
					_, _ = tx.Exec(
						`UPDATE work_jobs SET customer=?, channel=?, service=?, price=?, status=?, note=?, updated_at=? WHERE id=?`,
						cust, ch, svc, price, st, note, j.UpdatedAt, ex.id,
					)
					ex.status = st
					ex.updatedAt = j.UpdatedAt
				} else if ex.status == "CTT" && st == "TT" && j.UpdatedAt == 0 && ex.updatedAt == 0 {
					_, _ = tx.Exec(`UPDATE work_jobs SET status='TT', updated_at=? WHERE id=?`, nowSec, ex.id)
					ex.status = "TT"
					ex.updatedAt = nowSec
				}
			} else {
				if uid == "" {
					uid = s.nextUID("job")
				}
				res, err := tx.Exec(
					`INSERT INTO work_jobs(uid, date, customer, channel, service, price, status, note, ts, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
					uid, j.Date, cust, ch, svc, price, st, note, ts, upd,
				)
				if err != nil {
					serverErr(w, err)
					return
				}
				targetJobID, _ = res.LastInsertId()
				info := &existingJobInfo{id: targetJobID, uid: uid, status: st, updatedAt: upd}
				existingJobsByUID[uid] = info
				existingJobsBySig[sig] = info
			}
			if len(j.Payments) > 0 {
				if existingPayUID[targetJobID] == nil {
					existingPayUID[targetJobID] = map[string]bool{}
				}
				if existingPaySig[targetJobID] == nil {
					existingPaySig[targetJobID] = map[string]bool{}
				}
				if err := s.insertVaultJobPaymentsFiltered(
					tx, targetJobID, price, ts, j.Payments,
					existingPayUID[targetJobID], existingPaySig[targetJobID],
					deadUID["job_payment"], deadSig["job_payment"],
				); err != nil {
					serverErr(w, err)
					return
				}
			}
		}

		type existingLedgerInfo struct {
			id        int64
			uid       string
			updatedAt int64
		}
		existingLedgerByUID := map[string]*existingLedgerInfo{}
		existingLedgerBySig := map[string]*existingLedgerInfo{}
		lrows, err := tx.Query(`SELECT id, COALESCE(uid,''), date, category, amount, note, ts, COALESCE(updated_at,0) FROM work_ledger`)
		if err == nil {
			for lrows.Next() {
				var id, ts, upd int64
				var uid, d, cat, note string
				var amt int
				if lrows.Scan(&id, &uid, &d, &cat, &amt, &note, &ts, &upd) == nil {
					info := &existingLedgerInfo{id: id, uid: uid, updatedAt: upd}
					sig := workLedgerSig(d, cat, amt, note, ts)
					if uid != "" {
						existingLedgerByUID[uid] = info
					}
					existingLedgerBySig[sig] = info
				}
			}
			lrows.Close()
		}

		existingRepUID := map[int64]map[string]bool{}
		existingRepSig := map[int64]map[string]bool{}
		rrows, err := tx.Query(`SELECT COALESCE(uid,''), ledger_id, date, amount, note, ts FROM work_ledger_repayments`)
		if err == nil {
			for rrows.Next() {
				var lid, rts int64
				var ruid, rd, rnote string
				var ramt int
				if rrows.Scan(&ruid, &lid, &rd, &ramt, &rnote, &rts) == nil {
					if existingRepUID[lid] == nil {
						existingRepUID[lid] = map[string]bool{}
					}
					if existingRepSig[lid] == nil {
						existingRepSig[lid] = map[string]bool{}
					}
					if ruid != "" {
						existingRepUID[lid][ruid] = true
					}
					existingRepSig[lid][installmentSig(rd, ramt, rnote, rts)] = true
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
				ts = nowSec
			}
			upd := l.UpdatedAt
			if upd < ts {
				upd = ts
			}
			note := strings.TrimSpace(l.Note)
			uid := sanitizeSyncUID(l.UID)
			sig := workLedgerSig(l.Date, l.Category, amt, note, ts)
			if tombstoneBlocksItem(deadUID["ledger"], deadSig["ledger"], uid, sig, upd) {
				continue
			}

			var ex *existingLedgerInfo
			if uid != "" {
				ex = existingLedgerByUID[uid]
			}
			if ex == nil {
				ex = existingLedgerBySig[sig]
			}

			var targetID int64
			if ex != nil {
				targetID = ex.id
				if ex.uid == "" && uid != "" {
					_, _ = tx.Exec(`UPDATE work_ledger SET uid=? WHERE id=?`, uid, ex.id)
					ex.uid = uid
					existingLedgerByUID[uid] = ex
				}
				if l.UpdatedAt > ex.updatedAt && l.UpdatedAt > 0 {
					_, _ = tx.Exec(
						`UPDATE work_ledger SET amount=?, note=?, updated_at=? WHERE id=?`,
						amt, note, l.UpdatedAt, ex.id,
					)
					ex.updatedAt = l.UpdatedAt
				}
			} else {
				if uid == "" {
					uid = s.nextUID("ldg")
				}
				res, err := tx.Exec(
					`INSERT INTO work_ledger(uid, date, category, amount, note, ts, updated_at) VALUES(?,?,?,?,?,?,?)`,
					uid, l.Date, l.Category, amt, note, ts, upd,
				)
				if err != nil {
					serverErr(w, err)
					return
				}
				targetID, _ = res.LastInsertId()
				info := &existingLedgerInfo{id: targetID, uid: uid, updatedAt: upd}
				existingLedgerByUID[uid] = info
				existingLedgerBySig[sig] = info
			}
			if l.Category == "borrow" && len(l.Repayments) > 0 {
				if existingRepUID[targetID] == nil {
					existingRepUID[targetID] = map[string]bool{}
				}
				if existingRepSig[targetID] == nil {
					existingRepSig[targetID] = map[string]bool{}
				}
				if err := s.insertVaultRepaymentsFiltered(
					tx, targetID, amt, ts, l.Repayments,
					existingRepUID[targetID], existingRepSig[targetID],
					deadUID["repayment"], deadSig["repayment"],
				); err != nil {
					serverErr(w, err)
					return
				}
			}
		}

		pruneTombstonesTx(tx, nowSec)
	}

	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}

	rev := s.bumpWorkRev()
	writeJSON(w, 200, map[string]any{
		"ok":         true,
		"db_id":      s.dbInstanceID(),
		"work_rev":   rev,
		"jobs":       s.queryAllWorkJobs(),
		"ledger":     s.queryAllWorkLedger(),
		"tombstones": s.queryAllTombstones(),
	})
}


