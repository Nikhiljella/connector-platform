const { getDb, getConnectorDataTableName } = require('../db');
const { triggerFetch } = require('../connectorEngine');

async function execute({ connectorId }) {
  const report = {
    agent: 'TestAgent',
    status: 'running',
    message: '',
    rowCount: 0,
    sampleData: null,
  };

  try {
    const db = getDb();
    const tableName = getConnectorDataTableName(connectorId);

    // Trigger an immediate fetch
    await triggerFetch(connectorId);

    // Verify data was stored
    const countResult = db.prepare(`SELECT COUNT(*) as cnt FROM ${tableName}`).get();
    const rows = db.prepare(`SELECT * FROM ${tableName} ORDER BY id DESC LIMIT 3`).all();

    if (countResult.cnt === 0) {
      report.status = 'failed';
      report.message = 'Test fetch completed but no data was stored.';
      return report;
    }

    report.status = 'success';
    report.message = `Test fetch successful. ${countResult.cnt} record(s) stored in "${tableName}".`;
    report.rowCount = countResult.cnt;
    report.sampleData = rows.map(r => {
      try { return JSON.parse(r.data); } catch { return r.data; }
    });
  } catch (err) {
    report.status = 'failed';
    report.message = `Test error: ${err.message}`;
  }

  return report;
}

module.exports = { execute };
