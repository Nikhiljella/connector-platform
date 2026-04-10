const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'platform.db');

let db;

function getDb() {
  if (!db) {
    const fs = require('fs');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initTables();
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS connectors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      api_url TEXT NOT NULL,
      schedule TEXT NOT NULL DEFAULT '*/5 * * * *',
      headers TEXT DEFAULT '{}',
      field_mapping TEXT DEFAULT '{}',
      transforms TEXT DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      last_fetched_at TEXT,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS consolidated_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connector_id INTEGER NOT NULL,
      connector_name TEXT NOT NULL,
      data TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      consolidated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (connector_id) REFERENCES connectors(id)
    );
  `);

  // Migrate: add transforms column if it doesn't exist (for databases created before this column was added)
  const cols = db.prepare("PRAGMA table_info(connectors)").all().map(c => c.name);
  if (!cols.includes('transforms')) {
    db.exec("ALTER TABLE connectors ADD COLUMN transforms TEXT DEFAULT '[]'");
  }
}

function createConnectorDataTable(connectorId) {
  const tableName = `connector_data_${connectorId}`;
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data TEXT NOT NULL,
      fetched_at TEXT DEFAULT (datetime('now'))
    );
  `);
  return tableName;
}

function getConnectorDataTableName(connectorId) {
  return `connector_data_${connectorId}`;
}

module.exports = { getDb, createConnectorDataTable, getConnectorDataTableName };
