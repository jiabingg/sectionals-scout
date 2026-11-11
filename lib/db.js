// SQLite storage (built into Node 22.13+). One file: DATA_DIR/scout.db
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

function open(dir) {
  fs.mkdirSync(dir, { recursive: true });
  let db;
  try { db = new DatabaseSync(path.join(dir, "scout.db")); }
  catch (e) {
    e.message += ` (DATA_DIR=${dir}). The app can't write to that folder. On Railway, add the variable RAILWAY_RUN_UID=0 (volumes are owned by root); elsewhere, make DATA_DIR writable by the app's user.`;
    throw e;
  }
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS teams (key TEXT PRIMARY KEY, name TEXT, year TEXT, league TEXT, json TEXT NOT NULL, updated_at INTEGER, updated_by TEXT);
    CREATE TABLE IF NOT EXISTS pages (url TEXT PRIMARY KEY, body TEXT NOT NULL, fetched_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS notes (player TEXT PRIMARY KEY, text TEXT NOT NULL, updated_by TEXT, updated_at INTEGER);
    CREATE TABLE IF NOT EXISTS plans (team_key TEXT PRIMARY KEY, text TEXT NOT NULL, my_name TEXT, by_email TEXT, at INTEGER);
  `);
  return db;
}

module.exports = { open };
