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
CREATE TABLE IF NOT EXISTS med_log (date TEXT PRIMARY KEY, taken INTEGER NOT NULL, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS meal_plan (
  date TEXT NOT NULL, slot TEXT NOT NULL, items_json TEXT NOT NULL, kcal INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', actual_note TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL,
  PRIMARY KEY (date, slot));
CREATE TABLE IF NOT EXISTS glucose_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, date TEXT NOT NULL, mmol REAL NOT NULL, ctx TEXT NOT NULL DEFAULT 'fasting');
CREATE INDEX IF NOT EXISTS idx_glucose_date ON glucose_log(date);
CREATE TABLE IF NOT EXISTS push_sub (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notif_log (key TEXT PRIMARY KEY, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS work_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  customer TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'ZL',
  service TEXT NOT NULL,
  price INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'TT',
  note TEXT NOT NULL DEFAULT '',
  ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_work_jobs_date ON work_jobs(date);
CREATE INDEX IF NOT EXISTS idx_work_jobs_status ON work_jobs(status);
CREATE TABLE IF NOT EXISTS work_job_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  date TEXT NOT NULL,
  category TEXT NOT NULL,
  amount INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_work_ledger_date ON work_ledger(date);
CREATE TABLE IF NOT EXISTS work_ledger_repayments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  ts INTEGER NOT NULL,
  FOREIGN KEY(ledger_id) REFERENCES work_ledger(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_work_ledger_repay_ledger ON work_ledger_repayments(ledger_id);
CREATE INDEX IF NOT EXISTS idx_work_ledger_repay_date ON work_ledger_repayments(date);
`

// OpenDB mở (hoặc tạo) cơ sở dữ liệu SQLite trong dir.
func OpenDB(dir string) (*sql.DB, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	path := filepath.ToSlash(filepath.Join(dir, "health.db"))
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)&_pragma=foreign_keys(1)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // 1 người dùng: tuần tự hoá ghi, ít RAM nhất
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

