/**
 * Meeting Tickets — Frontend Logic
 * Manages 3-state navigation (start, processing, results),
 * live SSE diagnostics, model pickers, popovers, and drawers.
 */

// Application State
const state = {
  currentView: 'start', // 'start' | 'processing' | 'results'
  activeInputTab: 'audio', // 'audio' | 'text'
  activeResultsTab: 'tickets', // 'tickets' | 'transcript'
  selectedAudioFile: null,
  currentJobId: null,
  sseSource: null,
  rawLogLines: [],
  currentTickets: [],
  currentTranscript: '',
  hasError: false,
  models: {
    whisper: [],
    llm: [],
    loadedWhisper: null,
    loadedLlm: null,
  },
  diagnostics: {
    totalElapsed: null,
    stageTimes: {},
  }
};

// ── DOM Elements ──
const els = {};

function initElements() {
  els.stateStart = document.getElementById('state-start');
  els.stateProcessing = document.getElementById('state-processing');
  els.stateResults = document.getElementById('state-results');

  els.btnNewMeeting = document.getElementById('btn-new-meeting');
  els.statusBtn = document.getElementById('status-btn');
  els.statusDot = document.getElementById('status-dot');
  els.statusSummary = document.getElementById('status-summary');
  els.envPopover = document.getElementById('env-popover');
  els.btnDiagnostics = document.getElementById('btn-diagnostics');
  els.diagErrorBadge = document.getElementById('diag-error-badge');

  els.envBackend = document.getElementById('env-backend');
  els.envGpu = document.getElementById('env-gpu');
  els.envWhisper = document.getElementById('env-whisper');
  els.envLlm = document.getElementById('env-llm');
  els.envVram = document.getElementById('env-vram');
  els.envVramRow = document.getElementById('env-vram-row');

  els.pillWhisper = document.getElementById('pill-whisper');
  els.pillWhisperLabel = document.getElementById('pill-whisper-label');
  els.selectWhisper = document.getElementById('select-whisper');

  els.pillLlm = document.getElementById('pill-llm');
  els.pillLlmLabel = document.getElementById('pill-llm-label');
  els.selectLlm = document.getElementById('select-llm');

  els.tabAudioBtn = document.getElementById('tab-audio-btn');
  els.tabNotesBtn = document.getElementById('tab-notes-btn');
  els.paneAudio = document.getElementById('pane-audio');
  els.paneNotes = document.getElementById('pane-notes');

  els.dropzone = document.getElementById('dropzone');
  els.fileInput = document.getElementById('file-input');
  els.fileSelectedBox = document.getElementById('file-selected-box');
  els.fileName = document.getElementById('file-name');
  els.fileSize = document.getElementById('file-size');
  els.btnRemoveFile = document.getElementById('btn-remove-file');

  els.notesInput = document.getElementById('notes-input');
  els.btnGenerate = document.getElementById('btn-generate');
  els.startStatusText = document.getElementById('start-status-text');

  els.errorCard = document.getElementById('error-card');
  els.errorCardStage = document.getElementById('error-card-stage');
  els.errorCardMsg = document.getElementById('error-card-msg');
  els.errorCardRaw = document.getElementById('error-card-raw');

  els.resultsTicketsList = document.getElementById('results-tickets-list');
  els.resultsTranscriptCard = document.getElementById('results-transcript-card');
  els.resultsTabTicketsBtn = document.getElementById('results-tab-tickets-btn');
  els.resultsTabTranscriptBtn = document.getElementById('results-tab-transcript-btn');
  els.ticketsBadgeCount = document.getElementById('tickets-badge-count');
  els.completionSummaryBar = document.getElementById('completion-summary-bar');
  els.summaryTimingText = document.getElementById('summary-timing-text');

  els.drawerBackdrop = document.getElementById('drawer-backdrop');
  els.drawer = document.getElementById('drawer');
  els.btnCloseDrawer = document.getElementById('drawer-close-btn');
  els.drawerLogs = document.getElementById('drawer-logs');
  els.btnDownloadLog = document.getElementById('btn-download-log');
}

// ── State Switching ──
function switchView(viewName) {
  state.currentView = viewName;
  [els.stateStart, els.stateProcessing, els.stateResults].forEach(v => {
    v.classList.remove('active');
  });

  if (viewName === 'start') {
    els.stateStart.classList.add('active');
    els.btnNewMeeting.style.display = 'none';
  } else if (viewName === 'processing') {
    els.stateProcessing.classList.add('active');
    els.btnNewMeeting.style.display = 'none';
  } else if (viewName === 'results') {
    els.stateResults.classList.add('active');
    els.btnNewMeeting.style.display = 'inline-flex';
  }
}

