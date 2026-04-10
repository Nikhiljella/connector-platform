const cron = require('node-cron');
const { getDb, getConnectorDataTableName } = require('./db');
const { applyTransforms } = require('./transformEngine');

// Party and account field lists (must match DB columns)
const PARTY_FIELDS = ['partyId','partyType','fullName','firstName','lastName','dateOfBirth','nationalId','email','phone','address','country','status'];
const ACCOUNT_FIELDS = ['accountId','accountNumber','accountType','currency','balance','status','openDate','ownerId','branchCode','productCode','iban'];

let aggregatorJob = null;

function startAggregator(schedule = '*/2 * * * *') {
  if (aggregatorJob) aggregatorJob.stop();
  aggregatorJob = cron.schedule(schedule, () => { runAggregation(); });
  console.log(`[Aggregator] Running on schedule: ${schedule}`);
}

function runAggregation() {
  const db = getDb();

  try {
    const connectors = db.prepare("SELECT * FROM connectors WHERE status = 'active' ORDER BY priority ASC").all();

    if (connectors.length === 0) {
      console.log('[Aggregator] No active connectors to aggregate.');
      return;
    }

    let totalRows = 0;

    const insertConsolidated = db.prepare(
      `INSERT INTO consolidated_data (connector_id, connector_name, data, fetched_at, consolidated_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    );

    const insertParty = db.prepare(
      `INSERT INTO party_objects
         (partyId, partyType, fullName, firstName, lastName, dateOfBirth, nationalId,
          email, phone, address, country, status,
          source_connector_id, source_connector_name, fetched_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );

    const insertAccount = db.prepare(
      `INSERT INTO account_objects
         (accountId, accountNumber, accountType, currency, balance, status, openDate,
          ownerId, branchCode, productCode, iban,
          source_connector_id, source_connector_name, fetched_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );

    const upsertSourceMapping = db.prepare(
      `INSERT INTO source_mapping
         (connector_id, connector_name, target_object, sync_schedule, selected_fields, field_mapping,
          last_synced_at, records_this_sync, total_records)
       VALUES (?,?,?,?,?,?,datetime('now'),?,?)
       ON CONFLICT(connector_id) DO UPDATE SET
         connector_name    = excluded.connector_name,
         target_object     = excluded.target_object,
         sync_schedule     = excluded.sync_schedule,
         selected_fields   = excluded.selected_fields,
         field_mapping     = excluded.field_mapping,
         last_synced_at    = excluded.last_synced_at,
         records_this_sync = excluded.records_this_sync,
         total_records     = excluded.total_records`
    );

    const aggregate = db.transaction(() => {
      for (const connector of connectors) {
        const tableName = getConnectorDataTableName(connector.id);

        const tableExists = db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
        ).get(tableName);
        if (!tableExists) continue;

        // Only pick up rows newer than what was last consolidated for this connector
        const lastTs = db.prepare(
          'SELECT MAX(fetched_at) as last_ts FROM consolidated_data WHERE connector_id = ?'
        ).get(connector.id);

        const rows = lastTs?.last_ts
          ? db.prepare(`SELECT * FROM ${tableName} WHERE fetched_at > ? ORDER BY fetched_at ASC`).all(lastTs.last_ts)
          : db.prepare(`SELECT * FROM ${tableName} ORDER BY fetched_at ASC`).all();

        // Parse + apply transforms
        let transforms = [];
        try { transforms = JSON.parse(connector.transforms || '[]'); } catch {}

        const rawObjects = rows.map(r => { try { return JSON.parse(r.data); } catch { return r.data; } });
        const transformed = transforms.length > 0 ? applyTransforms(rawObjects, transforms) : rawObjects;

        const targetObj = connector.target_object; // 'party' | 'account' | null

        for (let i = 0; i < rows.length; i++) {
          const data = transformed[i] !== undefined ? transformed[i] : rawObjects[i];
          const fetchedAt = rows[i].fetched_at;

          // Always write to consolidated_data (raw store)
          insertConsolidated.run(connector.id, connector.name, JSON.stringify(data), fetchedAt);

          // Write to structured object table when target_object is set
          if (targetObj === 'party') {
            insertParty.run(
              ...PARTY_FIELDS.map(f => (data[f] !== undefined ? String(data[f]) : null)),
              connector.id, connector.name, fetchedAt
            );
          } else if (targetObj === 'account') {
            insertAccount.run(
              ...ACCOUNT_FIELDS.map(f => (data[f] !== undefined ? String(data[f]) : null)),
              connector.id, connector.name, fetchedAt
            );
          }

          totalRows++;
        }

        // Derive field mapping summary from transforms for source_mapping
        const pickOp = transforms.find(t => t.op === 'pick');
        const selectedFields = JSON.stringify(pickOp ? pickOp.fields : []);
        const fieldMapping = JSON.stringify(
          Object.fromEntries(transforms.filter(t => t.op === 'rename').map(t => [t.from, t.to]))
        );
        const totalRecords = db.prepare(`SELECT COUNT(*) as cnt FROM ${tableName}`).get().cnt;

        upsertSourceMapping.run(
          connector.id, connector.name, targetObj, connector.schedule,
          selectedFields, fieldMapping, rows.length, totalRecords
        );
      }
    });

    aggregate();

    if (totalRows > 0) {
      console.log(`[Aggregator] Processed ${totalRows} new record(s) from ${connectors.length} connector(s).`);
    }
  } catch (err) {
    console.error('[Aggregator] Error during aggregation:', err.message);
  }
}

module.exports = { startAggregator, runAggregation };
