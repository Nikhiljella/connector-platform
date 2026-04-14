const express = require('express');
const router = express.Router();
const { getDb, getConnectorDataTableName } = require('../db');
const validateAgent = require('../agents/validateAgent');

// POST /api/preview — test a URL and return detected fields + sample data (no DB writes)
router.post('/preview', async (req, res) => {
  const { apiUrl, headers } = req.body;
  if (!apiUrl) return res.status(400).json({ success: false, error: 'apiUrl is required.' });

  try {
    const report = await validateAgent.execute({ apiUrl, headers });
    if (report.status === 'failed') {
      return res.json({ success: false, error: report.message });
    }
    res.json({
      success: true,
      fields: report.fields,
      sampleData: report.sampleData,
      recordCount: report.recordCount,
      message: report.message,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/connectors — list all connectors ordered by creation
router.get('/connectors', (req, res) => {
  try {
    const db = getDb();
    const connectors = db.prepare('SELECT * FROM connectors ORDER BY id ASC').all();
    res.json({ success: true, data: connectors });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/connectors/:id — get single connector with its data count
router.get('/connectors/:id', (req, res) => {
  try {
    const db = getDb();
    const connector = db.prepare('SELECT * FROM connectors WHERE id = ?').get(req.params.id);
    if (!connector) return res.status(404).json({ success: false, error: 'Connector not found' });

    const tableName = getConnectorDataTableName(connector.id);
    let dataCount = 0;
    try {
      const result = db.prepare(`SELECT COUNT(*) as cnt FROM ${tableName}`).get();
      dataCount = result.cnt;
    } catch (e) { /* table may not exist yet */ }

    res.json({ success: true, data: { ...connector, dataCount } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/field-map — field → connectors mapping from final_object_mapping
router.get('/field-map', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT target_object, mapping FROM final_object_mapping').all();

    const fieldMap = {};
    for (const row of rows) {
      let mapping = {};
      try { mapping = JSON.parse(row.mapping); } catch {}
      fieldMap[row.target_object] = mapping;
    }

    res.json({ success: true, data: fieldMap });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/field-priority/:targetObject/:targetField/:connectorId — reorder within final_object_mapping
router.patch('/field-priority/:targetObject/:targetField/:connectorId', (req, res) => {
  try {
    const db = getDb();
    const { targetObject, targetField, connectorId } = req.params;
    const { direction } = req.body; // 'up' | 'down'

    const row = db.prepare('SELECT mapping FROM final_object_mapping WHERE target_object = ?').get(targetObject);
    if (!row) return res.status(404).json({ success: false, error: 'No mapping found for target object.' });

    let mapping = {};
    try { mapping = JSON.parse(row.mapping); } catch {}

    const sources = mapping[targetField];
    if (!sources) return res.status(404).json({ success: false, error: 'Field not found in mapping.' });

    const idx = sources.findIndex(s => s.connectorId === Number(connectorId));
    if (idx === -1) return res.status(404).json({ success: false, error: 'Connector not found for this field.' });

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sources.length) return res.json({ success: true, message: 'Already at boundary.' });

    // Swap in-place
    [sources[idx], sources[swapIdx]] = [sources[swapIdx], sources[idx]];
    mapping[targetField] = sources;

    db.prepare(
      `UPDATE final_object_mapping SET mapping = ?, updated_at = datetime('now') WHERE target_object = ?`
    ).run(JSON.stringify(mapping), targetObject);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/connectors/:id
router.delete('/connectors/:id', (req, res) => {
  try {
    const db = getDb();
    const { stopConnector } = require('../connectorEngine');
    const id = Number(req.params.id);

    // Stop cron job before touching the DB
    stopConnector(id);

    // Remove this connector from final_object_mapping for all target objects
    const mappingRows = db.prepare('SELECT target_object, mapping FROM final_object_mapping').all();
    for (const row of mappingRows) {
      let mapping = {};
      try { mapping = JSON.parse(row.mapping); } catch {}
      let changed = false;
      for (const field of Object.keys(mapping)) {
        const before = mapping[field].length;
        mapping[field] = mapping[field].filter(s => s.connectorId !== id);
        if (mapping[field].length !== before) changed = true;
        if (mapping[field].length === 0) delete mapping[field];
      }
      if (changed) {
        db.prepare(
          `UPDATE final_object_mapping SET mapping = ?, updated_at = datetime('now') WHERE target_object = ?`
        ).run(JSON.stringify(mapping), row.target_object);
      }
    }

    // ON DELETE CASCADE handles party_objects, account_objects, source_mapping
    db.prepare('DELETE FROM connectors WHERE id = ?').run(id);

    // connector_data_N has no FK — drop it manually
    try { db.exec(`DROP TABLE IF EXISTS ${getConnectorDataTableName(id)}`); } catch { /* ignore */ }

    res.json({ success: true, message: `Connector ${id} deleted.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/source-mapping — sync metadata per connector
router.get('/source-mapping', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM source_mapping ORDER BY connector_id ASC').all();
    const parsed = rows.map(r => ({
      ...r,
      selected_fields: (() => { try { return JSON.parse(r.selected_fields); } catch { return []; } })(),
      field_mapping: (() => { try { return JSON.parse(r.field_mapping); } catch { return {}; } })(),
    }));
    res.json({ success: true, data: parsed });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/party-objects — paginated party objects
router.get('/party-objects', (req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const offset = parseInt(req.query.offset) || 0;
    const connectorId = req.query.connector_id;

    let where = connectorId ? 'WHERE source_connector_id = ?' : '';
    const params = connectorId ? [connectorId] : [];

    const total = db.prepare(`SELECT COUNT(*) as cnt FROM party_objects ${where}`).get(...params).cnt;
    const rows = db.prepare(
      `SELECT * FROM party_objects ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    res.json({ success: true, data: rows, pagination: { total, limit, offset } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/account-objects — paginated account objects
router.get('/account-objects', (req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const offset = parseInt(req.query.offset) || 0;
    const connectorId = req.query.connector_id;

    let where = connectorId ? 'WHERE source_connector_id = ?' : '';
    const params = connectorId ? [connectorId] : [];

    const total = db.prepare(`SELECT COUNT(*) as cnt FROM account_objects ${where}`).get(...params).cnt;
    const rows = db.prepare(
      `SELECT * FROM account_objects ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    res.json({ success: true, data: rows, pagination: { total, limit, offset } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/raw-data — reads directly from each connector's connector_data_N table
router.get('/raw-data', (req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const filterConnectorId = req.query.connector_id ? Number(req.query.connector_id) : null;

    const connectors = filterConnectorId
      ? db.prepare('SELECT id, name FROM connectors WHERE id = ?').all(filterConnectorId)
      : db.prepare("SELECT id, name FROM connectors WHERE status = 'active' ORDER BY priority ASC").all();

    const rows = [];
    for (const c of connectors) {
      const tableName = `connector_data_${c.id}`;
      const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
      if (!exists) continue;

      const fetched = db.prepare(
        `SELECT id, data, fetched_at FROM ${tableName} ORDER BY fetched_at DESC LIMIT ?`
      ).all(limit);

      for (const r of fetched) {
        rows.push({
          connector_id: c.id,
          connector_name: c.name,
          fetched_at: r.fetched_at,
          data: (() => { try { return JSON.parse(r.data); } catch { return r.data; } })(),
        });
      }
    }

    // Sort merged results by fetched_at desc and apply limit
    rows.sort((a, b) => (b.fetched_at > a.fetched_at ? 1 : -1));
    const page = rows.slice(0, limit);

    res.json({ success: true, data: page, total: rows.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/stats — dashboard stats
router.get('/stats', (req, res) => {
  try {
    const db = getDb();
    const connectorCount = db.prepare('SELECT COUNT(*) as cnt FROM connectors').get().cnt;
    const activeCount = db.prepare("SELECT COUNT(*) as cnt FROM connectors WHERE status = 'active'").get().cnt;
    const partyCount = db.prepare('SELECT COUNT(*) as cnt FROM party_objects').get().cnt;
    const accountCount = db.prepare('SELECT COUNT(*) as cnt FROM account_objects').get().cnt;
    const dataCount = partyCount + accountCount;

    res.json({
      success: true,
      data: { connectorCount, activeCount, dataCount },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
