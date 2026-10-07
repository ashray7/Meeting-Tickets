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
  },
  savedMeetingTickets: [],
  activeMeetingTab: 'tickets',
  currentSavedMeeting: null,
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
  els.selectWhisperMain = document.getElementById('select-whisper-main');

  els.pillLlm = document.getElementById('pill-llm');
  els.pillLlmLabel = document.getElementById('pill-llm-label');
  els.selectLlm = document.getElementById('select-llm');
  els.selectLlmMain = document.getElementById('select-llm-main');

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

  // Sidebar & Layout Navigation
  els.navTranscribe = document.getElementById('nav-transcribe');
  els.navProjects = document.getElementById('nav-projects');
  els.topBarTitle = document.getElementById('top-bar-title');
  els.topBarTranscribeControls = document.getElementById('top-bar-transcribe-controls');
  els.viewTranscribe = document.getElementById('view-transcribe');
  els.viewProjects = document.getElementById('view-projects');
  els.viewProjectDetail = document.getElementById('view-project-detail');
  els.viewMeetingDetail = document.getElementById('view-meeting-detail');

  // Projects View Elements
  els.btnCreateProject = document.getElementById('btn-create-project');
  els.btnCreateProjectEmpty = document.getElementById('btn-create-project-empty');
  els.projectsEmptyState = document.getElementById('projects-empty-state');
  els.projectsListContainer = document.getElementById('projects-list-container');

  // Project Detail Elements
  els.projectDetailTitle = document.getElementById('project-detail-title');
  els.projectDetailDesc = document.getElementById('project-detail-desc');
  els.projectDetailCreated = document.getElementById('project-detail-created');
  els.btnEditCurrentProject = document.getElementById('btn-edit-current-project');
  els.btnDeleteCurrentProject = document.getElementById('btn-delete-current-project');
  els.projectMeetingsList = document.getElementById('project-meetings-list');
  els.projectMeetingsEmpty = document.getElementById('project-meetings-empty');

  // Meeting Detail Elements
  els.meetingBreadcrumbLink = document.getElementById('meeting-breadcrumb-link');
  els.meetingBreadcrumbText = document.getElementById('meeting-breadcrumb-text');
  els.meetingViewTypeBadge = document.getElementById('meeting-view-type-badge');
  els.meetingViewDate = document.getElementById('meeting-view-date');
  els.meetingViewWhisper = document.getElementById('meeting-view-whisper');
  els.meetingViewLlm = document.getElementById('meeting-view-llm');
  els.meetingTabTicketsBtn = document.getElementById('meeting-tab-tickets-btn');
  els.meetingTabTranscriptBtn = document.getElementById('meeting-tab-transcript-btn');
  els.meetingTicketsCountBadge = document.getElementById('meeting-tickets-count-badge');
  els.btnMeetingCopyAll = document.getElementById('btn-meeting-copy-all');
  els.meetingTicketsList = document.getElementById('meeting-tickets-list');
  els.meetingTranscriptCard = document.getElementById('meeting-transcript-card');

  // Project Dialog Elements
  els.projectDialog = document.getElementById('project-dialog');
  els.projectDialogForm = document.getElementById('project-dialog-form');
  els.projectDialogTitle = document.getElementById('project-dialog-title');
  els.projectDialogError = document.getElementById('project-dialog-error');
  els.projectNameInput = document.getElementById('project-name-input');
  els.projectDescInput = document.getElementById('project-desc-input');
  els.btnCloseProjectDialog = document.getElementById('btn-close-project-dialog');
  els.btnCancelProject = document.getElementById('btn-cancel-project');
  els.btnSaveProject = document.getElementById('btn-save-project');
  els.btnSaveProjectText = document.getElementById('btn-save-project-text');

  // Delete Dialog Elements
  els.deleteDialog = document.getElementById('delete-dialog');
  els.btnCloseDeleteDialog = document.getElementById('btn-close-delete-dialog');
  els.btnCancelDelete = document.getElementById('btn-cancel-delete');
  els.btnConfirmDelete = document.getElementById('btn-confirm-delete');
  els.btnConfirmDeleteText = document.getElementById('btn-confirm-delete-text');
  els.deleteProjectName = document.getElementById('delete-project-name');
  els.deleteMeetingsCount = document.getElementById('delete-meetings-count');

  // Transcribe Project Selector Elements
  els.selectProject = document.getElementById('select-project');
  els.projectDropdownContainer = document.getElementById('project-dropdown-container');
  els.projectEmptyAlert = document.getElementById('project-empty-alert');
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

