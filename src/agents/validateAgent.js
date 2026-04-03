const fetch = require('node-fetch');

async function execute({ apiUrl, headers }) {
  const report = {
    agent: 'ValidateAgent',
    status: 'running',
    message: '',
    sampleData: null,
    fields: [],
  };

  try {
    let parsedHeaders = {};
    try {
      parsedHeaders = typeof headers === 'string' ? JSON.parse(headers) : (headers || {});
    } catch (e) {
      parsedHeaders = {};
    }

    // Test the API endpoint
    const response = await fetch(apiUrl, {
      headers: parsedHeaders,
      timeout: 15000,
    });

    if (!response.ok) {
      report.status = 'failed';
      report.message = `API returned HTTP ${response.status}: ${response.statusText}`;
      return report;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('json')) {
      report.status = 'failed';
      report.message = `API response is not JSON. Content-Type: ${contentType}`;
      return report;
    }

    const data = await response.json();
    const sample = Array.isArray(data) ? data.slice(0, 3) : [data];

    // Extract top-level field names from the first item
    const firstItem = Array.isArray(data) ? data[0] : data;
    const fields = firstItem ? Object.keys(firstItem) : [];

    report.status = 'success';
    report.message = `API is reachable. Returned ${Array.isArray(data) ? data.length : 1} record(s). Detected ${fields.length} field(s).`;
    report.sampleData = sample;
    report.fields = fields;
    report.recordCount = Array.isArray(data) ? data.length : 1;
  } catch (err) {
    report.status = 'failed';
    report.message = `Failed to reach API: ${err.message}`;
  }

  return report;
}

module.exports = { execute };