// ── Logging & Telemetry ──
function appendLog(line) {
  const ts = new Date().toLocaleTimeString();
  const entry = `[${ts}] ${line}`;
  state.rawLogLines.push(entry);
  if (els.drawerLogs) {
    els.drawerLogs.textContent = state.rawLogLines.join('\n');
    els.drawerLogs.scrollTop = els.drawerLogs.scrollHeight;
  }
}

function downloadRawLog() {
  const blob = new Blob([state.rawLogLines.join('\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `meeting-tickets-log-${Date.now()}.txt`;
  a.click();
}

// ── Health Polling ──
async function refreshHealth() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Environment info
    els.envBackend.textContent = data.backend.toUpperCase();
    els.envGpu.textContent = data.gpu_name;

    const ws = data.whisper_server;
    const ls = data.llama_server;

    els.envWhisper.textContent = `${ws.status} (${ws.model_id || 'none'}${ws.load_time_s ? ' in ' + ws.load_time_s + 's' : ''})`;
    els.envLlm.textContent = `${ls.status} (${ls.model_id || 'none'}${ls.load_time_s ? ' in ' + ls.load_time_s + 's' : ''})`;

    if (data.vram) {
      els.envVramRow.style.display = 'contents';
      els.envVram.textContent = `${data.vram.used_mb}MB / ${data.vram.total_mb}MB`;
    } else {
      els.envVramRow.style.display = 'none';
    }

    // Overall status dot
    const isUp = ws.status === 'up' && ls.status === 'up';
    const isLoading = ws.status === 'loading' || ls.status === 'loading';

    els.statusDot.className = 'status-dot';
    if (isLoading) {
      els.statusDot.classList.add('loading');
      els.statusSummary.textContent = 'Loading...';
    } else if (isUp) {
      els.statusDot.classList.add('up');
      els.statusSummary.textContent = 'Ready';
    } else {
      els.statusDot.classList.add('down');
      els.statusSummary.textContent = 'Offline';
    }
  } catch (err) {
    els.statusDot.className = 'status-dot down';
    els.statusSummary.textContent = 'Offline';
  }
}

// ── Model Registry & Selection ──
async function loadModelsRegistry() {
  try {
    const res = await fetch('/api/models');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    state.models.whisper = data.models.filter(m => m.type === 'whisper');
    state.models.llm = data.models.filter(m => m.type === 'llm');
    state.models.loadedWhisper = data.loaded_whisper;
    state.models.loadedLlm = data.loaded_llm;

    populateSelect(els.selectWhisper, state.models.whisper, data.loaded_whisper, els.pillWhisperLabel);
    populateSelect(els.selectLlm, state.models.llm, data.loaded_llm, els.pillLlmLabel);
  } catch (err) {
    appendLog(`Failed to fetch models: ${err.message}`);
  }
}

function populateSelect(selectEl, modelList, loadedId, labelEl) {
  selectEl.innerHTML = '';
  modelList.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.available ? m.name : `${m.name} (not found)`;
    opt.disabled = !m.available;
    if (m.id === loadedId) {
      opt.selected = true;
      if (labelEl) labelEl.textContent = m.name;
    }
    selectEl.appendChild(opt);
  });
}

async function onModelSelect(type) {
  const isWhisper = type === 'whisper';
  const selectEl = isWhisper ? els.selectWhisper : els.selectLlm;
  const pillEl = isWhisper ? els.pillWhisper : els.pillLlm;
  const labelEl = isWhisper ? els.pillWhisperLabel : els.pillLlmLabel;
  const modelId = selectEl.value;

  const prevId = isWhisper ? state.models.loadedWhisper : state.models.loadedLlm;
  if (modelId === prevId) return;

  pillEl.classList.add('switching');
  const prevLabel = labelEl.textContent;
  labelEl.textContent = 'loading...';
  els.btnGenerate.disabled = true;

  appendLog(`Switching ${type} model to ${modelId}...`);

  try {
    const res = await fetch('/api/models/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: modelId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to switch model');

    appendLog(`${type} switched in ${data.load_time_s || 0}s`);
    if (isWhisper) state.models.loadedWhisper = modelId;
    else state.models.loadedLlm = modelId;

    const chosen = (isWhisper ? state.models.whisper : state.models.llm).find(m => m.id === modelId);
    if (chosen) labelEl.textContent = chosen.name;
  } catch (err) {
    appendLog(`Model switch failed: ${err.message}`);
    showErrorCard(`Model Switch (${type})`, err.message);
    selectEl.value = prevId;
    labelEl.textContent = prevLabel;
  } finally {
    pillEl.classList.remove('switching');
    validateInputs();
    refreshHealth();
  }
}

