const { applyTransforms, validateTransforms } = require('../transformEngine');

function execute({ transforms, sampleData }) {
  const report = {
    agent: 'TransformAgent',
    status: 'running',
    message: '',
    transformedSample: null,
    ruleCount: 0,
    errors: [],
  };

  try {
    if (!transforms || (Array.isArray(transforms) && transforms.length === 0)) {
      report.status = 'success';
      report.message = 'No transforms configured — raw data will be stored as-is.';
      report.ruleCount = 0;
      return report;
    }

    // Parse if string
    let rules = transforms;
    if (typeof transforms === 'string') {
      try {
        rules = JSON.parse(transforms);
      } catch (e) {
        report.status = 'failed';
        report.message = `Invalid transform JSON: ${e.message}`;
        return report;
      }
    }

    // Validate rules
    const errors = validateTransforms(rules);
    if (errors.length > 0) {
      report.status = 'failed';
      report.message = `Transform validation failed: ${errors.join(' | ')}`;
      report.errors = errors;
      return report;
    }

    // Dry-run on sample data
    if (sampleData && Array.isArray(sampleData) && sampleData.length > 0) {
      const transformed = applyTransforms(sampleData, rules);
      report.transformedSample = transformed.slice(0, 3);

      const inputFields = Object.keys(sampleData[0] || {});
      const outputFields = transformed.length > 0 ? Object.keys(transformed[0]) : [];

      const added = outputFields.filter(f => !inputFields.includes(f));
      const removed = inputFields.filter(f => !outputFields.includes(f));
      const rowDelta = transformed.length - sampleData.length;

      let summary = `${rules.length} transform(s) validated.`;
      if (added.length > 0) summary += ` Added: ${added.join(', ')}.`;
      if (removed.length > 0) summary += ` Removed: ${removed.join(', ')}.`;
      if (rowDelta !== 0) summary += ` Row delta: ${rowDelta > 0 ? '+' : ''}${rowDelta}.`;
      summary += ` Output: ${outputFields.length} field(s), ${transformed.length} row(s).`;

      report.message = summary;
    } else {
      report.message = `${rules.length} transform(s) validated (no sample data for dry-run).`;
    }

    report.status = 'success';
    report.ruleCount = rules.length;
  } catch (err) {
    report.status = 'failed';
    report.message = `Transform error: ${err.message}`;
  }

  return report;
}

module.exports = { execute };
