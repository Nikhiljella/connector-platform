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

    // Assign priority = max existing priority + 1 so new connectors go to the bottom
    const maxPriority = db.prepare('SELECT MAX(priority) as m FROM connectors').get().m || 0;

    // Insert the connector metadata
    const result = db.prepare(`
      INSERT INTO connectors (name, api_url, schedule, headers, field_mapping, transforms, target_object, priority, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(
      config.name,
      config.api_url,
      config.schedule,
      config.headers,
      config.field_mapping,
      config.transforms || '[]',
      config.target_object || null,
      maxPriority + 1
    );

    const connectorId = result.lastInsertRowid;

    // Create the connector-specific data table
    const tableName = createConnectorDataTable(connectorId);

    // Register the connector in the cron engine
    addConnector(connectorId);

    report.status = 'success';
    report.message = `Connector registered with id=${connectorId}. Data table "${tableName}" created. Cron job started.`;
    report.connectorId = connectorId;
  } catch (err) {
    report.status = 'failed';
    report.message = `Registration error: ${err.message}`;
  }

  return report;
}

module.exports = { execute };