// ── Input & Validation ──
function switchInputTab(tab) {
  state.activeInputTab = tab;
  els.tabAudioBtn.classList.toggle('active', tab === 'audio');
  els.tabNotesBtn.classList.toggle('active', tab === 'notes');
  els.paneAudio.classList.toggle('active', tab === 'audio');
  els.paneNotes.classList.toggle('active', tab === 'notes');
  validateInputs();
}

function handleFilePicked(file) {
  if (!file) return;
  state.selectedAudioFile = file;
  els.fileName.textContent = file.name;
  const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
  els.fileSize.textContent = `${sizeMb} MB`;
  els.dropzone.style.display = 'none';
  els.fileSelectedBox.style.display = 'flex';
  validateInputs();
}

function removeAudioFile() {
  state.selectedAudioFile = null;
  els.fileInput.value = '';
  els.fileSelectedBox.style.display = 'none';
  els.dropzone.style.display = 'block';
  validateInputs();
}

function validateInputs() {
  let hasValid = false;
  if (state.activeInputTab === 'audio') {
    hasValid = !!state.selectedAudioFile;
  } else {
    hasValid = els.notesInput.value.trim().length > 0;
  }
  const isModelSwitching = els.pillWhisper.classList.contains('switching') || els.pillLlm.classList.contains('switching');
  els.btnGenerate.disabled = !hasValid || isModelSwitching;
}

// ── Stepper UI ──
const STAGES = [
  'input_received',
  'audio_conversion',
  'transcription',
  'ticket_extraction',
  'validation',
  'done',
];

function resetStepper() {
  STAGES.forEach(s => {
    const item = document.getElementById(`step-${s}`);
    if (!item) return;
    item.className = 'step-item';
    const circle = item.querySelector('.step-circle');
    circle.innerHTML = getStepDefaultIcon(s);
    item.querySelector('.step-time').textContent = '';
    item.querySelector('.step-detail').textContent = 'Pending';
  });
}

function getStepDefaultIcon(stage) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="6"/></svg>';
}

function updateStepUI(evt) {
  const item = document.getElementById(`step-${evt.stage}`);
  if (!item) return;

  const circle = item.querySelector('.step-circle');
  const timeEl = item.querySelector('.step-time');
  const detailEl = item.querySelector('.step-detail');

  item.className = `step-item ${evt.status}`;

  if (evt.status === 'running') {
    circle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>';
  } else if (evt.status === 'done') {
    circle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
  } else if (evt.status === 'failed') {
    circle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  } else if (evt.status === 'skipped') {
    circle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>';
  }

  if (evt.elapsed_s != null) {
    timeEl.textContent = `${evt.elapsed_s}s`;
    state.diagnostics.stageTimes[evt.stage] = evt.elapsed_s;
  }

  // Construct one-line detail
  let details = [];
  if (evt.input_type) details.push(`Type: ${evt.input_type}`);
  if (evt.filename) details.push(evt.filename);
  if (evt.text_length != null) details.push(`${evt.text_length} chars`);
  if (evt.duration_s) details.push(`${evt.duration_s}s audio`);
  if (evt.speed) details.push(evt.speed);
  if (evt.word_count != null) details.push(`${evt.word_count} words`);
  if (evt.chunk) details.push(evt.chunk);
  if (evt.tokens_per_second) details.push(`${evt.tokens_per_second} tok/s`);
  if (evt.completion_tokens) details.push(`${evt.completion_tokens} tokens`);
  if (evt.ticket_count != null) details.push(`${evt.ticket_count} tickets parsed`);
  if (evt.total_elapsed_s != null) details.push(`Total: ${evt.total_elapsed_s}s`);
  if (evt.error) details.push(`Error: ${evt.error}`);

  if (details.length > 0) {
    detailEl.textContent = details.join(' • ');
  }
}

// ── Error Handling ──
function showErrorCard(stage, message, raw = null) {
  state.hasError = true;
  els.diagErrorBadge.style.display = 'block';
  els.errorCardStage.textContent = stage || 'Pipeline';
  els.errorCardMsg.textContent = message || 'An error occurred during processing.';
  if (raw) {
    els.errorCardRaw.style.display = 'block';
    els.errorCardRaw.textContent = raw;
  } else {
    els.errorCardRaw.style.display = 'none';
  }
  els.errorCard.style.display = 'block';
}

