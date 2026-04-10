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

// GET /api/connectors — list all connectors ordered by priority
router.get('/connectors', (req, res) => {
  try {
    const db = getDb();
    const connectors = db.prepare('SELECT * FROM connectors ORDER BY priority ASC, id ASC').all();
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

// PATCH /api/connectors/:id/priority — swap priority with adjacent connector
router.patch('/connectors/:id/priority', (req, res) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const { direction } = req.body; // 'up' | 'down'

    const current = db.prepare('SELECT id, priority FROM connectors WHERE id = ?').get(id);
    if (!current) return res.status(404).json({ success: false, error: 'Connector not found' });

    // Find the adjacent connector to swap with
    let adjacent;
    if (direction === 'up') {
      adjacent = db.prepare(
        'SELECT id, priority FROM connectors WHERE priority < ? ORDER BY priority DESC LIMIT 1'
      ).get(current.priority);
    } else {
      adjacent = db.prepare(
        'SELECT id, priority FROM connectors WHERE priority > ? ORDER BY priority ASC LIMIT 1'
      ).get(current.priority);
    }

    if (!adjacent) return res.json({ success: true, message: 'Already at boundary.' });

    // Swap
    db.prepare('UPDATE connectors SET priority = ? WHERE id = ?').run(adjacent.priority, current.id);
    db.prepare('UPDATE connectors SET priority = ? WHERE id = ?').run(current.priority, adjacent.id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/field-map — field → connectors mapping derived from transforms, ordered by priority
router.get('/field-map', (req, res) => {
  try {
    const db = getDb();
    const connectors = db.prepare(
      "SELECT id, name, target_object, transforms, priority FROM connectors WHERE status = 'active' ORDER BY priority ASC"
    ).all();

    // Build map: { party: { email: [{connectorId, connectorName, priority, sourceField}] } }
    const fieldMap = {};

    for (const connector of connectors) {
      let transforms = [];
      try { transforms = JSON.parse(connector.transforms || '[]'); } catch { continue; }

      const targetObj = connector.target_object || 'unknown';
      if (!fieldMap[targetObj]) fieldMap[targetObj] = {};

      // Find pick op to know selected source fields
      const pickOp = transforms.find(t => t.op === 'pick');
      const selectedFields = pickOp ? pickOp.fields : [];

      // Build a map of sourceField → targetField from rename ops
      const renameMap = {};
      transforms.filter(t => t.op === 'rename').forEach(t => { renameMap[t.from] = t.to; });

      for (const src of selectedFields) {
        const tgt = renameMap[src] || src;
        if (!fieldMap[targetObj][tgt]) fieldMap[targetObj][tgt] = [];
        fieldMap[targetObj][tgt].push({
          connectorId: connector.id,
          connectorName: connector.name,
          priority: connector.priority,
          sourceField: src,
        });
      }
    }

    res.json({ success: true, data: fieldMap });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/connectors/:id
router.delete('/connectors/:id', (req, res) => {
  try {
    const db = getDb();
    const { stopConnector } = require('../connectorEngine');
    const id = req.params.id;

    stopConnector(Number(id));
    db.prepare('DELETE FROM consolidated_data WHERE connector_id = ?').run(id);
    db.prepare('DELETE FROM connectors WHERE id = ?').run(id);

    const tableName = getConnectorDataTableName(id);
    try { db.exec(`DROP TABLE IF EXISTS ${tableName}`); } catch (e) { /* ignore */ }

    res.json({ success: true, message: `Connector ${id} deleted.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/data — consolidated data with pagination
router.get('/data', (req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const offset = parseInt(req.query.offset) || 0;
    const connectorId = req.query.connector_id;

    let query = 'SELECT * FROM consolidated_data';
    let countQuery = 'SELECT COUNT(*) as total FROM consolidated_data';
    const params = [];

    if (connectorId) {
      query += ' WHERE connector_id = ?';
      countQuery += ' WHERE connector_id = ?';
      params.push(connectorId);
    }

    const totalResult = db.prepare(countQuery).get(...params);
    query += ' ORDER BY consolidated_at DESC LIMIT ? OFFSET ?';
    const rows = db.prepare(query).all(...params, limit, offset);

    // Parse data JSON
    const parsed = rows.map(r => ({
      ...r,
      data: (() => { try { return JSON.parse(r.data); } catch { return r.data; } })(),
    }));

    res.json({
      success: true,
      data: parsed,
      pagination: { total: totalResult.total, limit, offset },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/data/:connectorId — data for a specific connector
router.get('/data/:connectorId', (req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const rows = db.prepare(
      'SELECT * FROM consolidated_data WHERE connector_id = ? ORDER BY consolidated_at DESC LIMIT ?'
    ).all(req.params.connectorId, limit);

    const parsed = rows.map(r => ({
      ...r,
      data: (() => { try { return JSON.parse(r.data); } catch { return r.data; } })(),
    }));

    res.json({ success: true, data: parsed });
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
    const dataCount = db.prepare('SELECT COUNT(*) as cnt FROM consolidated_data').get().cnt;

    res.json({
      success: true,
      data: { connectorCount, activeCount, dataCount },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
