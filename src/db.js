const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'platform.db');

// ─────────────────────────────────────────────
//  Connection (singleton)
// ─────────────────────────────────────────────

let db = null;

function getDb() {
  if (db) return db;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');   // concurrent reads + safe writes
  db.pragma('foreign_keys = ON');    // enforce ON DELETE CASCADE

  createSchema();
  return db;
}

// ─────────────────────────────────────────────
//  Schema
// ─────────────────────────────────────────────

function createSchema() {
  db.exec(`

    -- ── Connectors ────────────────────────────────────────────────────────────
    -- One row per registered API source.
    -- transforms: JSON array of transform ops (pick, rename, …) built during onboarding.
    -- target_object: 'party' | 'account' — determines which object table receives data.
    -- priority: lower number = higher precedence when multiple connectors map the same field.

    CREATE TABLE IF NOT EXISTS connectors (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT    NOT NULL UNIQUE,
      api_url         TEXT    NOT NULL,
      schedule        TEXT    NOT NULL DEFAULT '*/5 * * * *',
      headers         TEXT             DEFAULT '{}',
      field_mapping   TEXT             DEFAULT '{}',
      transforms      TEXT             DEFAULT '[]',
      target_object   TEXT,
      status          TEXT    NOT NULL DEFAULT 'pending',
      created_at      TEXT             DEFAULT (datetime('now')),
      last_fetched_at TEXT,
      last_error      TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_connectors_status
      ON connectors (status);


    -- ── Raw connector data ────────────────────────────────────────────────────
    -- Each connector gets its own table: connector_data_<id>.
    -- Created dynamically by createConnectorDataTable() when a connector registers.
    -- Rows are never deleted automatically — they accumulate until the connector is removed.


    -- ── Source mapping ────────────────────────────────────────────────────────
    -- One row per connector. Written by the aggregator after every sync cycle.
    -- Tracks schedule, field selection, field mapping, and sync statistics.

    CREATE TABLE IF NOT EXISTS source_mapping (
      connector_id      INTEGER PRIMARY KEY,
      connector_name    TEXT    NOT NULL,
      target_object     TEXT,
      sync_schedule     TEXT,
      selected_fields   TEXT    DEFAULT '[]',   -- JSON array
      field_mapping     TEXT    DEFAULT '{}',   -- JSON object { sourceField: targetField }
      last_synced_at    TEXT,
      records_this_sync INTEGER DEFAULT 0,
      total_records     INTEGER DEFAULT 0,
      FOREIGN KEY (connector_id) REFERENCES connectors (id) ON DELETE CASCADE
    );


    -- ── Party objects ─────────────────────────────────────────────────────────
    -- Structured rows built by the aggregator for connectors with target_object = 'party'.
    -- Each row represents one record from the source connector after transforms are applied.

    CREATE TABLE IF NOT EXISTS party_objects (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      partyId               TEXT    UNIQUE,
      partyType             TEXT,
      fullName              TEXT,
      firstName             TEXT,
      lastName              TEXT,
      dateOfBirth           TEXT,
      nationalId            TEXT,
      email                 TEXT,
      phone                 TEXT,
      address               TEXT,
      country               TEXT,
      status                TEXT,
      source_connector_id   INTEGER,
      source_connector_name TEXT,
      fetched_at            TEXT,
      created_at            TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (source_connector_id) REFERENCES connectors (id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_party_connector
      ON party_objects (source_connector_id, fetched_at);


    -- ── Account objects ───────────────────────────────────────────────────────
    -- Structured rows built by the aggregator for connectors with target_object = 'account'.

    CREATE TABLE IF NOT EXISTS account_objects (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      accountId             TEXT    UNIQUE,
      accountNumber         TEXT,
      accountType           TEXT,
      currency              TEXT,
      balance               TEXT,
      status                TEXT,
      openDate              TEXT,
      ownerId               TEXT,
      branchCode            TEXT,
      productCode           TEXT,
      iban                  TEXT,
      source_connector_id   INTEGER,
      source_connector_name TEXT,
      fetched_at            TEXT,
      created_at            TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (source_connector_id) REFERENCES connectors (id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_account_connector
      ON account_objects (source_connector_id, fetched_at);


    -- ── Final object mapping ──────────────────────────────────────────────────
    -- One row per target_object ('party' | 'account').
    -- mapping: JSON object where each key is a target field name and the value
    -- is a priority-ordered array of source descriptors:
    --   { "email": [{"connectorId":1,"connectorName":"Users","sourceField":"email"}, …], … }
    -- Index 0 = primary source; subsequent entries are ordered fallbacks.

    CREATE TABLE IF NOT EXISTS final_object_mapping (
      target_object TEXT    PRIMARY KEY,
      mapping       TEXT    NOT NULL DEFAULT '{}',
      updated_at    TEXT    DEFAULT (datetime('now'))
    );

  `);
}

// ─────────────────────────────────────────────
//  Per-connector raw data table
// ─────────────────────────────────────────────

function createConnectorDataTable(connectorId) {
  const tableName = getConnectorDataTableName(connectorId);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      data       TEXT NOT NULL,
      fetched_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_${tableName}_fetched
      ON ${tableName} (fetched_at);
  `);
  return tableName;
}

function getConnectorDataTableName(connectorId) {
  return `connector_data_${connectorId}`;
}

module.exports = { getDb, createConnectorDataTable, getConnectorDataTableName };