function clearErrorCard() {
  state.hasError = false;
  els.diagErrorBadge.style.display = 'none';
  els.errorCard.style.display = 'none';
}

// ── Ticket Rendering & Markdown Copy ──
function renderTickets(tickets) {
  state.currentTickets = tickets || [];
  els.resultsTicketsList.innerHTML = '';
  els.ticketsBadgeCount.textContent = state.currentTickets.length;

  state.currentTickets.forEach((t, i) => {
    const card = document.createElement('div');
    const p = (t.priority || 'medium').toLowerCase();
    card.className = `ticket-card ${p}`;

    const acItems = (t.acceptance_criteria || [])
      .map(ac => `<li class="criteria-item">${escapeHtml(ac)}</li>`)
      .join('');

    card.innerHTML = `
      <div class="ticket-header">
        <h3 class="ticket-title">${escapeHtml(t.title)}</h3>
        <div class="ticket-tags">
          <span class="badge p-${p}">${p}</span>
          ${t.assignee ? `<span class="badge assignee">@${escapeHtml(t.assignee)}</span>` : ''}
        </div>
      </div>
      <div class="ticket-desc">${escapeHtml(t.description)}</div>
      ${acItems ? `
        <div class="ticket-criteria">
          <div class="ticket-criteria-label">Acceptance Criteria</div>
          <ul class="criteria-list">${acItems}</ul>
        </div>
      ` : ''}
      <div class="ticket-footer">
        <button class="btn-copy-ticket" onclick="copySingleTicket(${i}, this)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <span>Copy</span>
        </button>
      </div>
    `;
    els.resultsTicketsList.appendChild(card);
  });
}

function formatTicketMd(t) {
  let md = `### ${t.title}\n\n`;
  md += `**Priority:** ${t.priority || 'medium'}  \n`;
  if (t.assignee) md += `**Assignee:** ${t.assignee}  \n`;
  md += `\n${t.description}\n\n`;
  if (t.acceptance_criteria && t.acceptance_criteria.length > 0) {
    md += `**Acceptance Criteria:**\n`;
    t.acceptance_criteria.forEach(ac => {
      md += `- ${ac}\n`;
    });
  }
  return md.trim();
}

async function copySingleTicket(index, btn) {
  const t = state.currentTickets[index];
  if (!t) return;
  const md = formatTicketMd(t);
  await navigator.clipboard.writeText(md);
  btn.classList.add('copied');
  btn.querySelector('span').textContent = 'Copied';
  setTimeout(() => {
    btn.classList.remove('copied');
    btn.querySelector('span').textContent = 'Copy';
  }, 2000);
}

