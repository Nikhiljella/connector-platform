const { getDb, createConnectorDataTable } = require('../db');
const { addConnector } = require('../connectorEngine');

function execute({ config }) {
  const report = {
    agent: 'RegisterAgent',
    status: 'running',
    message: '',
    connectorId: null,
  };

  try {
    const db = getDb();

    // Insert connector
    const result = db.prepare(`
      INSERT INTO connectors (name, api_url, schedule, headers, field_mapping, transforms, target_object, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(
      config.name,
      config.api_url,
      config.schedule,
      config.headers,
      config.field_mapping,
      config.transforms || '[]',
      config.target_object || null
    );

    const connectorId = result.lastInsertRowid;

    // Update final_object_mapping: append this connector as the lowest-priority
    // source for each target field it provides. Existing sources stay in place.
    if (config.target_object) {
      let transforms = [];
      try { transforms = JSON.parse(config.transforms || '[]'); } catch {}

      const pickOp    = transforms.find(t => t.op === 'pick');
      const renameMap = Object.fromEntries(
        transforms.filter(t => t.op === 'rename').map(t => [t.from, t.to])
      );
      const selectedFields = pickOp ? pickOp.fields : [];

      const existing = db.prepare(
        'SELECT mapping FROM final_object_mapping WHERE target_object = ?'
      ).get(config.target_object);

      let mapping = {};
      try { mapping = JSON.parse(existing?.mapping || '{}'); } catch {}

      for (const src of selectedFields) {
        const tgt = renameMap[src] || src;
        if (!mapping[tgt]) mapping[tgt] = [];
        // Only add if this connector isn't already listed for this field
        if (!mapping[tgt].find(s => s.connectorId === connectorId)) {
          mapping[tgt].push({ connectorId, connectorName: config.name, sourceField: src });
        }
      }

      db.prepare(
        `INSERT INTO final_object_mapping (target_object, mapping, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(target_object) DO UPDATE SET
           mapping    = excluded.mapping,
           updated_at = excluded.updated_at`
      ).run(config.target_object, JSON.stringify(mapping));
    }

    // Create the connector-specific raw data table
    const tableName = createConnectorDataTable(connectorId);

    // Start cron job
    addConnector(connectorId);

    report.status = 'success';
    report.message = `Connector registered with id=${connectorId}. Table "${tableName}" created. Cron job started.`;
    report.connectorId = connectorId;
  } catch (err) {
    report.status = 'failed';
    report.message = `Registration error: ${err.message}`;
  }

  return report;
}

module.exports = { execute };
