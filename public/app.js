// ═══════════════════════════════════════════════
//  Connector Platform — Frontend Application
// ═══════════════════════════════════════════════

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ── Bank object schemas ──
  const SCHEMAS = {
    party: [
      'partyId', 'partyType', 'fullName', 'firstName', 'lastName',
      'dateOfBirth', 'nationalId', 'email', 'phone', 'address', 'country', 'status',
    ],
    account: [
      'accountId', 'accountNumber', 'accountType', 'currency', 'balance',
      'status', 'openDate', 'ownerId', 'branchCode', 'productCode', 'iban',
    ],
  };

  // ── Wizard state ──
  let wizardStep = 1;
  let detectedFields = [];
  let sampleData = [];
  let selectedFields = [];
  let targetObject = 'party';
  let targetMapping = {}; // { sourceField: targetField }

  // ── Tab navigation ──
  $$('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      $$('.nav-tab').forEach(t => t.classList.remove('active'));
      $$('.tab-content').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      $(`#panel${capitalize(target)}`).classList.add('active');
      if (target === 'connectors') loadConnectors();
      if (target === 'data') loadData();
    });
  });

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ── Toast ──
  function toast(msg, type = 'info') {
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
    $('#toastContainer').appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(40px)';
      setTimeout(() => el.remove(), 300);
    }, 4000);
  }

  // ── Stats ──
  async function loadStats() {
    try {
      const res = await fetch('/api/stats');
      const json = await res.json();
      if (json.success) {
        $('#statConnectors').textContent = json.data.connectorCount;
        $('#statActive').textContent = json.data.activeCount;
        $('#statRecords').textContent = json.data.dataCount;
      }
    } catch (e) { /* ignore */ }
  }

  // ══════════════════════════════════════════
  //  WIZARD
  // ══════════════════════════════════════════

  function goToStep(step) {
    wizardStep = step;

    // Update progress nodes
    for (let i = 1; i <= 3; i++) {
      const node = $(`#wpStep${i}`);
      node.classList.remove('active', 'complete');
      if (i < step) node.classList.add('complete');
      else if (i === step) node.classList.add('active');
    }

    // Update connector lines
    for (let i = 1; i <= 2; i++) {
      $(`#wl${i}`).classList.toggle('complete', i < step);
    }

    // Show correct panel
    $$('.wizard-panel').forEach(p => p.classList.remove('active'));
    $(`#wizardStep${step}`).classList.add('active');

    if (step === 2) renderFieldSelection();
    if (step === 3) renderTargetMapping();
  }

  // ── Step 1: Test Connection ──
  $('#btnTestConnection').addEventListener('click', async () => {
    const apiUrl = $('#inputUrl').value.trim();
    const headers = $('#inputHeaders').value.trim() || '{}';

    if (!apiUrl) { toast('Enter an API URL first.', 'error'); return; }
    try { JSON.parse(headers); } catch { toast('Headers must be valid JSON.', 'error'); return; }

    const btn = $('#btnTestConnection');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Testing...';

    const result = $('#connectionResult');
    result.className = 'connection-result';
    result.innerHTML = '';

    try {
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiUrl, headers }),
      });
      const json = await res.json();

      if (!json.success) {
        result.classList.add('error');
        result.innerHTML = `<span class="cr-icon">✕</span><span>${escapeHtml(json.error)}</span>`;
        $('#btnStep1Next').disabled = true;
      } else {
        detectedFields = json.fields || [];
        sampleData = json.sampleData || [];

        result.classList.add('success');
        result.innerHTML = `
          <span class="cr-icon">✓</span>
          <div>
            <strong>${json.recordCount} record(s) found</strong>
            <div class="cr-fields">
              ${detectedFields.map(f => `<span class="field-chip">${escapeHtml(f)}</span>`).join('')}
            </div>
          </div>`;

        $('#btnStep1Next').disabled = false;
      }
    } catch (err) {
      result.classList.add('error');
      result.innerHTML = `<span class="cr-icon">✕</span><span>Error: ${escapeHtml(err.message)}</span>`;
      $('#btnStep1Next').disabled = true;
    }

    btn.disabled = false;
    btn.innerHTML = '🔍 Test Connection';
  });

  $('#btnStep1Next').addEventListener('click', () => {
    const name = $('#inputName').value.trim();
    if (!name) { toast('Enter a connector name.', 'error'); return; }
    goToStep(2);
  });

  // ── Step 2: Field Selection ──
  function renderFieldSelection() {
    const list = $('#fieldSelectionList');
    const sample = sampleData[0] || {};

    if (detectedFields.length === 0) {
      list.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">No fields detected.</p>';
      return;
    }

    list.innerHTML = `
      <div class="field-select-all">
        <label class="checkbox-label">
          <input type="checkbox" id="chkSelectAll">
          <span>Select all</span>
        </label>
        <span class="field-count" id="fieldCount">0 of ${detectedFields.length} selected</span>
      </div>
      ${detectedFields.map(f => {
        const sampleVal = sample[f] !== undefined ? String(sample[f]).slice(0, 40) : '';
        const checked = selectedFields.includes(f) ? 'checked' : '';
        return `
          <label class="field-row ${checked ? 'selected' : ''}" data-field="${escapeHtml(f)}">
            <input type="checkbox" class="field-checkbox" value="${escapeHtml(f)}" ${checked}>
            <span class="field-name">${escapeHtml(f)}</span>
            ${sampleVal ? `<span class="field-sample">${escapeHtml(sampleVal)}</span>` : ''}
          </label>`;
      }).join('')}`;

    // Sync select-all state
    syncSelectAll();

    // Checkbox change handlers
    list.querySelectorAll('.field-checkbox').forEach(chk => {
      chk.addEventListener('change', () => {
        const row = chk.closest('.field-row');
        row.classList.toggle('selected', chk.checked);
        syncSelectAll();
      });
    });

    $('#chkSelectAll').addEventListener('change', (e) => {
      list.querySelectorAll('.field-checkbox').forEach(chk => {
        chk.checked = e.target.checked;
        chk.closest('.field-row').classList.toggle('selected', e.target.checked);
      });
      syncSelectAll();
    });
  }

  function syncSelectAll() {
    const all = $$('.field-checkbox');
    const checked = [...all].filter(c => c.checked);
    const allChk = $('#chkSelectAll');
    if (allChk) {
      allChk.indeterminate = checked.length > 0 && checked.length < all.length;
      allChk.checked = checked.length === all.length && all.length > 0;
    }
    const countEl = $('#fieldCount');
    if (countEl) countEl.textContent = `${checked.length} of ${all.length} selected`;
  }

  $('#btnStep2Back').addEventListener('click', () => goToStep(1));

  $('#btnStep2Next').addEventListener('click', () => {
    selectedFields = [...$$('.field-checkbox')].filter(c => c.checked).map(c => c.value);
    if (selectedFields.length === 0) {
      toast('Select at least one field.', 'error');
      return;
    }
    goToStep(3);
  });

  // ── Step 3: Target Mapping ──
  function renderTargetMapping() {
    // Object type buttons
    $$('.object-type-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.type === targetObject);
    });

    renderMappingRows();
  }

  $$('.object-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      targetObject = btn.dataset.type;
      $$('.object-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Reset mapping when switching object type
      targetMapping = {};
      renderMappingRows();
    });
  });

  function renderMappingRows() {
    const schema = SCHEMAS[targetObject] || [];
    const container = $('#mappingRows');

    container.innerHTML = selectedFields.map(src => {
      const current = targetMapping[src] || '';
      return `
        <div class="mapping-row">
          <span class="mapping-source">${escapeHtml(src)}</span>
          <span class="mapping-arrow">→</span>
          <select class="mapping-select" data-source="${escapeHtml(src)}">
            <option value="">— skip —</option>
            ${schema.map(tgt => `
              <option value="${escapeHtml(tgt)}" ${current === tgt ? 'selected' : ''}>${escapeHtml(tgt)}</option>
            `).join('')}
          </select>
        </div>`;
    }).join('');

    // Listen for changes to rebuild preview
    container.querySelectorAll('.mapping-select').forEach(sel => {
      sel.addEventListener('change', () => {
        const src = sel.dataset.source;
        if (sel.value) {
          targetMapping[src] = sel.value;
        } else {
          delete targetMapping[src];
        }
        updatePreview();
      });
    });

    // Auto-suggest: match source field name to target schema (case-insensitive)
    selectedFields.forEach(src => {
      if (!targetMapping[src]) {
        const lower = src.toLowerCase();
        const match = schema.find(t => t.toLowerCase() === lower || t.toLowerCase().includes(lower) || lower.includes(t.toLowerCase()));
        if (match) {
          targetMapping[src] = match;
          const sel = container.querySelector(`[data-source="${src}"]`);
          if (sel) sel.value = match;
        }
      }
    });

    updatePreview();
  }

  function updatePreview() {
    const sample = sampleData[0] || {};
    const preview = {};

    selectedFields.forEach(src => {
      const tgt = targetMapping[src];
      const val = sample[src] !== undefined ? sample[src] : '…';
      if (tgt) {
        preview[tgt] = val;
      } else {
        preview[src] = val; // unmapped — kept as-is
      }
    });

    $('#mappingPreview').textContent = JSON.stringify(preview, null, 2);
  }

  $('#btnStep3Back').addEventListener('click', () => goToStep(2));

  // ── Submit ──
  $('#btnStartOnboarding').addEventListener('click', async () => {
    const name = $('#inputName').value.trim();
    const apiUrl = $('#inputUrl').value.trim();
    const schedule = $('#inputSchedule').value.trim() || '*/5 * * * *';
    const headers = $('#inputHeaders').value.trim() || '{}';

    if (!name || !apiUrl) {
      toast('Name and API URL are required.', 'error');
      goToStep(1);
      return;
    }

    const btn = $('#btnStartOnboarding');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Running Agents...';
    resetAgentSteps();
    $('#orchMessage').classList.add('hidden');

    try {
      const res = await fetch('/api/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          apiUrl,
          schedule,
          headers,
          fieldSelection: selectedFields,
          targetObject,
          targetMapping,
        }),
      });
      const json = await res.json();

      if (!json.success) {
        toast(json.error || 'Onboarding failed to start.', 'error');
        btn.disabled = false;
        btn.innerHTML = '🚀 Start Onboarding';
        return;
      }

      connectSSE(json.sessionId, btn);
    } catch (err) {
      toast(`Error: ${err.message}`, 'error');
      btn.disabled = false;
      btn.innerHTML = '🚀 Start Onboarding';
    }
  });

  // ── SSE Progress ──
  function connectSSE(sessionId, btn) {
    const eventSource = new EventSource(`/api/onboard/stream?sessionId=${sessionId}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'done') {
          eventSource.close();
          btn.disabled = false;
          btn.innerHTML = '🚀 Start Onboarding';
          loadStats();
          return;
        }
        if (data.type === 'connected') return;

        if (data.step >= 1 && data.step <= 5) {
          updateAgentStep(data.step, data.status, data.message);
        }

        if (data.step === 0 && data.agent === 'Orchestrator') {
          showOrchMessage(data.status, data.message);
          if (data.status === 'success') {
            toast(data.message, 'success');
            resetWizard();
          } else if (data.status === 'failed') {
            toast(data.message, 'error');
          }
        }
      } catch (e) {
        console.error('SSE parse error:', e);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      btn.disabled = false;
      btn.innerHTML = '🚀 Start Onboarding';
    };
  }

  function resetWizard() {
    $('#inputName').value = '';
    $('#inputUrl').value = '';
    $('#inputSchedule').value = '*/5 * * * *';
    $('#inputHeaders').value = '{}';
    $('#connectionResult').className = 'hidden';
    $('#btnStep1Next').disabled = true;
    detectedFields = [];
    sampleData = [];
    selectedFields = [];
    targetObject = 'party';
    targetMapping = {};
    goToStep(1);
  }

  // ── Agent Step UI ──
  function resetAgentSteps() {
    const defaultMessages = [
      'Waiting to validate API endpoint...',
      'Waiting to generate connector config...',
      'Waiting to validate transform rules...',
      'Waiting to register and start scheduler...',
      'Waiting to run test fetch...',
    ];
    for (let i = 1; i <= 5; i++) {
      const ind = $(`#ind${i}`);
      const msg = $(`#msg${i}`);
      ind.className = 'step-indicator pending';
      ind.textContent = i;
      msg.className = '';
      msg.textContent = defaultMessages[i - 1];
    }
  }

  function updateAgentStep(step, status, message) {
    const ind = $(`#ind${step}`);
    const msg = $(`#msg${step}`);
    ind.className = `step-indicator ${status}`;
    if (status === 'running') {
      ind.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;"></span>';
    } else if (status === 'success') {
      ind.textContent = '✓';
    } else if (status === 'failed') {
      ind.textContent = '✕';
    }
    msg.className = `msg-${status}`;
    msg.textContent = message;
  }

  function showOrchMessage(status, message) {
    const el = $('#orchMessage');
    el.classList.remove('hidden');
    el.style.background = status === 'success' ? 'var(--success-bg)' : 'var(--error-bg)';
    el.style.color = status === 'success' ? 'var(--success)' : 'var(--error)';
    el.style.border = status === 'success'
      ? '1px solid rgba(52,211,153,0.3)' : '1px solid rgba(248,113,113,0.3)';
    el.textContent = message;
    el.classList.add('fade-in');
  }

  // ══════════════════════════════════════════
  //  CONNECTORS TAB
  // ══════════════════════════════════════════

  async function loadConnectors() {
    try {
      const [connRes, mapRes] = await Promise.all([
        fetch('/api/connectors'),
        fetch('/api/field-map'),
      ]);
      const connJson = await connRes.json();
      const mapJson = await mapRes.json();

      renderConnectorTable(connJson.success ? connJson.data : []);
      renderFieldMap(mapJson.success ? mapJson.data : {});
    } catch (err) {
      toast(`Failed to load connectors: ${err.message}`, 'error');
    }
  }

  function renderConnectorTable(connectors) {
    const wrap = $('#connectorTableWrap');

    if (!connectors.length) {
      wrap.innerHTML = `
        <div class="empty-state">
          <div class="icon">🔌</div>
          <h3>No connectors yet</h3>
          <p>Onboard your first connector to see it here.</p>
        </div>`;
      return;
    }

    wrap.innerHTML = `
      <div class="ct-wrap">
        <table class="ct">
          <thead>
            <tr>
              <th style="width:80px;">Priority</th>
              <th>Connector</th>
              <th>Target</th>
              <th>Fields</th>
              <th>Schedule</th>
              <th>Last Fetch</th>
              <th>Status</th>
              <th style="width:80px;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${connectors.map((c, idx) => {
              let transforms = [];
              try { transforms = JSON.parse(c.transforms || '[]'); } catch {}
              const pickOp = transforms.find(t => t.op === 'pick');
              const renameOps = transforms.filter(t => t.op === 'rename');
              const selectedCount = pickOp ? pickOp.fields.length : 0;
              const mappedCount = renameOps.length;
              const isFirst = idx === 0;
              const isLast = idx === connectors.length - 1;

              return `<tr class="ct-row fade-in">
                <td>
                  <div class="priority-cell">
                    <span class="priority-badge">${c.priority}</span>
                    <div class="priority-btns">
                      <button class="prio-btn" title="Move up" onclick="shiftPriority(${c.id},'up')" ${isFirst ? 'disabled' : ''}>↑</button>
                      <button class="prio-btn" title="Move down" onclick="shiftPriority(${c.id},'down')" ${isLast ? 'disabled' : ''}>↓</button>
                    </div>
                  </div>
                </td>
                <td>
                  <div class="ct-name-cell">
                    <div class="connector-avatar" style="width:32px;height:32px;font-size:14px;">${c.name.charAt(0).toUpperCase()}</div>
                    <div>
                      <div style="font-weight:600;font-size:13px;">${escapeHtml(c.name)}</div>
                      <div style="font-size:11px;color:var(--text-muted);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(c.api_url)}</div>
                    </div>
                  </div>
                </td>
                <td>
                  ${c.target_object
                    ? `<span class="obj-badge ${c.target_object}">${c.target_object === 'party' ? '👤' : '🏦'} ${c.target_object}</span>`
                    : '<span style="color:var(--text-muted);font-size:12px;">—</span>'}
                </td>
                <td>
                  <div style="display:flex;flex-direction:column;gap:4px;">
                    ${selectedCount ? `<span class="transform-pill">📥 ${selectedCount} selected</span>` : ''}
                    ${mappedCount ? `<span class="transform-pill">🔀 ${mappedCount} mapped</span>` : ''}
                    ${!selectedCount && !mappedCount ? '<span style="color:var(--text-muted);font-size:12px;">raw</span>' : ''}
                  </div>
                </td>
                <td style="font-size:12px;font-family:var(--font-mono);color:var(--text-secondary);">${escapeHtml(c.schedule)}</td>
                <td style="font-size:12px;color:var(--text-muted);">
                  ${c.last_fetched_at ? new Date(c.last_fetched_at).toLocaleString() : '—'}
                </td>
                <td>
                  <span class="status-badge ${c.status === 'active' ? 'active' : c.last_error ? 'error' : 'pending'}">
                    ${c.status}
                  </span>
                </td>
                <td>
                  <button class="btn btn-sm btn-danger" onclick="deleteConnector(${c.id})">Delete</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function renderFieldMap(fieldMap) {
    const el = $('#fieldMapContent');
    const objectTypes = Object.keys(fieldMap);

    if (!objectTypes.length) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="icon">🗂️</div>
          <h3>No field mappings yet</h3>
          <p>Onboard connectors with field mapping to see the field map here.</p>
        </div>`;
      return;
    }

    el.innerHTML = objectTypes.map(objType => {
      const fields = fieldMap[objType];
      const fieldNames = Object.keys(fields).sort();

      return `
        <div class="fm-section">
          <div class="fm-object-label">
            ${objType === 'party' ? '👤' : '🏦'} ${capitalize(objType)} Object
          </div>
          <div class="fm-grid">
            ${fieldNames.map(field => {
              const sources = fields[field]; // sorted by priority already
              const hasConflict = sources.length > 1;

              return `
                <div class="fm-field ${hasConflict ? 'conflict' : ''}">
                  <div class="fm-field-name">
                    ${escapeHtml(field)}
                    ${hasConflict ? `<span class="conflict-badge">⚡ ${sources.length} sources</span>` : ''}
                  </div>
                  <div class="fm-sources">
                    ${sources.map((s, i) => `
                      <div class="fm-source ${i === 0 ? 'primary' : 'fallback'}">
                        <span class="fm-rank">${i === 0 ? 'PRIMARY' : `FALLBACK ${i}`}</span>
                        <span class="fm-connector-name">${escapeHtml(s.connectorName)}</span>
                        <span class="fm-source-field">← ${escapeHtml(s.sourceField)}</span>
                        <span class="fm-priority-num">P${s.priority}</span>
                      </div>`).join('')}
                  </div>
                </div>`;
            }).join('')}
          </div>
        </div>`;
    }).join('');
  }

  window.shiftPriority = async function (id, direction) {
    try {
      const res = await fetch(`/api/connectors/${id}/priority`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction }),
      });
      const json = await res.json();
      if (json.success) loadConnectors();
      else toast(json.error || 'Failed to update priority.', 'error');
    } catch (err) {
      toast(`Error: ${err.message}`, 'error');
    }
  };

  window.deleteConnector = async function (id) {
    if (!confirm('Are you sure you want to delete this connector?')) return;
    try {
      const res = await fetch(`/api/connectors/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        toast('Connector deleted.', 'success');
        loadConnectors();
        loadStats();
      } else {
        toast(json.error || 'Failed to delete.', 'error');
      }
    } catch (err) {
      toast(`Error: ${err.message}`, 'error');
    }
  };

  // ══════════════════════════════════════════
  //  DATA TAB
  // ══════════════════════════════════════════

  async function loadData() {
    try {
      const res = await fetch('/api/data?limit=50');
      const json = await res.json();

      if (!json.success || json.data.length === 0) {
        $('#dataContent').innerHTML = `
          <div class="empty-state">
            <div class="icon">📭</div>
            <h3>No consolidated data</h3>
            <p>Data will appear here once connectors fetch and the aggregator runs.</p>
          </div>`;
        return;
      }

      const firstRow = json.data[0].data;
      const fields = typeof firstRow === 'object' ? Object.keys(firstRow).slice(0, 6) : ['data'];

      let html = `
        <div class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Connector</th>
                <th>Fetched At</th>
                ${fields.map(f => `<th>${escapeHtml(f)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${json.data.map(row => {
                const d = row.data;
                return `<tr>
                  <td><span class="status-badge active" style="font-size:10px;">${escapeHtml(row.connector_name)}</span></td>
                  <td>${row.fetched_at ? new Date(row.fetched_at).toLocaleString() : '—'}</td>
                  ${fields.map(f => `<td>${escapeHtml(String(d && d[f] !== undefined ? d[f] : ''))}</td>`).join('')}
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <p style="margin-top:12px;font-size:12px;color:var(--text-muted);">
          Showing ${json.data.length} of ${json.pagination.total} records
        </p>`;

      $('#dataContent').innerHTML = html;
    } catch (err) {
      toast(`Failed to load data: ${err.message}`, 'error');
    }
  }

  $('#btnRefreshData').addEventListener('click', loadData);

  // ── Utility ──
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Initial load ──
  loadStats();
  setInterval(loadStats, 30000);

})();
