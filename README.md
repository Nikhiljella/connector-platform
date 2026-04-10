# Connector Platform

An agentic platform for onboarding REST API data connectors, mapping fields to canonical bank objects, and consolidating data into a central store.

## Requirements

- Node.js 18+
- npm

## Setup

```bash
cd connector-platform
npm install
```

## Running

**Terminal 1 — Mock APIs (optional, for local testing):**
```bash
node fake-servers.js
```
Starts three test APIs:
- `http://localhost:4001` — Users (25 records)
- `http://localhost:4002` — Metrics (10 records)
- `http://localhost:4003` — Products (20 records)

**Terminal 2 — Platform:**
```bash
npm start
```

Open `http://localhost:3000`

## How it works

1. **Onboard** a connector by entering an API URL and clicking "Test Connection"
2. **Select** which fields from the response you want to keep
3. **Map** those fields to a Party or Account bank object schema
4. The agent pipeline validates, scaffolds, registers, and test-fetches the connector
5. Data is collected on a cron schedule and consolidated every 2 minutes with your field mappings applied
