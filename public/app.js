// ═══════════════════════════════════════════════
//  Connector Platform — Frontend Application
// ═══════════════════════════════════════════════

(function () {
  'use strict';

  // ── DOM References ──
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const form = $('#onboardForm');
  const btnOnboard = $('#btnOnboard');
  const toastContainer = $('#toastContainer');
  const connectorList = $('#connectorList');
  const dataContent = $('#dataContent');
  const orchMessage = $('#orchMessage');

  // ── Tab Navigation ──
  const tabs = $$('.nav-tab');
  const panels = $$('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      $(`#panel${capitalize(target)}`).classList.add('active');

      if (target === 'connectors') loadConnectors();
      if (target === 'data') loadData();
    });
  });

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ── Toast Notifications ──
  function toast(msg, type = 'info') {
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
    toastContainer.appendChild(el);
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

  // ── Onboarding Form ──
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = $('#inputName').value.trim();
    const apiUrl = $('#inputUrl').value.trim();
    const schedule = $('#inputSchedule').value.trim() || '*/5 * * * *';
    const headers = $('#inputHeaders').value.trim() || '{}';
    const fieldMapping = $('#inputMapping').value.trim() || '{}';

    if (!name || !apiUrl) {
      toast('Name and API URL are required.', 'error');
      return;
    }

    // Validate JSON fields
    try { JSON.parse(headers); } catch { toast('Headers must be valid JSON.', 'error'); return; }
    try { JSON.parse(fieldMapping); } catch { toast('Field mapping must be valid JSON.', 'error'); return; }

    // Disable form
    btnOnboard.disabled = true;
    btnOnboard.innerHTML = '<span class="spinner"></span> Running Agents...';
    resetSteps();
    orchMessage.classList.add('hidden');

    try {
      // Start onboarding
      const res = await fetch('/api/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, apiUrl, schedule, headers, fieldMapping }),
      });
      const json = await res.json();

      if (!json.success) {
        toast(json.error || 'Onboarding failed to start.', 'error');
        btnOnboard.disabled = false;
        btnOnboard.innerHTML = '🚀 Start Onboarding';
        return;
      }

      // Connect to SSE stream
      connectSSE(json.sessionId);
    } catch (err) {
      toast(`Error: ${err.message}`, 'error');
      btnOnboard.disabled = false;
      btnOnboard.innerHTML = '🚀 Start Onboarding';
    }
  });

  // ── SSE Progress Stream ──
  function connectSSE(sessionId) {
    const eventSource = new EventSource(`/api/onboard/stream?sessionId=${sessionId}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'done') {
          eventSource.close();
          btnOnboard.disabled = false;
          btnOnboard.innerHTML = '🚀 Start Onboarding';
          loadStats();
          return;
        }

        if (data.type === 'connected') return;

        // Update step indicator
        if (data.step >= 1 && data.step <= 4) {
          updateStep(data.step, data.status, data.message);
        }

        // Orchestrator final message
        if (data.step === 0 && data.agent === 'Orchestrator') {
          showOrchMessage(data.status, data.message);
          if (data.status === 'success') {
            toast(data.message, 'success');
            form.reset();
            $('#inputSchedule').value = '*/5 * * * *';
            $('#inputHeaders').value = '{}';
            $('#inputMapping').value = '{}';
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
      btnOnboard.disabled = false;
      btnOnboard.innerHTML = '🚀 Start Onboarding';
    };
  }

  // ── Step UI Helpers ──
  function resetSteps() {
    for (let i = 1; i <= 4; i++) {
      const ind = $(`#ind${i}`);
      const msg = $(`#msg${i}`);
      ind.className = 'step-indicator pending';
      ind.textContent = i;
      msg.className = '';
      msg.textContent = [
        'Waiting to validate API endpoint...',
        'Waiting to generate connector config...',
        'Waiting to register and start scheduler...',
        'Waiting to run test fetch...',
      ][i - 1];
    }
  }

  function updateStep(step, status, message) {
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
    orchMessage.classList.remove('hidden');
    orchMessage.style.background = status === 'success'
      ? 'var(--success-bg)' : 'var(--error-bg)';
    orchMessage.style.color = status === 'success'
      ? 'var(--success)' : 'var(--error)';
    orchMessage.style.border = status === 'success'
      ? '1px solid rgba(52,211,153,0.3)' : '1px solid rgba(248,113,113,0.3)';
    orchMessage.textContent = message;
    orchMessage.classList.add('fade-in');
  }

  // ── Load Connectors ──
  async function loadConnectors() {
    try {
      const res = await fetch('/api/connectors');
      const json = await res.json();

      if (!json.success || json.data.length === 0) {
        connectorList.innerHTML = `
          <div class="empty-state">
            <div class="icon">🔌</div>
            <h3>No connectors yet</h3>
            <p>Onboard your first connector to see it here.</p>
          </div>`;
        return;
      }

      connectorList.innerHTML = json.data.map(c => `
        <div class="connector-item fade-in">
          <div class="connector-info">
            <div class="connector-avatar">${c.name.charAt(0).toUpperCase()}</div>
            <div class="connector-meta">
              <h4>${escapeHtml(c.name)}</h4>
              <p>${escapeHtml(c.api_url)}</p>
              <p style="margin-top:2px;font-size:11px;color:var(--text-muted);">
                Schedule: ${escapeHtml(c.schedule)} · Created: ${new Date(c.created_at).toLocaleString()}
                ${c.last_fetched_at ? ` · Last fetch: ${new Date(c.last_fetched_at).toLocaleString()}` : ''}
              </p>
            </div>
          </div>
          <div class="connector-actions">
            <span class="status-badge ${c.status === 'active' ? 'active' : c.last_error ? 'error' : 'pending'}">
              ${c.status}
            </span>
            <button class="btn btn-sm btn-danger" onclick="deleteConnector(${c.id})">Delete</button>
          </div>
        </div>
      `).join('');
    } catch (err) {
      toast(`Failed to load connectors: ${err.message}`, 'error');
    }
  }

  // ── Delete Connector ──
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

  // ── Load Consolidated Data ──
  async function loadData() {
    try {
      const res = await fetch('/api/data?limit=50');
      const json = await res.json();

      if (!json.success || json.data.length === 0) {
        dataContent.innerHTML = `
          <div class="empty-state">
            <div class="icon">📭</div>
            <h3>No consolidated data</h3>
            <p>Data will appear here once connectors fetch and the aggregator runs.</p>
          </div>`;
        return;
      }

      // Build table
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

      dataContent.innerHTML = html;
    } catch (err) {
      toast(`Failed to load data: ${err.message}`, 'error');
    }
  }

  // ── Refresh Data button ──
  $('#btnRefreshData').addEventListener('click', loadData);

  // ── Utility ──
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Initial Load ──
  loadStats();
  setInterval(loadStats, 30000);

})();
