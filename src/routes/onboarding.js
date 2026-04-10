const express = require('express');
const router = express.Router();
const { onboard, progressEmitter } = require('../agents/orchestrator');
const crypto = require('crypto');

// POST /api/onboard — start onboarding
router.post('/', async (req, res) => {
  const { name, apiUrl, schedule, headers, fieldSelection, targetObject, targetMapping } = req.body;

  if (!name || !apiUrl) {
    return res.status(400).json({ success: false, error: 'name and apiUrl are required.' });
  }

  const sessionId = crypto.randomUUID();

  // Start onboarding in background, respond immediately with session ID
  res.json({ success: true, sessionId, message: 'Onboarding started. Connect to SSE stream for progress.' });

  // Run the pipeline asynchronously
  try {
    await onboard({ name, apiUrl, schedule, headers, fieldSelection, targetObject, targetMapping }, sessionId);
  } catch (err) {
    progressEmitter.emit('progress', {
      sessionId,
      step: 0,
      agent: 'Orchestrator',
      status: 'failed',
      message: `Unexpected error: ${err.message}`,
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /api/onboard/stream — SSE endpoint for progress
router.get('/stream', (req, res) => {
  const sessionId = req.query.sessionId;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  res.write(`data: ${JSON.stringify({ type: 'connected', sessionId })}\n\n`);

  const listener = (event) => {
    if (!sessionId || event.sessionId === sessionId) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);

      // Close stream when orchestrator reports final status
      if (event.step === 0 && (event.status === 'success' || event.status === 'failed')) {
        setTimeout(() => {
          res.write(`data: ${JSON.stringify({ type: 'done', sessionId })}\n\n`);
          res.end();
        }, 500);
      }
    }
  };

  progressEmitter.on('progress', listener);

  req.on('close', () => {
    progressEmitter.removeListener('progress', listener);
  });
});

module.exports = router;
