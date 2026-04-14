# Connector Platform — Features

## Header
- Live stats: total connectors, active connectors, total records (auto-refreshes every 30s)

## Onboard Connector Tab — 3-Step Wizard

**Step 1: Connect**
- Enter connector name, API URL, cron schedule, HTTP method, and headers
- "Test Connection" fetches the API and shows detected fields with sample values

**Step 2: Select Fields**
- Checkbox list of all detected fields with sample values
- Select only the fields you care about — the rest are discarded

**Step 3: Map to Bank Object**
- Choose target schema: **Party** (customer) or **Account** (bank account)
- Map each selected source field to the corresponding bank object field via dropdown
- Auto-suggests mappings based on field name similarity
- Live JSON preview shows exactly what a mapped record will look like

**Agent Pipeline (5 steps, real-time progress):**
1. Validate — confirms the API is reachable and extracts fields
2. Scaffold — builds connector config and transform pipeline
3. Transform — validates mapping rules and dry-runs on sample data
4. Register — saves to database and starts cron job
5. Test — runs a live fetch to confirm everything works

## Connectors Tab

**Connector Table**
- Proper table showing: Connector name + URL, Target Object badge (👤 Party / 🏦 Account), fields selected/mapped, schedule, last fetch, status
- Delete removes the connector and all associated data

**Source Mapping**
- One row per connector showing sync metadata: target object, schedule, selected fields, field mapping summary, last synced time, records fetched this sync, total records

**Party / Account Field Map**
- Each target field (e.g. `email`, `partyId`) shown as a card
- Lists which connectors contribute to that field in priority order, labeled PRIMARY / FALLBACK
- ↑/↓ buttons to reorder priority per field — each field has its own independent source ranking
- ⚡ conflict indicator when multiple connectors map to the same field
- Stored as `final_object_mapping` — one JSON row per target object with the full field→sources structure

## Data Tab

Three views switchable at the top:
- **Party Objects** — structured table with canonical party columns (partyId, fullName, email, phone, etc.) populated by the aggregator
- **Account Objects** — structured table with canonical account columns (accountId, accountNumber, currency, balance, etc.)
- **Raw Data** — unstructured consolidated_data table showing all records as fetched

## Storage Architecture
- `connector_data_N` — raw fetched records per connector (one table per connector, updated on each cron tick)
- `source_mapping` — one row per connector: sync schedule, selected fields, field mapping, last synced time, record counts
- `party_objects` — final party records with explicit columns (partyId, fullName, email, etc.), built by the aggregator
- `account_objects` — final account records with explicit columns (accountId, accountNumber, balance, etc.)
- `final_object_mapping` — one row per target object (party/account); mapping JSON stores each target field with an ordered list of connector sources for field-level priority
- All child tables cascade-delete when a connector is removed

## General
- Toast notifications for all actions
- Mobile-friendly layout
