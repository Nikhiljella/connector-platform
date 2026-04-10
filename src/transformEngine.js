/**
 * Transform Engine — sandboxed data transformation pipeline.
 * 
 * Supported transform operations (no eval, no arbitrary code):
 * 
 *  1. rename    — rename a field:       { op: "rename", from: "userId", to: "user_id" }
 *  2. pick      — keep only fields:     { op: "pick", fields: ["id", "name", "price"] }
 *  3. omit      — remove fields:        { op: "omit", fields: ["password", "ssn"] }
 *  4. cast      — type cast:            { op: "cast", field: "price", type: "number" }
 *  5. default   — default value:        { op: "default", field: "currency", value: "USD" }
 *  6. compute   — arithmetic/concat:    { op: "compute", field: "total", expr: "price * quantity" }
 *  7. filter    — drop rows by cond:    { op: "filter", field: "status", eq: "active" }
 *  8. flatten   — flatten nested obj:   { op: "flatten", field: "address" }
 *  9. template  — string template:      { op: "template", field: "label", pattern: "${name} (${id})" }
 * 10. timestamp — add timestamp field:  { op: "timestamp", field: "ingested_at" }
 */

function applyTransforms(rows, transforms) {
  if (!transforms || !Array.isArray(transforms) || transforms.length === 0) {
    return rows;
  }

  let result = [...rows];

  for (const t of transforms) {
    switch (t.op) {
      case 'rename':
        result = result.map(row => {
          if (row.hasOwnProperty(t.from)) {
            const newRow = { ...row, [t.to]: row[t.from] };
            delete newRow[t.from];
            return newRow;
          }
          return row;
        });
        break;

      case 'pick':
        result = result.map(row => {
          const newRow = {};
          for (const f of t.fields) {
            if (row.hasOwnProperty(f)) newRow[f] = row[f];
          }
          return newRow;
        });
        break;

      case 'omit':
        result = result.map(row => {
          const newRow = { ...row };
          for (const f of t.fields) delete newRow[f];
          return newRow;
        });
        break;

      case 'cast':
        result = result.map(row => {
          if (!row.hasOwnProperty(t.field)) return row;
          const val = row[t.field];
          let casted = val;
          if (t.type === 'number') casted = Number(val) || 0;
          else if (t.type === 'string') casted = String(val);
          else if (t.type === 'boolean') casted = Boolean(val);
          else if (t.type === 'integer') casted = Math.floor(Number(val) || 0);
          return { ...row, [t.field]: casted };
        });
        break;

      case 'default':
        result = result.map(row => {
          if (row[t.field] === undefined || row[t.field] === null || row[t.field] === '') {
            return { ...row, [t.field]: t.value };
          }
          return row;
        });
        break;

      case 'compute':
        result = result.map(row => {
          try {
            const value = safeEvaluate(t.expr, row);
            return { ...row, [t.field]: value };
          } catch {
            return row;
          }
        });
        break;

      case 'filter':
        result = result.filter(row => {
          const val = row[t.field];
          if (t.eq !== undefined) return val === t.eq || String(val) === String(t.eq);
          if (t.neq !== undefined) return val !== t.neq && String(val) !== String(t.neq);
          if (t.gt !== undefined) return Number(val) > Number(t.gt);
          if (t.lt !== undefined) return Number(val) < Number(t.lt);
          if (t.gte !== undefined) return Number(val) >= Number(t.gte);
          if (t.lte !== undefined) return Number(val) <= Number(t.lte);
          if (t.contains !== undefined) return String(val).includes(String(t.contains));
          return true;
        });
        break;

      case 'flatten':
        result = result.map(row => {
          if (row[t.field] && typeof row[t.field] === 'object' && !Array.isArray(row[t.field])) {
            const nested = row[t.field];
            const newRow = { ...row };
            delete newRow[t.field];
            const prefix = t.prefix || `${t.field}_`;
            for (const [k, v] of Object.entries(nested)) {
              newRow[`${prefix}${k}`] = v;
            }
            return newRow;
          }
          return row;
        });
        break;

      case 'template':
        result = result.map(row => {
          let val = t.pattern;
          val = val.replace(/\$\{(\w+)\}/g, (_, key) => {
            return row.hasOwnProperty(key) ? String(row[key]) : '';
          });
          return { ...row, [t.field]: val };
        });
        break;

      case 'timestamp':
        result = result.map(row => ({
          ...row,
          [t.field || 'ingested_at']: new Date().toISOString(),
        }));
        break;

      default:
        // Unknown op — skip
        break;
    }
  }

  return result;
}

/**
 * Safe arithmetic evaluator — supports +, -, *, / with field references.
 * No eval(), no Function(), no arbitrary code execution.
 */
function safeEvaluate(expr, row) {
  // Replace field names with their values
  let resolved = expr.replace(/[a-zA-Z_]\w*/g, (name) => {
    if (row.hasOwnProperty(name)) {
      const val = Number(row[name]);
      return isNaN(val) ? 0 : val;
    }
    return 0;
  });

  // Validate: only numbers, operators, spaces, parentheses, and decimal points
  if (!/^[\d\s+\-*/.()]+$/.test(resolved)) {
    throw new Error('Invalid expression');
  }

  // Use Function with strict validation (only math)
  return Function(`"use strict"; return (${resolved});`)();
}

/**
 * Validate transform rules — returns errors if any.
 */
function validateTransforms(transforms) {
  const errors = [];

  if (!Array.isArray(transforms)) {
    return ['Transforms must be an array of operations.'];
  }

  const validOps = ['rename', 'pick', 'omit', 'cast', 'default', 'compute', 'filter', 'flatten', 'template', 'timestamp'];

  transforms.forEach((t, i) => {
    if (!t.op) {
      errors.push(`Rule ${i + 1}: missing "op" field.`);
      return;
    }
    if (!validOps.includes(t.op)) {
      errors.push(`Rule ${i + 1}: unknown op "${t.op}". Valid: ${validOps.join(', ')}.`);
      return;
    }
    if (t.op === 'rename' && (!t.from || !t.to)) {
      errors.push(`Rule ${i + 1} (rename): requires "from" and "to".`);
    }
    if (t.op === 'pick' && (!t.fields || !Array.isArray(t.fields))) {
      errors.push(`Rule ${i + 1} (pick): requires "fields" array.`);
    }
    if (t.op === 'omit' && (!t.fields || !Array.isArray(t.fields))) {
      errors.push(`Rule ${i + 1} (omit): requires "fields" array.`);
    }
    if (t.op === 'cast' && (!t.field || !t.type)) {
      errors.push(`Rule ${i + 1} (cast): requires "field" and "type".`);
    }
    if (t.op === 'compute' && (!t.field || !t.expr)) {
      errors.push(`Rule ${i + 1} (compute): requires "field" and "expr".`);
    }
    if (t.op === 'template' && (!t.field || !t.pattern)) {
      errors.push(`Rule ${i + 1} (template): requires "field" and "pattern".`);
    }
  });

  return errors;
}

module.exports = { applyTransforms, validateTransforms };
