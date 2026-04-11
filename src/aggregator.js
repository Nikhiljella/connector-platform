const cron = require('node-cron');
const { getDb, getConnectorDataTableName } = require('./db');
const { applyTransforms } = require('./transformEngine');

const PARTY_FIELDS   = ['partyId','partyType','fullName','firstName','lastName','dateOfBirth','nationalId','email','phone','address','country','status'];
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
    if (connectors.length === 0) return;

    const insertParty = db.prepare(
      `INSERT INTO party_objects
         (partyId,partyType,fullName,firstName,lastName,dateOfBirth,nationalId,
          email,phone,address,country,status,
          source_connector_id,source_connector_name,fetched_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );

    const insertAccount = db.prepare(
      `INSERT INTO account_objects
         (accountId,accountNumber,accountType,currency,balance,status,openDate,
          ownerId,branchCode,productCode,iban,
          source_connector_id,source_connector_name,fetched_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );

    const upsertSourceMapping = db.prepare(
      `INSERT INTO source_mapping
         (connector_id,connector_name,target_object,sync_schedule,selected_fields,field_mapping,
          last_synced_at,records_this_sync,total_records)
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

    let totalNew = 0;

    const aggregate = db.transaction(() => {
      for (const connector of connectors) {
        const tableName = getConnectorDataTableName(connector.id);

        const tableExists = db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
        ).get(tableName);
        if (!tableExists) continue;

        // Use source_mapping.last_synced_at as the watermark for new rows
        const mapping = db.prepare('SELECT last_synced_at FROM source_mapping WHERE connector_id = ?').get(connector.id);
        const lastSyncedAt = mapping?.last_synced_at;

        const rows = lastSyncedAt
          ? db.prepare(`SELECT * FROM ${tableName} WHERE fetched_at > ? ORDER BY fetched_at ASC`).all(lastSyncedAt)
          : db.prepare(`SELECT * FROM ${tableName} ORDER BY fetched_at ASC`).all();

        if (rows.length === 0) {
          // Still upsert source_mapping so metadata stays fresh
          const total = db.prepare(`SELECT COUNT(*) as cnt FROM ${tableName}`).get().cnt;
          let transforms = [];
          try { transforms = JSON.parse(connector.transforms || '[]'); } catch {}
          const pickOp = transforms.find(t => t.op === 'pick');
          upsertSourceMapping.run(
            connector.id, connector.name, connector.target_object, connector.schedule,
            JSON.stringify(pickOp ? pickOp.fields : []),
            JSON.stringify(Object.fromEntries(transforms.filter(t => t.op === 'rename').map(t => [t.from, t.to]))),
            0, total
          );
          continue;
        }

        // Parse transforms
        let transforms = [];
        try { transforms = JSON.parse(connector.transforms || '[]'); } catch {}

        const rawObjects = rows.map(r => { try { return JSON.parse(r.data); } catch { return r.data; } });
        const transformed = transforms.length > 0 ? applyTransforms(rawObjects, transforms) : rawObjects;

        const targetObj = connector.target_object;

        for (let i = 0; i < rows.length; i++) {
          const data = transformed[i] !== undefined ? transformed[i] : rawObjects[i];
          const fetchedAt = rows[i].fetched_at;

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
          // Raw-only connectors (no target_object): data stays in connector_data_N, nothing else needed
        }

        totalNew += rows.length;

        // Update source_mapping
        const pickOp = transforms.find(t => t.op === 'pick');
        const totalRecords = db.prepare(`SELECT COUNT(*) as cnt FROM ${tableName}`).get().cnt;
        upsertSourceMapping.run(
          connector.id, connector.name, targetObj, connector.schedule,
          JSON.stringify(pickOp ? pickOp.fields : []),
          JSON.stringify(Object.fromEntries(transforms.filter(t => t.op === 'rename').map(t => [t.from, t.to]))),
          rows.length, totalRecords
        );
      }
    });

    aggregate();

    if (totalNew > 0) {
      console.log(`[Aggregator] Processed ${totalNew} new record(s) from ${connectors.length} connector(s).`);
    }
  } catch (err) {
    console.error('[Aggregator] Error:', err.message);
  }
}

module.exports = { startAggregator, runAggregation };