// ── Hash Routing ──
function handleRoute() {
  const hash = window.location.hash || '#/transcribe';

  // Highlight navigation item (Projects remains active for any project sub-route)
  const isProjects = hash.startsWith('#/projects');
  if (els.navTranscribe) els.navTranscribe.classList.toggle('active', !isProjects);
  if (els.navProjects) els.navProjects.classList.toggle('active', isProjects);

  // Top-bar controls (model pills, status, diagnostics) are only shown on Transcribe view
  if (els.topBarTranscribeControls) {
    els.topBarTranscribeControls.style.display = !isProjects ? 'flex' : 'none';
  }

  // Hide all page views
  [els.viewTranscribe, els.viewProjects, els.viewProjectDetail, els.viewMeetingDetail].forEach(v => {
    if (v) v.style.display = 'none';
  });

  if (hash === '' || hash === '#' || hash === '#/transcribe') {
    if (window.location.hash !== '#/transcribe') {
      window.location.replace('#/transcribe');
      return;
    }
    if (els.topBarTitle) els.topBarTitle.textContent = 'Transcribe';
    if (els.viewTranscribe) els.viewTranscribe.style.display = 'flex';
  } else if (hash === '#/projects') {
    if (els.topBarTitle) els.topBarTitle.textContent = 'Projects';
    if (els.viewProjects) els.viewProjects.style.display = 'flex';
    loadProjects();
  } else if (hash.match(/^#\/projects\/(\d+)$/)) {
    const match = hash.match(/^#\/projects\/(\d+)$/);
    if (els.topBarTitle) els.topBarTitle.textContent = 'Project Detail';
    if (els.viewProjectDetail) els.viewProjectDetail.style.display = 'flex';
    loadProjectDetail(match[1]);
  } else if (hash.match(/^#\/projects\/(\d+)\/meetings\/(\d+)$/)) {
    const match = hash.match(/^#\/projects\/(\d+)\/meetings\/(\d+)$/);
    if (els.topBarTitle) els.topBarTitle.textContent = 'Meeting';
    if (els.viewMeetingDetail) els.viewMeetingDetail.style.display = 'flex';
    loadMeetingDetail(match[1], match[2]);
  } else {
    // Unknown route -> redirect to #/transcribe
    window.location.replace('#/transcribe');
  }
}

// ── Date Formatting ──
function formatLocalTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Projects CRUD & List ──
async function loadProjects() {
  try {
    const res = await fetch('/api/projects');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const projects = await res.json();
    state.projects = projects;
    renderProjectsList(projects);
    populateProjectDropdown(projects);
  } catch (err) {
    appendLog(`Failed to load projects: ${err.message}`);
  }
}

function populateProjectDropdown(projects) {
  if (!els.selectProject || !els.projectDropdownContainer || !els.projectEmptyAlert) return;

  const currentVal = els.selectProject.value;
  if (!projects || projects.length === 0) {
    els.projectDropdownContainer.style.display = 'none';
    els.projectEmptyAlert.style.display = 'flex';
    els.selectProject.innerHTML = '<option value="" disabled selected>No projects available</option>';
  } else {
    els.projectEmptyAlert.style.display = 'none';
    els.projectDropdownContainer.style.display = 'flex';
    els.selectProject.innerHTML = '<option value="" disabled selected>Select a project...</option>';
    projects.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      if (String(p.id) === String(currentVal)) {
        opt.selected = true;
      }
      els.selectProject.appendChild(opt);
    });
  }
  validateInputs();
}

function renderProjectsList(projects) {
  if (!els.projectsListContainer || !els.projectsEmptyState) return;

  if (!projects || projects.length === 0) {
    els.projectsEmptyState.style.display = 'block';
    els.projectsListContainer.style.display = 'none';
    els.projectsListContainer.innerHTML = '';
    return;
  }

  els.projectsEmptyState.style.display = 'none';
  els.projectsListContainer.style.display = 'flex';
  els.projectsListContainer.innerHTML = '';

  projects.forEach(p => {
    const card = document.createElement('div');
    card.className = 'project-card';

    const countText = `${p.meeting_count || 0} meeting${p.meeting_count === 1 ? '' : 's'}`;
    const dateText = `Created ${formatLocalTime(p.created_at)}`;

    card.innerHTML = `
      <div class="project-card-main">
        <div class="project-card-title-row">
          <a href="#/projects/${p.id}" class="project-card-title">${escapeHtml(p.name)}</a>
          <span class="badge-count">${countText}</span>
        </div>
        ${p.description ? `<p class="project-card-desc">${escapeHtml(p.description)}</p>` : ''}
        <div class="project-card-meta">${dateText}</div>
      </div>
      <div class="project-card-actions">
        <button class="btn-icon-action edit" type="button" title="Edit project" aria-label="Edit project ${escapeHtml(p.name)}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
        </button>
        <button class="btn-icon-action delete" type="button" title="Delete project" aria-label="Delete project ${escapeHtml(p.name)}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    `;

    card.querySelector('.btn-icon-action.edit').addEventListener('click', (e) => {
      e.stopPropagation();
      openProjectDialog(p);
    });

    card.querySelector('.btn-icon-action.delete').addEventListener('click', (e) => {
      e.stopPropagation();
      openDeleteDialog(p);
    });

    els.projectsListContainer.appendChild(card);
  });
}

// ── Project Detail & Meetings ──
async function loadProjectDetail(projectId) {
  try {
    const res = await fetch(`/api/projects/${projectId}`);
    if (!res.ok) {
      if (res.status === 404) {
        alert('Project not found');
        window.location.hash = '#/projects';
        return;
      }
      throw new Error(`HTTP ${res.status}`);
    }
    const project = await res.json();
    state.currentProject = project;

    if (els.topBarTitle) els.topBarTitle.textContent = project.name;
    if (els.projectDetailTitle) els.projectDetailTitle.textContent = project.name;
    if (els.projectDetailDesc) {
      els.projectDetailDesc.textContent = project.description || 'No description provided.';
      els.projectDetailDesc.style.color = project.description ? 'var(--text-muted)' : 'var(--text-subtle)';
    }
    if (els.projectDetailCreated) {
      els.projectDetailCreated.textContent = `Created ${formatLocalTime(project.created_at)} • ${project.meeting_count || 0} saved meetings`;
    }

    await loadProjectMeetings(projectId);
  } catch (err) {
    appendLog(`Failed to load project ${projectId}: ${err.message}`);
  }
}

async function loadProjectMeetings(projectId) {
  if (!els.projectMeetingsList || !els.projectMeetingsEmpty) return;
  try {
    const res = await fetch(`/api/projects/${projectId}/meetings`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const meetings = await res.json();
    renderProjectMeetings(projectId, meetings);
  } catch (err) {
    appendLog(`Failed to load meetings for project ${projectId}: ${err.message}`);
  }
}

function renderProjectMeetings(projectId, meetings) {
  if (!els.projectMeetingsList || !els.projectMeetingsEmpty) return;

  if (!meetings || meetings.length === 0) {
    els.projectMeetingsList.style.display = 'none';
    els.projectMeetingsEmpty.style.display = 'block';
    els.projectMeetingsList.innerHTML = '';
    return;
  }

  els.projectMeetingsEmpty.style.display = 'none';
  els.projectMeetingsList.style.display = 'flex';
  els.projectMeetingsList.innerHTML = '';

  meetings.forEach(m => {
    const row = document.createElement('a');
    row.href = `#/projects/${projectId}/meetings/${m.id}`;
    row.className = 'meeting-row-card';

    const isAudio = m.input_type === 'audio';
    const typeLabel = isAudio ? 'Audio' : 'Notes';
    const typeClass = isAudio ? 'type-audio' : 'type-notes';
    const modelsStr = `${m.whisper_model || 'whisper'} • ${m.llm_model || 'llm'}`;
    const ticketsStr = `${m.ticket_count || 0} ticket${m.ticket_count === 1 ? '' : 's'}`;
    const dateStr = formatLocalTime(m.created_at);

    row.innerHTML = `
      <div class="meeting-row-top">
        <div class="meeting-row-meta">
          <span class="badge ${typeClass}">${typeLabel}</span>
          <span class="meeting-row-date">${dateStr}</span>
        </div>
        <div class="meeting-row-badges">
          <span class="meeting-models-pill">${escapeHtml(modelsStr)}</span>
          <span class="badge-count">${ticketsStr}</span>
        </div>
      </div>
      <div class="meeting-row-snippet">${escapeHtml(m.transcript_snippet || 'No transcript')}</div>
    `;

    els.projectMeetingsList.appendChild(row);
  });
}

// ── Meeting Detail (Read-only View) ──
async function loadMeetingDetail(projectId, meetingId) {
  try {
    const res = await fetch(`/api/meetings/${meetingId}`);
    if (!res.ok) {
      if (res.status === 404) {
        alert('Meeting not found');
        window.location.hash = `#/projects/${projectId}`;
        return;
      }
      throw new Error(`HTTP ${res.status}`);
    }
    const meeting = await res.json();
    state.currentSavedMeeting = meeting;

    // Breadcrumb
    if (els.meetingBreadcrumbLink) {
      els.meetingBreadcrumbLink.href = `#/projects/${projectId}`;
    }
    if (els.meetingBreadcrumbText) {
      els.meetingBreadcrumbText.textContent = `Back to ${meeting.project_name || 'Project'}`;
    }

    // Top Bar title
    if (els.topBarTitle) {
      els.topBarTitle.textContent = `${meeting.project_name || 'Project'} • Meeting`;
    }

    // Header card metadata
    if (els.meetingViewDate) {
      els.meetingViewDate.textContent = formatLocalTime(meeting.created_at);
    }
    if (els.meetingViewTypeBadge) {
      const isAudio = meeting.input_type === 'audio';
      els.meetingViewTypeBadge.textContent = isAudio ? 'Audio' : 'Notes';
      els.meetingViewTypeBadge.className = `badge ${isAudio ? 'type-audio' : 'type-notes'}`;
    }
    if (els.meetingViewWhisper) {
      els.meetingViewWhisper.textContent = meeting.whisper_model || 'whisper';
    }
    if (els.meetingViewLlm) {
      els.meetingViewLlm.textContent = meeting.llm_model || 'llm';
    }

    // Render tickets
    renderSavedMeetingTickets(meeting.tickets || []);

    // Set transcript
    if (els.meetingTranscriptCard) {
      els.meetingTranscriptCard.textContent = meeting.transcript || 'No transcript available.';
    }

    // Default to tickets tab
    switchMeetingTab('tickets');
  } catch (err) {
    appendLog(`Failed to load meeting ${meetingId}: ${err.message}`);
  }
}

function switchMeetingTab(tab) {
  state.activeMeetingTab = tab;
  if (els.meetingTabTicketsBtn) els.meetingTabTicketsBtn.classList.toggle('active', tab === 'tickets');
  if (els.meetingTabTranscriptBtn) els.meetingTabTranscriptBtn.classList.toggle('active', tab === 'transcript');
  if (tab === 'tickets') {
    if (els.meetingTicketsList) els.meetingTicketsList.style.display = 'flex';
    if (els.meetingTranscriptCard) els.meetingTranscriptCard.style.display = 'none';
  } else {
    if (els.meetingTicketsList) els.meetingTicketsList.style.display = 'none';
    if (els.meetingTranscriptCard) els.meetingTranscriptCard.style.display = 'block';
  }
}

function renderSavedMeetingTickets(tickets) {
  state.savedMeetingTickets = tickets || [];
  if (els.meetingTicketsCountBadge) {
    els.meetingTicketsCountBadge.textContent = state.savedMeetingTickets.length;
  }
  if (!els.meetingTicketsList) return;
  els.meetingTicketsList.innerHTML = '';

  state.savedMeetingTickets.forEach((t, i) => {
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
        <button class="btn-copy-ticket" type="button">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <span>Copy</span>
        </button>
      </div>
    `;

    const copyBtn = card.querySelector('.btn-copy-ticket');
    copyBtn.addEventListener('click', () => copySingleSavedTicket(i, copyBtn));

    els.meetingTicketsList.appendChild(card);
  });
}

async function copySingleSavedTicket(index, btn) {
  const t = state.savedMeetingTickets[index];
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

async function copyAllSavedTickets() {
  if (!state.savedMeetingTickets.length) return;
  const fullMd = state.savedMeetingTickets.map(formatTicketMd).join('\n\n---\n\n');
  await navigator.clipboard.writeText(fullMd);
  appendLog('Copied all tickets formatted in Markdown');
  alert('All tickets copied to clipboard as Markdown!');
}

// ── Add / Edit Project Dialog ──
function openProjectDialog(projectToEdit = null) {
  state.editingProjectId = projectToEdit ? projectToEdit.id : null;
  if (els.projectDialogError) {
    els.projectDialogError.style.display = 'none';
    els.projectDialogError.textContent = '';
  }

  if (projectToEdit) {
    els.projectDialogTitle.textContent = 'Edit project';
    els.btnSaveProjectText.textContent = 'Save changes';
    els.projectNameInput.value = projectToEdit.name || '';
    els.projectDescInput.value = projectToEdit.description || '';
  } else {
    els.projectDialogTitle.textContent = 'New project';
    els.btnSaveProjectText.textContent = 'Create project';
    els.projectNameInput.value = '';
    els.projectDescInput.value = '';
  }

  els.projectDialog.showModal();
  setTimeout(() => els.projectNameInput.focus(), 50);
}

function closeProjectDialog() {
  els.projectDialog.close();
}

async function handleSaveProject(e) {
  e.preventDefault();
  const name = (els.projectNameInput.value || '').trim();
  const description = (els.projectDescInput.value || '').trim();

  if (!name) {
    showProjectDialogError('Project name is required.');
    els.projectNameInput.focus();
    return;
  }
  if (name.length > 100) {
    showProjectDialogError('Project name cannot exceed 100 characters.');
    return;
  }
  if (description.length > 500) {
    showProjectDialogError('Description cannot exceed 500 characters.');
    return;
  }

  els.btnSaveProject.disabled = true;
  els.btnSaveProjectText.textContent = 'Saving...';

  try {
    const isEdit = state.editingProjectId != null;
    const url = isEdit ? `/api/projects/${state.editingProjectId}` : '/api/projects';
    const method = isEdit ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || 'Failed to save project');
    }

    appendLog(`Project ${isEdit ? 'updated' : 'created'}: ${data.name}`);
    closeProjectDialog();

    // Refresh UI without full page reload
    if (window.location.hash.startsWith('#/projects/')) {
      const match = window.location.hash.match(/^#\/projects\/(\d+)$/);
      if (match) loadProjectDetail(match[1]);
    }
    loadProjects();
  } catch (err) {
    showProjectDialogError(err.message);
  } finally {
    els.btnSaveProject.disabled = false;
    els.btnSaveProjectText.textContent = state.editingProjectId ? 'Save changes' : 'Create project';
  }
}

function showProjectDialogError(msg) {
  if (els.projectDialogError) {
    els.projectDialogError.textContent = msg;
    els.projectDialogError.style.display = 'block';
  }
}

// ── Delete Project Dialog ──
function openDeleteDialog(project) {
  state.deletingProject = project;
  if (els.deleteProjectName) els.deleteProjectName.textContent = project.name;
  if (els.deleteMeetingsCount) els.deleteMeetingsCount.textContent = project.meeting_count || 0;
  els.deleteDialog.showModal();
}

function closeDeleteDialog() {
  els.deleteDialog.close();
}

async function handleConfirmDelete() {
  if (!state.deletingProject) return;
  els.btnConfirmDelete.disabled = true;
  els.btnConfirmDeleteText.textContent = 'Deleting...';

  try {
    const res = await fetch(`/api/projects/${state.deletingProject.id}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.detail || 'Failed to delete project');
    }

    appendLog(`Deleted project ${state.deletingProject.name} (id: ${state.deletingProject.id})`);
    closeDeleteDialog();

    // If currently on deleted project's detail page, return to projects list
    if (window.location.hash === `#/projects/${state.deletingProject.id}`) {
      window.location.hash = '#/projects';
    } else {
      loadProjects();
    }
  } catch (err) {
    alert(`Could not delete project: ${err.message}`);
  } finally {
    els.btnConfirmDelete.disabled = false;
    els.btnConfirmDeleteText.textContent = 'Delete project';
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
    if (els.selectWhisperMain) populateSelect(els.selectWhisperMain, state.models.whisper, data.loaded_whisper);
    populateSelect(els.selectLlm, state.models.llm, data.loaded_llm, els.pillLlmLabel);
    if (els.selectLlmMain) populateSelect(els.selectLlmMain, state.models.llm, data.loaded_llm);
  } catch (err) {
    appendLog(`Failed to fetch models: ${err.message}`);
  }
}

function populateSelect(selectEl, modelList, loadedId, labelEl = null) {
  if (!selectEl) return;
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

async function onModelSelect(type, targetModelId = null) {
  const isWhisper = type === 'whisper';
  const selectPill = isWhisper ? els.selectWhisper : els.selectLlm;
  const selectMain = isWhisper ? els.selectWhisperMain : els.selectLlmMain;
  const pillEl = isWhisper ? els.pillWhisper : els.pillLlm;
  const labelEl = isWhisper ? els.pillWhisperLabel : els.pillLlmLabel;
  
  const modelId = targetModelId || (selectMain ? selectMain.value : (selectPill ? selectPill.value : null));
  const prevId = isWhisper ? state.models.loadedWhisper : state.models.loadedLlm;
  if (!modelId || modelId === prevId) return;

  // Keep both dropdowns in sync
  if (selectPill) selectPill.value = modelId;
  if (selectMain) selectMain.value = modelId;

  // Show switching state
  if (selectPill) selectPill.disabled = true;
  if (selectMain) selectMain.disabled = true;
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
    if (chosen && labelEl) labelEl.textContent = chosen.name;
    if (selectPill) selectPill.value = modelId;
    if (selectMain) selectMain.value = modelId;
  } catch (err) {
    appendLog(`Model switch failed: ${err.message}`);
    showErrorCard(`Model Switch (${type})`, err.message);
    if (selectPill) selectPill.value = prevId;
    if (selectMain) selectMain.value = prevId;
    labelEl.textContent = prevLabel;
  } finally {
    if (selectPill) selectPill.disabled = false;
    if (selectMain) selectMain.disabled = false;
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
  let hasValidInput = false;
  if (state.activeInputTab === 'audio') {
    hasValidInput = !!state.selectedAudioFile;
  } else {
    hasValidInput = els.notesInput.value.trim().length > 0;
  }
  const hasProject = !!(els.selectProject && els.selectProject.value);
  const isModelSwitching = els.pillWhisper.classList.contains('switching') || els.pillLlm.classList.contains('switching');

  els.btnGenerate.disabled = !hasValidInput || !hasProject || isModelSwitching;

  if (els.startStatusText) {
    if (!hasProject) {
      els.startStatusText.textContent = (!state.projects || state.projects.length === 0)
        ? 'Create a project first to enable generation'
        : 'Select a project to enable ticket generation';
    } else if (!hasValidInput) {
      els.startStatusText.textContent = state.activeInputTab === 'audio'
        ? 'Select an audio file'
        : 'Enter meeting notes';
    } else {
      els.startStatusText.textContent = 'Ready to extract actionable tickets';
    }
  }
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

  const selectedProjId = els.selectProject ? els.selectProject.value : '';
  if (!selectedProjId) {
    showErrorCard('Input Validation', 'Please select a project before generating tickets.');
    return;
  }
  formData.append('project_id', selectedProjId);

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

          if (data.save_error) {
            appendLog(`Storage warning: ${data.save_error}`);
            showErrorCard('Database Storage', `Tickets were extracted, but could not be saved to project: ${data.save_error}`);
          }
          if (data.meeting_id) {
            appendLog(`Meeting successfully saved to database with ID: ${data.meeting_id}`);
            loadProjects();
          }

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

  // Model Select changes (top pill and start screen dropdowns)
  els.selectWhisper.addEventListener('change', () => onModelSelect('whisper', els.selectWhisper.value));
  if (els.selectWhisperMain) {
    els.selectWhisperMain.addEventListener('change', () => onModelSelect('whisper', els.selectWhisperMain.value));
  }
  els.selectLlm.addEventListener('change', () => onModelSelect('llm', els.selectLlm.value));
  if (els.selectLlmMain) {
    els.selectLlmMain.addEventListener('change', () => onModelSelect('llm', els.selectLlmMain.value));
  }

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

  // Project actions
  if (els.btnCreateProject) {
    els.btnCreateProject.addEventListener('click', () => openProjectDialog());
  }
  if (els.btnCreateProjectEmpty) {
    els.btnCreateProjectEmpty.addEventListener('click', () => openProjectDialog());
  }
  if (els.btnCloseProjectDialog) {
    els.btnCloseProjectDialog.addEventListener('click', closeProjectDialog);
  }
  if (els.btnCancelProject) {
    els.btnCancelProject.addEventListener('click', closeProjectDialog);
  }
  if (els.projectDialogForm) {
    els.projectDialogForm.addEventListener('submit', handleSaveProject);
  }
  if (els.projectDialog) {
    els.projectDialog.addEventListener('click', (e) => {
      if (e.target === els.projectDialog) closeProjectDialog();
    });
  }

  // Project Detail action buttons
  if (els.btnEditCurrentProject) {
    els.btnEditCurrentProject.addEventListener('click', () => {
      if (state.currentProject) openProjectDialog(state.currentProject);
    });
  }
  if (els.btnDeleteCurrentProject) {
    els.btnDeleteCurrentProject.addEventListener('click', () => {
      if (state.currentProject) openDeleteDialog(state.currentProject);
    });
  }

  // Delete Dialog events
  if (els.btnCloseDeleteDialog) {
    els.btnCloseDeleteDialog.addEventListener('click', closeDeleteDialog);
  }
  if (els.btnCancelDelete) {
    els.btnCancelDelete.addEventListener('click', closeDeleteDialog);
  }
  if (els.btnConfirmDelete) {
    els.btnConfirmDelete.addEventListener('click', handleConfirmDelete);
  }
  if (els.deleteDialog) {
    els.deleteDialog.addEventListener('click', (e) => {
      if (e.target === els.deleteDialog) closeDeleteDialog();
    });
  }

  // Project select dropdown change
  if (els.selectProject) {
    els.selectProject.addEventListener('change', validateInputs);
  }

  // Meeting detail view tabs and copy-all
  if (els.meetingTabTicketsBtn) {
    els.meetingTabTicketsBtn.addEventListener('click', () => switchMeetingTab('tickets'));
  }
  if (els.meetingTabTranscriptBtn) {
    els.meetingTabTranscriptBtn.addEventListener('click', () => switchMeetingTab('transcript'));
  }
  if (els.btnMeetingCopyAll) {
    els.btnMeetingCopyAll.addEventListener('click', copyAllSavedTickets);
  }

  // Hash routing listener
  window.addEventListener('hashchange', handleRoute);
}

// ── Initialization ──
document.addEventListener('DOMContentLoaded', () => {
  initElements();
  bindEvents();
  handleRoute();
  loadProjects();
  validateInputs();
  refreshHealth();
  loadModelsRegistry();
  setInterval(refreshHealth, 5000);
});

