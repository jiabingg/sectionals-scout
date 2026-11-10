// SQLite storage (built into Node 22.13+). One file: DATA_DIR/scout.db
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

function open(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "scout.db"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, role TEXT NOT NULL DEFAULT 'member', added_by TEXT, created_at INTEGER, last_login INTEGER);
    CREATE TABLE IF NOT EXISTS login_tokens (hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER);
    CREATE TABLE IF NOT EXISTS teams (key TEXT PRIMARY KEY, name TEXT, year TEXT, league TEXT, json TEXT NOT NULL, updated_at INTEGER, updated_by TEXT);
    CREATE TABLE IF NOT EXISTS pages (url TEXT PRIMARY KEY, body TEXT NOT NULL, fetched_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS notes (player TEXT PRIMARY KEY, text TEXT NOT NULL, updated_by TEXT, updated_at INTEGER);
    CREATE TABLE IF NOT EXISTS plans (team_key TEXT PRIMARY KEY, text TEXT NOT NULL, my_name TEXT, by_email TEXT, at INTEGER);
    CREATE TABLE IF NOT EXISTS prefs (email TEXT PRIMARY KEY, json TEXT NOT NULL);
  `);
  return db;
}

module.exports = { open };
