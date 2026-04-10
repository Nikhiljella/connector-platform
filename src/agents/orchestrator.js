const validateAgent = require('./validateAgent');
const scaffoldAgent = require('./scaffoldAgent');
const transformAgent = require('./transformAgent');
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

async function onboard({ name, apiUrl, schedule, headers, fieldSelection, targetObject, targetMapping }, sessionId) {
  const pipeline = [];
  let connectorId = null;

  // Step 1: Validate
  emit(sessionId, 1, { agent: 'ValidateAgent', status: 'running', message: 'Validating API endpoint...' });
  await sleep(500);
  const validateReport = await validateAgent.execute({ apiUrl, headers });
  emit(sessionId, 1, validateReport);
  pipeline.push(validateReport);

  if (validateReport.status === 'failed') {
    emit(sessionId, 0, { agent: 'Orchestrator', status: 'failed', message: `Onboarding failed at validation: ${validateReport.message}` });
    return { success: false, pipeline, error: validateReport.message };
  }

  // Step 2: Scaffold
  await sleep(400);
  emit(sessionId, 2, { agent: 'ScaffoldAgent', status: 'running', message: 'Scaffolding connector config and building transform pipeline...' });
  await sleep(500);
  const scaffoldReport = scaffoldAgent.execute({
    name, apiUrl, schedule, headers,
    fieldSelection, targetObject, targetMapping,
    fields: validateReport.fields,
  });
  emit(sessionId, 2, scaffoldReport);
  pipeline.push(scaffoldReport);

  if (scaffoldReport.status === 'failed') {
    emit(sessionId, 0, { agent: 'Orchestrator', status: 'failed', message: `Onboarding failed at scaffold: ${scaffoldReport.message}` });
    return { success: false, pipeline, error: scaffoldReport.message };
  }

  // Step 3: Transform — validate and dry-run the transform rules
  await sleep(400);
  emit(sessionId, 3, { agent: 'TransformAgent', status: 'running', message: 'Validating transform rules and running dry-run on sample data...' });
  await sleep(500);
  const transformReport = transformAgent.execute({
    transforms: scaffoldReport.config.transforms,
    sampleData: validateReport.sampleData,
  });
  emit(sessionId, 3, transformReport);
  pipeline.push(transformReport);

  if (transformReport.status === 'failed') {
    emit(sessionId, 0, { agent: 'Orchestrator', status: 'failed', message: `Onboarding failed at transform validation: ${transformReport.message}` });
    return { success: false, pipeline, error: transformReport.message };
  }

  // Step 4: Register
  await sleep(400);
  emit(sessionId, 4, { agent: 'RegisterAgent', status: 'running', message: 'Registering connector and starting scheduler...' });
  await sleep(500);
  const registerReport = registerAgent.execute({ config: scaffoldReport.config });
  emit(sessionId, 4, registerReport);
  pipeline.push(registerReport);

  if (registerReport.status === 'failed') {
    emit(sessionId, 0, { agent: 'Orchestrator', status: 'failed', message: `Onboarding failed at registration: ${registerReport.message}` });
    return { success: false, pipeline, error: registerReport.message };
  }

  connectorId = registerReport.connectorId;

  // Step 5: Test
  await sleep(400);
  emit(sessionId, 5, { agent: 'TestAgent', status: 'running', message: 'Running test fetch...' });
  await sleep(500);
  const testReport = await testAgent.execute({ connectorId });
  emit(sessionId, 5, testReport);
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
