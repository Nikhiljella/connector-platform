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

// Build a priority lookup from final_object_mapping:
// returns { fieldName: [connectorId, connectorId, ...] } ordered primary→fallback
function loadFieldPriority(db, targetObject) {
  const row = db.prepare('SELECT mapping FROM final_object_mapping WHERE target_object = ?').get(targetObject);
  if (!row) return {};
  let mapping = {};
  try { mapping = JSON.parse(row.mapping); } catch {}
  // Convert to { fieldName: [connectorId, ...] }
  const priority = {};
  for (const [field, sources] of Object.entries(mapping)) {
    priority[field] = sources.map(s => s.connectorId);
  }
  return priority;
}

// Merge incoming data into an existing object using field-level priority.
// Primary source (index 0) always overwrites; fallback sources only fill nulls.
function mergeByPriority(existing, incoming, connectorId, fields, priority) {
  const merged = { ...existing };
  for (const f of fields) {
    const newVal = incoming[f] !== undefined ? String(incoming[f]) : null;
    const existingVal = existing[f] ?? null;
    const sources = priority[f] || [];
    const rank = sources.indexOf(connectorId);

    if (rank === 0) {
      // Primary source: use new value if available, else keep existing
      merged[f] = newVal !== null ? newVal : existingVal;
    } else if (rank > 0) {
      // Fallback: only fill if existing is null
      merged[f] = existingVal !== null ? existingVal : newVal;
    } else {
      // Not in priority list: only fill nulls
      merged[f] = existingVal !== null ? existingVal : newVal;
    }
  }
  return merged;
}

function runAggregation() {
  const db = getDb();

  try {
    const connectors = db.prepare("SELECT * FROM connectors WHERE status = 'active' ORDER BY id ASC").all();
    if (connectors.length === 0) return;

    // Load field priority maps once per run
    const partyPriority   = loadFieldPriority(db, 'party');
    const accountPriority = loadFieldPriority(db, 'account');

    const upsertParty = db.prepare(
      `INSERT INTO party_objects
         (partyId,partyType,fullName,firstName,lastName,dateOfBirth,nationalId,
          email,phone,address,country,status,
          source_connector_id,source_connector_name,fetched_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(partyId) DO UPDATE SET
         partyType             = excluded.partyType,
         fullName              = excluded.fullName,
         firstName             = excluded.firstName,
         lastName              = excluded.lastName,
         dateOfBirth           = excluded.dateOfBirth,
         nationalId            = excluded.nationalId,
         email                 = excluded.email,
         phone                 = excluded.phone,
         address               = excluded.address,
         country               = excluded.country,
         status                = excluded.status,
         source_connector_id   = excluded.source_connector_id,
         source_connector_name = excluded.source_connector_name,
         fetched_at            = excluded.fetched_at`
    );

    const upsertAccount = db.prepare(
      `INSERT INTO account_objects
         (accountId,accountNumber,accountType,currency,balance,status,openDate,
          ownerId,branchCode,productCode,iban,
          source_connector_id,source_connector_name,fetched_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(accountId) DO UPDATE SET
         accountNumber         = excluded.accountNumber,
         accountType           = excluded.accountType,
         currency              = excluded.currency,
         balance               = excluded.balance,
         status                = excluded.status,
         openDate              = excluded.openDate,
         ownerId               = excluded.ownerId,
         branchCode            = excluded.branchCode,
         productCode           = excluded.productCode,
         iban                  = excluded.iban,
         source_connector_id   = excluded.source_connector_id,
         source_connector_name = excluded.source_connector_name,
         fetched_at            = excluded.fetched_at`
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
        const syncMeta = db.prepare('SELECT last_synced_at FROM source_mapping WHERE connector_id = ?').get(connector.id);
        const lastSyncedAt = syncMeta?.last_synced_at;

        const rows = lastSyncedAt
          ? db.prepare(`SELECT * FROM ${tableName} WHERE fetched_at > ? ORDER BY fetched_at ASC`).all(lastSyncedAt)
          : db.prepare(`SELECT * FROM ${tableName} ORDER BY fetched_at ASC`).all();

        if (rows.length === 0) {
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

        let transforms = [];
        try { transforms = JSON.parse(connector.transforms || '[]'); } catch {}

        const rawObjects = rows.map(r => { try { return JSON.parse(r.data); } catch { return r.data; } });
        const transformed = transforms.length > 0 ? applyTransforms(rawObjects, transforms) : rawObjects;

        const targetObj = connector.target_object;
        const priority  = targetObj === 'party' ? partyPriority : accountPriority;

        for (let i = 0; i < rows.length; i++) {
          const incoming  = transformed[i] !== undefined ? transformed[i] : rawObjects[i];
          const fetchedAt = rows[i].fetched_at;

          if (targetObj === 'party') {
            const keyId = incoming.partyId !== undefined ? String(incoming.partyId) : null;
            // If no partyId we can't deduplicate — skip merging, insert as-is
            const existing = keyId
              ? (db.prepare('SELECT * FROM party_objects WHERE partyId = ?').get(keyId) || {})
              : {};
            const merged = mergeByPriority(existing, incoming, connector.id, PARTY_FIELDS, priority);
            upsertParty.run(
              ...PARTY_FIELDS.map(f => merged[f] ?? null),
              connector.id, connector.name, fetchedAt
            );
          } else if (targetObj === 'account') {
            const keyId = incoming.accountId !== undefined ? String(incoming.accountId) : null;
            const existing = keyId
              ? (db.prepare('SELECT * FROM account_objects WHERE accountId = ?').get(keyId) || {})
              : {};
            const merged = mergeByPriority(existing, incoming, connector.id, ACCOUNT_FIELDS, priority);
            upsertAccount.run(
              ...ACCOUNT_FIELDS.map(f => merged[f] ?? null),
              connector.id, connector.name, fetchedAt
            );
          }
          // Raw-only connectors: data stays in connector_data_N
        }

        totalNew += rows.length;

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
