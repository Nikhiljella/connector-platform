const { getDb, createConnectorDataTable } = require('../db');

function execute({ name, apiUrl, schedule, headers, fieldMapping, fields }) {
  const report = {
    agent: 'ScaffoldAgent',
    status: 'running',
    message: '',
    config: null,
    tableName: null,
  };

  try {
    const db = getDb();

    // Check for duplicate name
    const existing = db.prepare('SELECT id FROM connectors WHERE name = ?').get(name);
    if (existing) {
      report.status = 'failed';
      report.message = `A connector named "${name}" already exists (id=${existing.id}).`;
      return report;
    }

    // Generate config
    const config = {
      name,
      api_url: apiUrl,
      schedule: schedule || '*/5 * * * *',
      headers: typeof headers === 'string' ? headers : JSON.stringify(headers || {}),
      field_mapping: typeof fieldMapping === 'string' ? fieldMapping : JSON.stringify(fieldMapping || {}),
      fields: fields || [],
    };

    report.status = 'success';
    report.message = `Connector config scaffolded. Schedule: ${config.schedule}. Fields: ${config.fields.join(', ') || 'all'}.`;
    report.config = config;
  } catch (err) {
    report.status = 'failed';
    report.message = `Scaffold error: ${err.message}`;
  }

  return report;
}

module.exports = { execute };
