package database

import (
	"database/sql"
	"log"

	_ "modernc.org/sqlite"
)

var DB *sql.DB

func Init() error {
	var err error
	DB, err = sql.Open("sqlite", "./localai.db")
	if err != nil {
		return err
	}

	schema := `
	CREATE TABLE IF NOT EXISTS sessions (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		model_configs TEXT NOT NULL,
		autonomy_rounds INTEGER DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS messages (
		id TEXT PRIMARY KEY,
		session_id TEXT NOT NULL,
		role TEXT NOT NULL,
		model_id TEXT,
		model_name TEXT,
		content TEXT NOT NULL,
		round_number INTEGER DEFAULT 0,
		tokens_used INTEGER DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS provider_keys (
		provider TEXT PRIMARY KEY,
		api_key TEXT NOT NULL,
		enabled INTEGER DEFAULT 1,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	`

	_, err = DB.Exec(schema)
	if err != nil {
		return err
	}

	log.Println("Database initialized")
	return nil
}
