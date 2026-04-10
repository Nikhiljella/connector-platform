const cron = require('node-cron');
const fetch = require('node-fetch');
const { getDb, getConnectorDataTableName } = require('./db');
const { applyTransforms } = require('./transformEngine');

const activeJobs = new Map();

function startConnector(connector) {
  if (activeJobs.has(connector.id)) {
    activeJobs.get(connector.id).stop();
  }

  const schedule = connector.schedule || '*/5 * * * *';

  if (!cron.validate(schedule)) {
    console.error(`[ConnectorEngine] Invalid cron for connector ${connector.id}: ${schedule}`);
    return;
  }

  const job = cron.schedule(schedule, async () => {
    await fetchData(connector);
  });

  activeJobs.set(connector.id, job);
  console.log(`[ConnectorEngine] Started connector "${connector.name}" (id=${connector.id}) on schedule: ${schedule}`);
}

async function fetchData(connector) {
  const db = getDb();
  const tableName = getConnectorDataTableName(connector.id);

  try {
    let headers = {};
    try {
      headers = JSON.parse(connector.headers || '{}');
    } catch (e) { /* ignore parse errors */ }

    const response = await fetch(connector.api_url, {
      headers,
      timeout: 30000,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const rows = Array.isArray(data) ? data : [data];

    const insert = db.prepare(`INSERT INTO ${tableName} (data, fetched_at) VALUES (?, datetime('now'))`);
    const insertMany = db.transaction((items) => {
      for (const item of items) {
        insert.run(JSON.stringify(item));
      }
    });

    insertMany(rows);

    db.prepare('UPDATE connectors SET last_fetched_at = datetime(\'now\'), last_error = NULL WHERE id = ?')
      .run(connector.id);

    console.log(`[ConnectorEngine] Fetched ${rows.length} records for "${connector.name}"`);
  } catch (err) {
    console.error(`[ConnectorEngine] Error fetching "${connector.name}":`, err.message);
    db.prepare('UPDATE connectors SET last_error = ? WHERE id = ?')
      .run(err.message, connector.id);
  }
}

function startAllConnectors() {
  const db = getDb();
  const connectors = db.prepare("SELECT * FROM connectors WHERE status = 'active'").all();
  console.log(`[ConnectorEngine] Starting ${connectors.length} active connector(s)...`);
  for (const c of connectors) {
    startConnector(c);
  }
}

function stopConnector(connectorId) {
  if (activeJobs.has(connectorId)) {
    activeJobs.get(connectorId).stop();
    activeJobs.delete(connectorId);
    console.log(`[ConnectorEngine] Stopped connector id=${connectorId}`);
  }
}

function addConnector(connectorId) {
  const db = getDb();
  const connector = db.prepare('SELECT * FROM connectors WHERE id = ?').get(connectorId);
  if (connector && connector.status === 'active') {
    startConnector(connector);
  }
}

// Trigger one immediate fetch (used by test agent)
async function triggerFetch(connectorId) {
  const db = getDb();
  const connector = db.prepare('SELECT * FROM connectors WHERE id = ?').get(connectorId);
  if (!connector) throw new Error(`Connector ${connectorId} not found`);
  await fetchData(connector);
}

module.exports = { startAllConnectors, startConnector, stopConnector, addConnector, triggerFetch };
