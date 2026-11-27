package app

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS water_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, cid TEXT UNIQUE, ts INTEGER NOT NULL, date TEXT NOT NULL, ml INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_water_date ON water_log(date);
CREATE TABLE IF NOT EXISTS weight_log (date TEXT PRIMARY KEY, kg REAL NOT NULL, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS med_log (
  date TEXT PRIMARY KEY,
  taken INTEGER NOT NULL,
  doses_json TEXT NOT NULL DEFAULT '',
  ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS meal_plan (
  date TEXT NOT NULL, slot TEXT NOT NULL, items_json TEXT NOT NULL DEFAULT '[]', kcal INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', actual_note TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL,
  PRIMARY KEY (date, slot));
CREATE TABLE IF NOT EXISTS push_sub (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notif_log (key TEXT PRIMARY KEY, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS work_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  customer TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'ZL',
  service TEXT NOT NULL,
  price INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'TT',
  note TEXT NOT NULL DEFAULT '',
  ts INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_work_jobs_date ON work_jobs(date);
CREATE INDEX IF NOT EXISTS idx_work_jobs_status ON work_jobs(status);
CREATE TABLE IF NOT EXISTS work_job_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL DEFAULT '',
  job_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  ts INTEGER NOT NULL,
  FOREIGN KEY(job_id) REFERENCES work_jobs(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_work_job_pay_job ON work_job_payments(job_id);
CREATE INDEX IF NOT EXISTS idx_work_job_pay_date ON work_job_payments(date);
CREATE TABLE IF NOT EXISTS work_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  category TEXT NOT NULL,
  amount INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  ts INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_work_ledger_date ON work_ledger(date);
CREATE TABLE IF NOT EXISTS work_ledger_repayments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL DEFAULT '',
  ledger_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  ts INTEGER NOT NULL,
  FOREIGN KEY(ledger_id) REFERENCES work_ledger(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_work_ledger_repay_ledger ON work_ledger_repayments(ledger_id);
CREATE INDEX IF NOT EXISTS idx_work_ledger_repay_date ON work_ledger_repayments(date);
CREATE TABLE IF NOT EXISTS work_tombstones (
  uid TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  sig TEXT NOT NULL DEFAULT '',
  deleted_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_work_tombstones_sig ON work_tombstones(kind, sig);
`

// ensureTableColumn bổ sung cột mới an toàn cho CSDL đã tồn tại trước đó.
func ensureTableColumn(db *sql.DB, table, column, columnDef string) error {
	rows, err := db.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return err
	}
	found := false
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dflt sql.NullString
		if rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk) == nil && name == column {
			found = true
			break
		}
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if found {
		return nil
	}
	_, err = db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column, columnDef))
	return err
}

func migrateSchema(db *sql.DB) error {
	migrations := [][3]string{
		{"med_log", "doses_json", "TEXT NOT NULL DEFAULT ''"},
		{"work_jobs", "uid", "TEXT NOT NULL DEFAULT ''"},
		{"work_jobs", "updated_at", "INTEGER NOT NULL DEFAULT 0"},
		{"work_job_payments", "uid", "TEXT NOT NULL DEFAULT ''"},
		{"work_ledger", "uid", "TEXT NOT NULL DEFAULT ''"},
		{"work_ledger", "updated_at", "INTEGER NOT NULL DEFAULT 0"},
		{"work_ledger_repayments", "uid", "TEXT NOT NULL DEFAULT ''"},
	}
	for _, m := range migrations {
		if err := ensureTableColumn(db, m[0], m[1], m[2]); err != nil {
			return err
		}
	}
	indexes := []string{
		`CREATE INDEX IF NOT EXISTS idx_work_jobs_uid ON work_jobs(uid)`,
		`CREATE INDEX IF NOT EXISTS idx_work_job_pay_uid ON work_job_payments(uid)`,
		`CREATE INDEX IF NOT EXISTS idx_work_ledger_uid ON work_ledger(uid)`,
		`CREATE INDEX IF NOT EXISTS idx_work_ledger_repay_uid ON work_ledger_repayments(uid)`,
	}
	for _, idxSQL := range indexes {
		if _, err := db.Exec(idxSQL); err != nil {
			return err
		}
	}
	_, _ = db.Exec(`DROP TABLE IF EXISTS glucose_log`)
	_, _ = db.Exec(`DELETE FROM settings WHERE key IN ('start_weight','activity','deficit','snack','remind_on')`)
	return nil
}

// OpenDB mở (hoặc tạo) cơ sở dữ liệu SQLite trong dir.
func OpenDB(dir string) (*sql.DB, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	path := filepath.ToSlash(filepath.Join(dir, "health.db"))
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)&_pragma=foreign_keys(1)&_pragma=journal_size_limit(1048576)&_pragma=temp_store(MEMORY)&_pragma=cache_size(-8000)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // 1 người dùng: tuần tự hoá ghi, ít RAM nhất
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
	if err := migrateSchema(db); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