async function copyAllTickets() {
  if (!state.currentTickets.length) return;
  const fullMd = state.currentTickets.map(formatTicketMd).join('\n\n---\n\n');
  await navigator.clipboard.writeText(fullMd);
  appendLog('Copied all tickets formatted in Markdown');
  alert('All tickets copied to clipboard as Markdown!');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── Results Tabs Switcher ──
function switchResultsTab(tab) {
  state.activeResultsTab = tab;
  els.resultsTabTicketsBtn.classList.toggle('active', tab === 'tickets');
  els.resultsTabTranscriptBtn.classList.toggle('active', tab === 'transcript');
  if (tab === 'tickets') {
    els.resultsTicketsList.style.display = 'flex';
    els.resultsTranscriptCard.style.display = 'none';
  } else {
    els.resultsTicketsList.style.display = 'none';
    els.resultsTranscriptCard.style.display = 'block';
  }
}

// ── Execution Pipeline (Start Job) ──
async function submitMeeting() {
  clearErrorCard();
  const formData = new FormData();

  if (state.activeInputTab === 'audio') {
    if (!state.selectedAudioFile) return;
    formData.append('audio', state.selectedAudioFile);
  } else {
    const textVal = els.notesInput.value.trim();
    if (!textVal) return;
    formData.append('text', textVal);
  }

  // Switch to Processing State View
  switchView('processing');
  resetStepper();

  appendLog('Starting ticket generation pipeline...');

  try {
    const res = await fetch('/api/jobs', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Job creation failed');

    state.currentJobId = data.job_id;
    appendLog(`Job created: ${state.currentJobId}`);

    // Connect Server-Sent Events
    subscribeToJobEvents(state.currentJobId);
  } catch (err) {
    appendLog(`Job failed to start: ${err.message}`);
    showErrorCard('Job Start', err.message);
    switchView('start');
  }
}

function subscribeToJobEvents(jobId) {
  if (state.sseSource) state.sseSource.close();
  state.sseSource = new EventSource(`/api/jobs/${jobId}/events`);

  state.sseSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      appendLog(`[${data.stage}] ${data.status} ${JSON.stringify(data)}`);
      updateStepUI(data);

      if (data.status === 'failed') {
        showErrorCard(data.stage, data.error, data.raw_output);
      }

      if (data.stage === 'done') {
        state.sseSource.close();
        if (data.status === 'done') {
          // Finished successfully
          state.currentTranscript = data.transcript || '';
          els.resultsTranscriptCard.textContent = state.currentTranscript || 'No transcript available.';
          renderTickets(data.tickets || []);

          // Build completion timing summary
          const total = data.total_elapsed_s || 0;
          const stageTimes = data.stage_times || {};
          let summary = `Done in <strong>${total}s</strong>: `;
          const parts = [];
          if (stageTimes.transcription != null) parts.push(`transcription ${stageTimes.transcription}s`);
          if (stageTimes.ticket_extraction != null) parts.push(`tickets ${stageTimes.ticket_extraction}s`);
          summary += parts.join(', ') || 'completed';

          els.summaryTimingText.innerHTML = summary;
          switchResultsTab('tickets');
          switchView('results');
        } else {
          // Failure
          showErrorCard('Pipeline', data.error || 'Failed to generate tickets');
          switchView('start');
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  state.sseSource.onerror = () => {
    appendLog('SSE stream closed.');
    state.sseSource.close();
  };
}

// ── Drawer & Popover Interactivity ──
function togglePopover(show = null) {
  const isOpen = els.envPopover.classList.contains('open');
  const target = show !== null ? show : !isOpen;
  els.envPopover.classList.toggle('open', target);
}

function toggleDrawer(show = null) {
  const isOpen = els.drawer.classList.contains('open');
  const target = show !== null ? show : !isOpen;
  els.drawer.classList.toggle('open', target);
  els.drawerBackdrop.classList.toggle('open', target);
}

// ── Event Bindings ──
function bindEvents() {
  // New Meeting button returns to start view keeping input
  els.btnNewMeeting.addEventListener('click', () => {
    switchView('start');
  });

  // Status button triggers environment popover
  els.statusBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePopover();
  });

  // Diagnostics button triggers slide-over drawer
  els.btnDiagnostics.addEventListener('click', () => {
    toggleDrawer(true);
  });

  // Close drawer
  els.btnCloseDrawer.addEventListener('click', () => toggleDrawer(false));
  els.drawerBackdrop.addEventListener('click', () => toggleDrawer(false));

  // Summary bar opens drawer
  els.completionSummaryBar.addEventListener('click', () => toggleDrawer(true));

  // Download log
  els.btnDownloadLog.addEventListener('click', downloadRawLog);

  // Close popover when clicking outside
  document.addEventListener('click', (e) => {
    if (!els.envPopover.contains(e.target) && !els.statusBtn.contains(e.target)) {
      togglePopover(false);
    }
  });

  // Keyboard shortcut Esc to close drawers & popovers
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      togglePopover(false);
      toggleDrawer(false);
    }
  });

  // Model Pill changes
  els.selectWhisper.addEventListener('change', () => onModelSelect('whisper'));
  els.selectLlm.addEventListener('change', () => onModelSelect('llm'));

  // Start tabs
  els.tabAudioBtn.addEventListener('click', () => switchInputTab('audio'));
  els.tabNotesBtn.addEventListener('click', () => switchInputTab('notes'));

  // File Dropzone
  els.dropzone.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) handleFilePicked(e.target.files[0]);
  });

  ['dragenter', 'dragover'].forEach(eventName => {
    els.dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      els.dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    els.dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      els.dropzone.classList.remove('dragover');
    });
  });

  els.dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files.length) {
      handleFilePicked(e.dataTransfer.files[0]);
    }
  });

  els.btnRemoveFile.addEventListener('click', removeAudioFile);

  // Notes Input & Ctrl/Cmd+Enter shortcut
  els.notesInput.addEventListener('input', validateInputs);
  els.notesInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!els.btnGenerate.disabled) {
        submitMeeting();
      }
    }
  });

  // Submit button
  els.btnGenerate.addEventListener('click', submitMeeting);

  // Results tabs
  els.resultsTabTicketsBtn.addEventListener('click', () => switchResultsTab('tickets'));
  els.resultsTabTranscriptBtn.addEventListener('click', () => switchResultsTab('transcript'));
}

// ── Initialization ──
document.addEventListener('DOMContentLoaded', () => {
  initElements();
  bindEvents();
  validateInputs();
  refreshHealth();
  loadModelsRegistry();
  setInterval(refreshHealth, 5000);
});

