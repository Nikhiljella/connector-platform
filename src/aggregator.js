const cron = require('node-cron');
const { getDb, getConnectorDataTableName } = require('./db');

let aggregatorJob = null;

function startAggregator(schedule = '*/2 * * * *') {
  if (aggregatorJob) aggregatorJob.stop();

  aggregatorJob = cron.schedule(schedule, () => {
    runAggregation();
  });

  console.log(`[Aggregator] Running on schedule: ${schedule}`);
}

function runAggregation() {
  const db = getDb();

  try {
    const connectors = db.prepare("SELECT * FROM connectors WHERE status = 'active'").all();

    if (connectors.length === 0) {
      console.log('[Aggregator] No active connectors to aggregate.');
      return;
    }

    let totalRows = 0;

    const insertStmt = db.prepare(`
      INSERT INTO consolidated_data (connector_id, connector_name, data, fetched_at, consolidated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `);

    const aggregate = db.transaction(() => {
      for (const connector of connectors) {
        const tableName = getConnectorDataTableName(connector.id);

        // Check if table exists
        const tableExists = db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
        ).get(tableName);

        if (!tableExists) continue;

        // Get the last consolidated timestamp for this connector
        const lastConsolidated = db.prepare(
          'SELECT MAX(fetched_at) as last_ts FROM consolidated_data WHERE connector_id = ?'
        ).get(connector.id);

        let rows;
        if (lastConsolidated && lastConsolidated.last_ts) {
          rows = db.prepare(
            `SELECT * FROM ${tableName} WHERE fetched_at > ? ORDER BY fetched_at ASC`
          ).all(lastConsolidated.last_ts);
        } else {
          rows = db.prepare(
            `SELECT * FROM ${tableName} ORDER BY fetched_at ASC`
          ).all();
        }

        for (const row of rows) {
          insertStmt.run(connector.id, connector.name, row.data, row.fetched_at);
          totalRows++;
        }
      }
    });

    aggregate();

    if (totalRows > 0) {
      console.log(`[Aggregator] Consolidated ${totalRows} new record(s) from ${connectors.length} connector(s).`);
    }
  } catch (err) {
    console.error('[Aggregator] Error during aggregation:', err.message);
  }
}

module.exports = { startAggregator, runAggregation };
