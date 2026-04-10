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
    runMigrations();
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS connectors (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL UNIQUE,
      api_url       TEXT NOT NULL,
      schedule      TEXT NOT NULL DEFAULT '*/5 * * * *',
      headers       TEXT DEFAULT '{}',
      field_mapping TEXT DEFAULT '{}',
      transforms    TEXT DEFAULT '[]',
      target_object TEXT,
      priority      INTEGER DEFAULT 0,
      status        TEXT NOT NULL DEFAULT 'pending',
      created_at    TEXT DEFAULT (datetime('now')),
      last_fetched_at TEXT,
      last_error    TEXT
    );

    CREATE TABLE IF NOT EXISTS consolidated_data (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      connector_id     INTEGER NOT NULL,
      connector_name   TEXT NOT NULL,
      data             TEXT NOT NULL,
      fetched_at       TEXT NOT NULL,
      consolidated_at  TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (connector_id) REFERENCES connectors(id)
    );

    -- One row per connector: sync schedule metadata and field mapping summary
    CREATE TABLE IF NOT EXISTS source_mapping (
      connector_id      INTEGER PRIMARY KEY,
      connector_name    TEXT NOT NULL,
      target_object     TEXT,
      sync_schedule     TEXT,
      selected_fields   TEXT DEFAULT '[]',
      field_mapping     TEXT DEFAULT '{}',
      last_synced_at    TEXT,
      records_this_sync INTEGER DEFAULT 0,
      total_records     INTEGER DEFAULT 0,
      FOREIGN KEY (connector_id) REFERENCES connectors(id)
    );

    -- Structured party objects built from mapped connector data
    CREATE TABLE IF NOT EXISTS party_objects (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      partyId             TEXT,
      partyType           TEXT,
      fullName            TEXT,
      firstName           TEXT,
      lastName            TEXT,
      dateOfBirth         TEXT,
      nationalId          TEXT,
      email               TEXT,
      phone               TEXT,
      address             TEXT,
      country             TEXT,
      status              TEXT,
      source_connector_id   INTEGER,
      source_connector_name TEXT,
      fetched_at          TEXT,
      created_at          TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (source_connector_id) REFERENCES connectors(id)
    );

    -- Structured account objects built from mapped connector data
    CREATE TABLE IF NOT EXISTS account_objects (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      accountId           TEXT,
      accountNumber       TEXT,
      accountType         TEXT,
      currency            TEXT,
      balance             TEXT,
      status              TEXT,
      openDate            TEXT,
      ownerId             TEXT,
      branchCode          TEXT,
      productCode         TEXT,
      iban                TEXT,
      source_connector_id   INTEGER,
      source_connector_name TEXT,
      fetched_at          TEXT,
      created_at          TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (source_connector_id) REFERENCES connectors(id)
    );
  `);
}

// Add columns introduced after the initial schema without breaking existing DBs
function runMigrations() {
  const cols = db.prepare('PRAGMA table_info(connectors)').all().map(c => c.name);
  if (!cols.includes('transforms')) {
    db.exec("ALTER TABLE connectors ADD COLUMN transforms TEXT DEFAULT '[]'");
  }
  if (!cols.includes('target_object')) {
    db.exec('ALTER TABLE connectors ADD COLUMN target_object TEXT');
  }
  if (!cols.includes('priority')) {
    db.exec('ALTER TABLE connectors ADD COLUMN priority INTEGER DEFAULT 0');
    db.exec('UPDATE connectors SET priority = id WHERE priority = 0 OR priority IS NULL');
  }
}

function createConnectorDataTable(connectorId) {
  const tableName = `connector_data_${connectorId}`;
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      data       TEXT NOT NULL,
      fetched_at TEXT DEFAULT (datetime('now'))
    );
  `);
  return tableName;
}

function getConnectorDataTableName(connectorId) {
  return `connector_data_${connectorId}`;
}

module.exports = { getDb, createConnectorDataTable, getConnectorDataTableName };
