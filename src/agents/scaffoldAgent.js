const { getDb, createConnectorDataTable } = require('../db');

function execute({ name, apiUrl, schedule, headers, fieldSelection, targetObject, targetMapping, fields }) {
  const report = {
    agent: 'ScaffoldAgent',
    status: 'running',
    message: '',
    config: null,
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

    // Build transforms pipeline from the two mapping stages
    const transforms = [];

    // Stage 1: pick only the fields the user selected
    if (Array.isArray(fieldSelection) && fieldSelection.length > 0) {
      transforms.push({ op: 'pick', fields: fieldSelection });
    }

    // Stage 2: rename source fields to target bank object fields
    if (targetMapping && typeof targetMapping === 'object') {
      for (const [from, to] of Object.entries(targetMapping)) {
        if (from && to && from !== to) {
          transforms.push({ op: 'rename', from, to });
        }
      }
    }

    const config = {
      name,
      api_url: apiUrl,
      schedule: schedule || '*/5 * * * *',
      headers: typeof headers === 'string' ? headers : JSON.stringify(headers || {}),
      field_mapping: JSON.stringify(targetMapping || {}),
      transforms: JSON.stringify(transforms),
      target_object: targetObject || null,
      fields: fields || [],
    };

    const selectedCount = fieldSelection?.length || 0;
    const mappingCount = transforms.filter(t => t.op === 'rename').length;
    report.status = 'success';
    report.message = `Config scaffolded. Schedule: ${config.schedule}. ${selectedCount} field(s) selected, ${mappingCount} field(s) mapped to ${targetObject || 'raw'} object.`;
    report.config = config;
  } catch (err) {
    report.status = 'failed';
    report.message = `Scaffold error: ${err.message}`;
  }

  return report;
}

module.exports = { execute };
