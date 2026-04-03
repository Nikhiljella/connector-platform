const validateAgent = require('./validateAgent');
const scaffoldAgent = require('./scaffoldAgent');
const registerAgent = require('./registerAgent');
const testAgent = require('./testAgent');

// Event emitter for SSE progress
const EventEmitter = require('events');
const progressEmitter = new EventEmitter();
progressEmitter.setMaxListeners(50);

function emit(sessionId, step, report) {
  progressEmitter.emit('progress', {
    sessionId,
    step,
    agent: report.agent,
    status: report.status,
    message: report.message,
    details: report,
    timestamp: new Date().toISOString(),
  });
}

async function onboard({ name, apiUrl, schedule, headers, fieldMapping }, sessionId) {
  const pipeline = [];
  let connectorId = null;

  // Step 1: Validate
  emit(sessionId, 1, { agent: 'ValidateAgent', status: 'running', message: 'Validating API endpoint...' });
  await sleep(500); // Small delay for UI animation
  const validateReport = await validateAgent.execute({ apiUrl, headers });
  emit(sessionId, 1, validateReport);
  pipeline.push(validateReport);

  if (validateReport.status === 'failed') {
    emit(sessionId, 0, { agent: 'Orchestrator', status: 'failed', message: `Onboarding failed at validation: ${validateReport.message}` });
    return { success: false, pipeline, error: validateReport.message };
  }

  // Step 2: Scaffold
  await sleep(400);
  emit(sessionId, 2, { agent: 'ScaffoldAgent', status: 'running', message: 'Scaffolding connector config...' });
  await sleep(500);
  const scaffoldReport = scaffoldAgent.execute({
    name,
    apiUrl,
    schedule,
    headers,
    fieldMapping,
    fields: validateReport.fields,
  });
  emit(sessionId, 2, scaffoldReport);
  pipeline.push(scaffoldReport);

  if (scaffoldReport.status === 'failed') {
    emit(sessionId, 0, { agent: 'Orchestrator', status: 'failed', message: `Onboarding failed at scaffold: ${scaffoldReport.message}` });
    return { success: false, pipeline, error: scaffoldReport.message };
  }

  // Step 3: Register
  await sleep(400);
  emit(sessionId, 3, { agent: 'RegisterAgent', status: 'running', message: 'Registering connector and starting scheduler...' });
  await sleep(500);
  const registerReport = registerAgent.execute({ config: scaffoldReport.config });
  emit(sessionId, 3, registerReport);
  pipeline.push(registerReport);

  if (registerReport.status === 'failed') {
    emit(sessionId, 0, { agent: 'Orchestrator', status: 'failed', message: `Onboarding failed at registration: ${registerReport.message}` });
    return { success: false, pipeline, error: registerReport.message };
  }

  connectorId = registerReport.connectorId;

  // Step 4: Test
  await sleep(400);
  emit(sessionId, 4, { agent: 'TestAgent', status: 'running', message: 'Running test fetch...' });
  await sleep(500);
  const testReport = await testAgent.execute({ connectorId });
  emit(sessionId, 4, testReport);
  pipeline.push(testReport);

  if (testReport.status === 'failed') {
    emit(sessionId, 0, { agent: 'Orchestrator', status: 'failed', message: `Onboarding completed with test failure: ${testReport.message}` });
    return { success: false, pipeline, connectorId, error: testReport.message };
  }

  // Success
  emit(sessionId, 0, { agent: 'Orchestrator', status: 'success', message: `Connector "${name}" onboarded successfully! ID: ${connectorId}` });

  return { success: true, pipeline, connectorId };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { onboard, progressEmitter };
