const express = require('express');
const cors = require('cors');
const path = require('path');

const { getDb } = require('./src/db');
const { startAllConnectors } = require('./src/connectorEngine');
const { startAggregator } = require('./src/aggregator');
const gatewayRoutes = require('./src/routes/gateway');
const onboardingRoutes = require('./src/routes/onboarding');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api', gatewayRoutes);
app.use('/api/onboard', onboardingRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize
app.listen(PORT, () => {
  console.log(`\n🚀 Connector Platform running at http://localhost:${PORT}\n`);

  // Initialize database
  getDb();
  console.log('📦 Database initialized');

  // Start existing connectors
  startAllConnectors();

  // Start aggregator
  startAggregator('*/2 * * * *');
  console.log('⚡ Aggregator started\n');
});
