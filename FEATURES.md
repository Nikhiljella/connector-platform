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
- Lists all connectors with name, URL, schedule, status, last fetch time
- Shows field selection and mapping counts per connector
- Delete button to remove a connector

## Consolidated Data Tab
- Table of the latest 50 records across all connectors, with transforms applied
- Data appears as the mapped bank object fields (e.g. `partyId`, `fullName`) not raw API fields
- Refresh button

## General
- Toast notifications for all actions
- Mobile-friendly layout
