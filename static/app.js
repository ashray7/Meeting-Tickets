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
  transcribeAudioUrl: null,
  departments: [],
  teamMembers: [],
  editingDepartment: null,
  deletingDepartment: null,
  editingTeamMember: null,
  deletingTeamMember: null,
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

  // Transcribe Audio Player Elements
  els.transcribeAudioWrapper = document.getElementById('transcribe-audio-wrapper');
  els.transcribeAudioPlayer = document.getElementById('transcribe-audio-player');
  els.transcribeAudioUnsupported = document.getElementById('transcribe-audio-unsupported');

  els.drawerBackdrop = document.getElementById('drawer-backdrop');
  els.drawer = document.getElementById('drawer');
  els.btnCloseDrawer = document.getElementById('drawer-close-btn');
  els.drawerLogs = document.getElementById('drawer-logs');
  els.btnDownloadLog = document.getElementById('btn-download-log');

  // Sidebar & Layout Navigation
  els.navTranscribe = document.getElementById('nav-transcribe');
  els.navProjects = document.getElementById('nav-projects');
  els.navDepartments = document.getElementById('nav-departments');
  els.navTeam = document.getElementById('nav-team');
  els.topBarTitle = document.getElementById('top-bar-title');
  els.topBarTranscribeControls = document.getElementById('top-bar-transcribe-controls');
  els.viewTranscribe = document.getElementById('view-transcribe');
  els.viewProjects = document.getElementById('view-projects');
  els.viewProjectDetail = document.getElementById('view-project-detail');
  els.viewMeetingDetail = document.getElementById('view-meeting-detail');
  els.viewDepartments = document.getElementById('view-departments');
  els.viewTeam = document.getElementById('view-team');

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

  // Saved Meeting Audio Player Elements
  els.meetingAudioWrapper = document.getElementById('meeting-audio-wrapper');
  els.meetingAudioPlayer = document.getElementById('meeting-audio-player');
  els.meetingAudioUnsupported = document.getElementById('meeting-audio-unsupported');

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

  // Departments View Elements
  els.btnCreateDepartment = document.getElementById('btn-create-department');
  els.btnCreateDepartmentEmpty = document.getElementById('btn-create-department-empty');
  els.departmentsEmptyState = document.getElementById('departments-empty-state');
  els.departmentsListContainer = document.getElementById('departments-list-container');

  // Department Dialog Elements
  els.departmentDialog = document.getElementById('department-dialog');
  els.departmentDialogForm = document.getElementById('department-dialog-form');
  els.deptDialogTitle = document.getElementById('dept-dialog-title');
  els.deptDialogError = document.getElementById('dept-dialog-error');
  els.deptNameInput = document.getElementById('dept-name-input');
  els.btnCloseDeptDialog = document.getElementById('btn-close-dept-dialog');
  els.btnCancelDept = document.getElementById('btn-cancel-dept');
  els.btnSaveDept = document.getElementById('btn-save-dept');
  els.btnSaveDeptText = document.getElementById('btn-save-dept-text');

  // Delete Department Dialog Elements
  els.deleteDepartmentDialog = document.getElementById('delete-department-dialog');
  els.btnCloseDeleteDeptDialog = document.getElementById('btn-close-delete-dept-dialog');
  els.btnCancelDeleteDept = document.getElementById('btn-cancel-delete-dept');
  els.btnConfirmDeleteDept = document.getElementById('btn-confirm-delete-dept');
  els.btnConfirmDeleteDeptText = document.getElementById('btn-confirm-delete-dept-text');
  els.deleteDeptBlockedBox = document.getElementById('delete-dept-blocked-box');
  els.deleteDeptConfirmBox = document.getElementById('delete-dept-confirm-box');
  els.deleteDeptBlockedName = document.getElementById('delete-dept-blocked-name');
  els.deleteDeptName = document.getElementById('delete-dept-name');
  els.deleteDeptMemberCount = document.getElementById('delete-dept-member-count');

  // Team Members View Elements
  els.btnCreateTeamMember = document.getElementById('btn-create-team-member');
  els.btnCreateMemberEmpty = document.getElementById('btn-create-member-empty');
  els.teamEmptyNoDepts = document.getElementById('team-empty-no-depts');
  els.teamEmptyState = document.getElementById('team-empty-state');
  els.teamMembersListContainer = document.getElementById('team-members-list-container');

  // Team Member Dialog Elements
  els.teamMemberDialog = document.getElementById('team-member-dialog');
  els.teamMemberDialogForm = document.getElementById('team-member-dialog-form');
  els.teamMemberDialogTitle = document.getElementById('team-member-dialog-title');
  els.teamMemberDialogError = document.getElementById('team-member-dialog-error');
  els.teamMemberNameInput = document.getElementById('team-member-name-input');
  els.teamMemberDeptSelect = document.getElementById('team-member-dept-select');
  els.btnCloseTeamMemberDialog = document.getElementById('btn-close-team-member-dialog');
  els.btnCancelTeamMember = document.getElementById('btn-cancel-team-member');
  els.btnSaveTeamMember = document.getElementById('btn-save-team-member');
  els.btnSaveTeamMemberText = document.getElementById('btn-save-team-member-text');

  // Delete Team Member Dialog Elements
  els.deleteTeamMemberDialog = document.getElementById('delete-team-member-dialog');
  els.btnCloseDeleteMemberDialog = document.getElementById('btn-close-delete-member-dialog');
  els.btnCancelDeleteMember = document.getElementById('btn-cancel-delete-member');
  els.btnConfirmDeleteMember = document.getElementById('btn-confirm-delete-member');
  els.btnConfirmDeleteMemberText = document.getElementById('btn-confirm-delete-member-text');
  els.deleteMemberName = document.getElementById('delete-member-name');
  els.deleteMemberTicketsWarning = document.getElementById('delete-member-tickets-warning');

  // Transcribe Project Selector Elements
  els.selectProject = document.getElementById('select-project');
  els.projectDropdownContainer = document.getElementById('project-dropdown-container');
  els.projectEmptyAlert = document.getElementById('project-empty-alert');
}

// ── Transcribe Audio Playback ──
function setupTranscribeAudio(file) {
  cleanupTranscribeAudio();
  if (!file || !els.transcribeAudioWrapper || !els.transcribeAudioPlayer) return;

  els.transcribeAudioWrapper.style.display = 'block';
  els.transcribeAudioPlayer.style.display = 'block';
  if (els.transcribeAudioUnsupported) {
    els.transcribeAudioUnsupported.style.display = 'none';
  }

  // Check if browser definitively doesn't support the file MIME type
  if (file.type && els.transcribeAudioPlayer.canPlayType && els.transcribeAudioPlayer.canPlayType(file.type) === '') {
    els.transcribeAudioPlayer.style.display = 'none';
    if (els.transcribeAudioUnsupported) {
      els.transcribeAudioUnsupported.style.display = 'flex';
    }
    return;
  }

  try {
    state.transcribeAudioUrl = URL.createObjectURL(file);
    els.transcribeAudioPlayer.src = state.transcribeAudioUrl;
    els.transcribeAudioPlayer.load();
  } catch (err) {
    els.transcribeAudioPlayer.style.display = 'none';
    if (els.transcribeAudioUnsupported) {
      els.transcribeAudioUnsupported.style.display = 'flex';
    }
  }
}

function cleanupTranscribeAudio() {
  if (els.transcribeAudioPlayer) {
    els.transcribeAudioPlayer.pause();
    els.transcribeAudioPlayer.removeAttribute('src');
    els.transcribeAudioPlayer.load();
    els.transcribeAudioPlayer.style.display = 'block';
  }
  if (state.transcribeAudioUrl) {
    URL.revokeObjectURL(state.transcribeAudioUrl);
    state.transcribeAudioUrl = null;
  }
  if (els.transcribeAudioWrapper) {
    els.transcribeAudioWrapper.style.display = 'none';
  }
  if (els.transcribeAudioUnsupported) {
    els.transcribeAudioUnsupported.style.display = 'none';
  }
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
    cleanupTranscribeAudio();
  } else if (viewName === 'processing') {
    els.stateProcessing.classList.add('active');
    els.btnNewMeeting.style.display = 'none';
  } else if (viewName === 'results') {
    els.stateResults.classList.add('active');
    els.btnNewMeeting.style.display = 'inline-flex';
    if (state.activeInputTab !== 'audio') {
      cleanupTranscribeAudio();
    }
  }
}

// ── Hash Routing ──
function handleRoute() {
  const hash = window.location.hash || '#/transcribe';

  const isProjects = hash.startsWith('#/projects');
  const isDepartments = hash === '#/departments';
  const isTeam = hash === '#/team';
  const isTranscribe = !isProjects && !isDepartments && !isTeam && (hash === '' || hash === '#' || hash === '#/transcribe');

  if (els.navTranscribe) els.navTranscribe.classList.toggle('active', isTranscribe);
  if (els.navProjects) els.navProjects.classList.toggle('active', isProjects);
  if (els.navDepartments) els.navDepartments.classList.toggle('active', isDepartments);
  if (els.navTeam) els.navTeam.classList.toggle('active', isTeam);

  if (isProjects || isDepartments || isTeam) {
    cleanupTranscribeAudio();
  }

  const isMeetingDetail = Boolean(hash.match(/^#\/projects\/(\d+)\/meetings\/(\d+)$/));
  if (!isMeetingDetail) {
    cleanupMeetingAudio();
  }

  // Top-bar controls (model pills, status, diagnostics) are only shown on Transcribe view
  if (els.topBarTranscribeControls) {
    els.topBarTranscribeControls.style.display = isTranscribe ? 'flex' : 'none';
  }

  // Hide all page views
  [els.viewTranscribe, els.viewProjects, els.viewProjectDetail, els.viewMeetingDetail, els.viewDepartments, els.viewTeam].forEach(v => {
    if (v) v.style.display = 'none';
  });

  if (isTranscribe) {
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
  } else if (hash === '#/departments') {
    if (els.topBarTitle) els.topBarTitle.textContent = 'Departments';
    if (els.viewDepartments) els.viewDepartments.style.display = 'flex';
    loadDepartmentsView();
  } else if (hash === '#/team') {
    if (els.topBarTitle) els.topBarTitle.textContent = 'Team members';
    if (els.viewTeam) els.viewTeam.style.display = 'flex';
    loadTeamMembersView();
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

    card.addEventListener('click', (e) => {
      if (e.target.closest('.project-card-actions')) return;
      window.location.hash = `#/projects/${p.id}`;
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

    // Saved audio player
    if (meeting.has_audio) {
      if (els.meetingAudioWrapper) els.meetingAudioWrapper.style.display = 'block';
      if (els.meetingAudioPlayer) {
        els.meetingAudioPlayer.style.display = 'block';
        els.meetingAudioPlayer.src = `/api/meetings/${meetingId}/audio`;
        els.meetingAudioPlayer.load();
      }
      if (els.meetingAudioUnsupported) {
        els.meetingAudioUnsupported.style.display = 'none';
      }
    } else {
      cleanupMeetingAudio();
    }

    // Default to tickets tab
    switchMeetingTab('tickets');
  } catch (err) {
    appendLog(`Failed to load meeting ${meetingId}: ${err.message}`);
  }
}

function cleanupMeetingAudio() {
  if (els.meetingAudioPlayer) {
    els.meetingAudioPlayer.pause();
    els.meetingAudioPlayer.removeAttribute('src');
    els.meetingAudioPlayer.load();
    els.meetingAudioPlayer.style.display = 'block';
  }
  if (els.meetingAudioWrapper) {
    els.meetingAudioWrapper.style.display = 'none';
  }
  if (els.meetingAudioUnsupported) {
    els.meetingAudioUnsupported.style.display = 'none';
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
    const card = createTicketCard(t, {
      context: 'saved',
      onUpdate: (updatedTicket) => {
        state.savedMeetingTickets[i] = updatedTicket;
      }
    });
    els.meetingTicketsList.appendChild(card);
  });
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

// ── Departments View & Management ──
async function loadDepartmentsView() {
  try {
    const res = await fetch('/api/departments');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const departments = await res.json();
    state.departments = departments;
    renderDepartmentsList(departments);
  } catch (err) {
    appendLog(`Failed to load departments: ${err.message}`);
  }
}

function renderDepartmentsList(departments) {
  if (!els.departmentsListContainer || !els.departmentsEmptyState) return;

  if (!departments || departments.length === 0) {
    els.departmentsEmptyState.style.display = 'block';
    els.departmentsListContainer.style.display = 'none';
    els.departmentsListContainer.innerHTML = '';
    return;
  }

  els.departmentsEmptyState.style.display = 'none';
  els.departmentsListContainer.style.display = 'flex';
  els.departmentsListContainer.innerHTML = '';

  departments.forEach(dept => {
    const card = document.createElement('div');
    card.className = 'department-card';

    const memberCount = dept.member_count || (dept.members ? dept.members.length : 0);
    const countText = `${memberCount} member${memberCount === 1 ? '' : 's'}`;

    let chipsHtml = '';
    if (dept.members && dept.members.length > 0) {
      chipsHtml = dept.members.map(m => `
        <span class="dept-member-chip">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
          <span>${escapeHtml(m.name)}</span>
        </span>
      `).join('');
    } else {
      chipsHtml = '<span class="dept-empty-chips">No members yet</span>';
    }

    card.innerHTML = `
      <div class="department-card-header">
        <div class="department-card-title-group">
          <span class="department-card-title">${escapeHtml(dept.name)}</span>
          <span class="badge-count">${countText}</span>
        </div>
        <div class="department-card-actions">
          <button class="btn-secondary btn-sm btn-dept-add-member" type="button" title="Add member to ${escapeHtml(dept.name)}" aria-label="Add member to ${escapeHtml(dept.name)}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            <span>Add member</span>
          </button>
          <button class="btn-icon-action edit" type="button" title="Edit department" aria-label="Edit department ${escapeHtml(dept.name)}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          </button>
          <button class="btn-icon-action delete" type="button" title="Delete department" aria-label="Delete department ${escapeHtml(dept.name)}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </div>
      <div class="dept-chips-list">
        ${chipsHtml}
      </div>
    `;

    card.querySelector('.btn-dept-add-member').addEventListener('click', () => {
      openTeamMemberDialog(null);
    });

    card.querySelector('.btn-icon-action.edit').addEventListener('click', () => {
      openDepartmentDialog(dept);
    });

    card.querySelector('.btn-icon-action.delete').addEventListener('click', () => {
      openDeleteDepartmentDialog(dept);
    });

    els.departmentsListContainer.appendChild(card);
  });
}

function openDepartmentDialog(deptToEdit = null) {
  state.editingDepartment = deptToEdit;
  if (els.deptDialogError) {
    els.deptDialogError.style.display = 'none';
    els.deptDialogError.textContent = '';
  }

  if (deptToEdit) {
    els.deptDialogTitle.textContent = 'Edit department';
    els.btnSaveDeptText.textContent = 'Save changes';
    els.deptNameInput.value = deptToEdit.name || '';
  } else {
    els.deptDialogTitle.textContent = 'New department';
    els.btnSaveDeptText.textContent = 'Create department';
    els.deptNameInput.value = '';
  }

  els.departmentDialog.showModal();
  setTimeout(() => els.deptNameInput.focus(), 50);
}

function closeDepartmentDialog() {
  els.departmentDialog.close();
}

function showDeptDialogError(msg) {
  if (els.deptDialogError) {
    els.deptDialogError.textContent = msg;
    els.deptDialogError.style.display = 'block';
  }
}

async function handleSaveDepartment(e) {
  e.preventDefault();
  const name = (els.deptNameInput.value || '').trim();

  if (!name) {
    showDeptDialogError('Department name is required.');
    els.deptNameInput.focus();
    return;
  }
  if (name.length > 60) {
    showDeptDialogError('Department name must be at most 60 characters.');
    return;
  }

  els.btnSaveDept.disabled = true;
  els.btnSaveDeptText.textContent = 'Saving...';

  try {
    const isEdit = state.editingDepartment != null;
    const url = isEdit ? `/api/departments/${state.editingDepartment.id}` : '/api/departments';
    const method = isEdit ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || 'Failed to save department');
    }

    appendLog(`Department ${isEdit ? 'updated' : 'created'}: ${data.name}`);
    closeDepartmentDialog();
    loadDepartmentsView();
  } catch (err) {
    showDeptDialogError(err.message);
  } finally {
    els.btnSaveDept.disabled = false;
    els.btnSaveDeptText.textContent = state.editingDepartment ? 'Save changes' : 'Create department';
  }
}

function openDeleteDepartmentDialog(dept) {
  state.deletingDepartment = dept;
  const memberCount = dept.member_count || (dept.members ? dept.members.length : 0);

  if (memberCount > 0) {
    els.deleteDeptBlockedBox.style.display = 'block';
    els.deleteDeptConfirmBox.style.display = 'none';
    els.deleteDeptBlockedName.textContent = dept.name;
    els.deleteDeptMemberCount.textContent = memberCount;
    els.btnConfirmDeleteDept.style.display = 'none';
    els.btnCancelDeleteDept.textContent = 'Close';
  } else {
    els.deleteDeptBlockedBox.style.display = 'none';
    els.deleteDeptConfirmBox.style.display = 'block';
    els.deleteDeptName.textContent = dept.name;
    els.btnConfirmDeleteDept.style.display = 'inline-flex';
    els.btnCancelDeleteDept.textContent = 'Cancel';
  }

  els.deleteDepartmentDialog.showModal();
}

function closeDeleteDepartmentDialog() {
  els.deleteDepartmentDialog.close();
}

async function handleConfirmDeleteDepartment() {
  if (!state.deletingDepartment) return;
  els.btnConfirmDeleteDept.disabled = true;
  els.btnConfirmDeleteDeptText.textContent = 'Deleting...';

  try {
    const res = await fetch(`/api/departments/${state.deletingDepartment.id}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.detail || 'Failed to delete department');
    }

    appendLog(`Deleted department ${state.deletingDepartment.name} (id: ${state.deletingDepartment.id})`);
    closeDeleteDepartmentDialog();
    loadDepartmentsView();
  } catch (err) {
    alert(`Could not delete department: ${err.message}`);
  } finally {
    els.btnConfirmDeleteDept.disabled = false;
    els.btnConfirmDeleteDeptText.textContent = 'Delete department';
  }
}

// ── Team Members View & Management ──
async function loadTeamMembersView() {
  try {
    const [deptRes, teamRes] = await Promise.all([
      fetch('/api/departments'),
      fetch('/api/team-members')
    ]);
    if (!deptRes.ok) throw new Error(`HTTP ${deptRes.status} loading departments`);
    if (!teamRes.ok) throw new Error(`HTTP ${teamRes.status} loading team members`);

    const departments = await deptRes.json();
    const teamMembers = await teamRes.json();

    state.departments = departments;
    state.teamMembers = teamMembers;

    renderTeamMembersList(departments, teamMembers);
  } catch (err) {
    appendLog(`Failed to load team members: ${err.message}`);
  }
}

function renderTeamMembersList(departments, teamMembers) {
  if (!els.teamMembersListContainer || !els.teamEmptyNoDepts || !els.teamEmptyState) return;

  if (!departments || departments.length === 0) {
    els.teamEmptyNoDepts.style.display = 'block';
    els.teamEmptyState.style.display = 'none';
    els.teamMembersListContainer.style.display = 'none';
    els.teamMembersListContainer.innerHTML = '';
    return;
  }

  els.teamEmptyNoDepts.style.display = 'none';

  if (!teamMembers || teamMembers.length === 0) {
    els.teamEmptyState.style.display = 'block';
    els.teamMembersListContainer.style.display = 'none';
    els.teamMembersListContainer.innerHTML = '';
    return;
  }

  els.teamEmptyState.style.display = 'none';
  els.teamMembersListContainer.style.display = 'flex';
  els.teamMembersListContainer.innerHTML = '';

  teamMembers.forEach(member => {
    const row = document.createElement('div');
    row.className = 'team-member-row';

    row.innerHTML = `
      <div class="team-member-info">
        <span class="team-member-name">${escapeHtml(member.name)}</span>
        <span class="badge-dept">${escapeHtml(member.department_name || '')}</span>
      </div>
      <div class="team-member-actions">
        <button class="btn-icon-action edit" type="button" title="Edit member" aria-label="Edit member ${escapeHtml(member.name)}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
        </button>
        <button class="btn-icon-action delete" type="button" title="Delete member" aria-label="Delete member ${escapeHtml(member.name)}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    `;

    row.querySelector('.btn-icon-action.edit').addEventListener('click', () => {
      openTeamMemberDialog(member);
    });

    row.querySelector('.btn-icon-action.delete').addEventListener('click', () => {
      openDeleteTeamMemberDialog(member);
    });

    els.teamMembersListContainer.appendChild(row);
  });
}

async function ensureDepartmentsLoaded() {
  if (!state.departments || state.departments.length === 0) {
    try {
      const res = await fetch('/api/departments');
      if (res.ok) {
        state.departments = await res.json();
      }
    } catch (err) {
      // ignore
    }
  }
}

async function openTeamMemberDialog(memberToEdit = null) {
  await ensureDepartmentsLoaded();

  state.editingTeamMember = memberToEdit;
  if (els.teamMemberDialogError) {
    els.teamMemberDialogError.style.display = 'none';
    els.teamMemberDialogError.textContent = '';
  }

  // Populate department select
  els.teamMemberDeptSelect.innerHTML = '<option value="" disabled selected>Select a department...</option>';
  (state.departments || []).forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.name;
    els.teamMemberDeptSelect.appendChild(opt);
  });

  if (memberToEdit) {
    els.teamMemberDialogTitle.textContent = 'Edit team member';
    els.btnSaveTeamMemberText.textContent = 'Save changes';
    els.teamMemberNameInput.value = memberToEdit.name || '';
    els.teamMemberDeptSelect.value = String(memberToEdit.department_id);
  } else {
    els.teamMemberDialogTitle.textContent = 'New team member';
    els.btnSaveTeamMemberText.textContent = 'Create member';
    els.teamMemberNameInput.value = '';
    els.teamMemberDeptSelect.value = '';
  }

  els.teamMemberDialog.showModal();
  setTimeout(() => els.teamMemberNameInput.focus(), 50);
}

function closeTeamMemberDialog() {
  els.teamMemberDialog.close();
}

function showMemberDialogError(msg) {
  if (els.teamMemberDialogError) {
    els.teamMemberDialogError.textContent = msg;
    els.teamMemberDialogError.style.display = 'block';
  }
}

async function handleSaveTeamMember(e) {
  e.preventDefault();
  const name = (els.teamMemberNameInput.value || '').trim();
  const deptIdVal = els.teamMemberDeptSelect.value;
  const department_id = parseInt(deptIdVal, 10);

  if (!name) {
    showMemberDialogError('Member name is required.');
    els.teamMemberNameInput.focus();
    return;
  }
  if (name.length > 100) {
    showMemberDialogError('Member name must be at most 100 characters.');
    return;
  }
  if (!deptIdVal || isNaN(department_id)) {
    showMemberDialogError('Please select a department.');
    return;
  }

  els.btnSaveTeamMember.disabled = true;
  els.btnSaveTeamMemberText.textContent = 'Saving...';

  try {
    const isEdit = state.editingTeamMember != null;
    const url = isEdit ? `/api/team-members/${state.editingTeamMember.id}` : '/api/team-members';
    const method = isEdit ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, department_id })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || 'Failed to save team member');
    }

    appendLog(`Team member ${isEdit ? 'updated' : 'created'}: ${data.name}`);
    closeTeamMemberDialog();

    // Reload the appropriate view
    if (window.location.hash === '#/departments') {
      loadDepartmentsView();
    } else {
      loadTeamMembersView();
    }
  } catch (err) {
    showMemberDialogError(err.message);
  } finally {
    els.btnSaveTeamMember.disabled = false;
    els.btnSaveTeamMemberText.textContent = state.editingTeamMember ? 'Save changes' : 'Create member';
  }
}

function openDeleteTeamMemberDialog(member) {
  state.deletingTeamMember = member;
  if (els.deleteMemberName) els.deleteMemberName.textContent = member.name;

  const count = member.assigned_ticket_count || 0;
  if (els.deleteMemberTicketsWarning) {
    if (count > 0) {
      els.deleteMemberTicketsWarning.textContent =
        `This member is currently assigned to ${count} ticket${count === 1 ? '' : 's'}. Deleting them will keep their name on those tickets as not on team.`;
    } else {
      els.deleteMemberTicketsWarning.textContent = 'This member has no assigned tickets.';
    }
  }

  els.deleteTeamMemberDialog.showModal();
}

function closeDeleteTeamMemberDialog() {
  els.deleteTeamMemberDialog.close();
}

async function handleConfirmDeleteTeamMember() {
  if (!state.deletingTeamMember) return;
  els.btnConfirmDeleteMember.disabled = true;
  els.btnConfirmDeleteMemberText.textContent = 'Deleting...';

  try {
    const res = await fetch(`/api/team-members/${state.deletingTeamMember.id}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.detail || 'Failed to delete team member');
    }

    appendLog(`Deleted team member ${state.deletingTeamMember.name} (id: ${state.deletingTeamMember.id})`);
    closeDeleteTeamMemberDialog();

    if (window.location.hash === '#/departments') {
      loadDepartmentsView();
    } else {
      loadTeamMembersView();
    }
  } catch (err) {
    alert(`Could not delete team member: ${err.message}`);
  } finally {
    els.btnConfirmDeleteMember.disabled = false;
    els.btnConfirmDeleteMemberText.textContent = 'Delete member';
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
  if (evt.assignee_matching) details.push(evt.assignee_matching);
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

// ── Ticket Component & Markdown Copy ──

function getAssigneeInfo(assignee) {
  if (!assignee) return null;
  if (typeof assignee === 'string') {
    const trimmed = assignee.trim();
    if (!trimmed) return null;
    return { name: trimmed, on_team: false, department: null, member_id: null };
  }
  if (typeof assignee === 'object') {
    if (!assignee.name || !assignee.name.trim()) return null;
    return {
      name: assignee.name.trim(),
      on_team: Boolean(assignee.on_team),
      department: assignee.department || null,
      member_id: assignee.member_id || null
    };
  }
  return null;
}

function formatTicketMd(t) {
  let md = `### ${t.title}\n\n`;
  md += `**Priority:** ${t.priority || 'medium'}  \n`;
  const info = getAssigneeInfo(t.assignee);
  if (info && info.name) {
    let extra = '';
    if (info.on_team && info.department) extra = ` (${info.department})`;
    else if (!info.on_team) extra = ` (Not on team)`;
    md += `**Assignee:** @${info.name}${extra}  \n`;
  }
  md += `\n${t.description || ''}\n\n`;
  if (t.acceptance_criteria && t.acceptance_criteria.length > 0) {
    md += `**Acceptance Criteria:**\n`;
    t.acceptance_criteria.forEach(ac => {
      md += `- ${ac}\n`;
    });
  }
  return md.trim();
}

function announceTicketStatus(msg) {
  const el = document.getElementById('ticket-announcer');
  if (el) {
    el.textContent = '';
    setTimeout(() => {
      el.textContent = msg;
    }, 50);
  }
}

function createTicketCard(ticket, options = {}) {
  const card = document.createElement('div');
  const readOnlyReason = options.readOnlyReason || (!ticket.id ? "Meeting wasn't saved, so changes can't be saved." : null);

  function updateCardClass() {
    const p = (ticket.priority || 'medium').toLowerCase();
    const isApproved = ticket.status === 'approved';
    card.className = `ticket-card ${p}${isApproved ? ' approved' : ''}`;
  }
  updateCardClass();

  const viewContainer = document.createElement('div');
  viewContainer.className = 'ticket-view-mode';

  const editContainer = document.createElement('div');
  editContainer.className = 'ticket-edit-mode';
  editContainer.style.display = 'none';

  card.appendChild(viewContainer);
  card.appendChild(editContainer);

  let editBtnRef = null;

  function renderView() {
    updateCardClass();
    const p = (ticket.priority || 'medium').toLowerCase();
    const isApproved = ticket.status === 'approved';

    const acItems = (ticket.acceptance_criteria || [])
      .map(ac => `<li class="criteria-item">${escapeHtml(ac)}</li>`)
      .join('');

    const statusBadge = isApproved
      ? `<span class="badge badge-status approved" aria-label="Status: Approved">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
          Approved
        </span>`
      : `<span class="badge badge-status pending" aria-label="Status: Pending">Pending</span>`;

    const assigneeInfo = getAssigneeInfo(ticket.assignee);
    let assigneeBadge = '';
    if (assigneeInfo) {
      if (assigneeInfo.on_team) {
        assigneeBadge = `
          <span class="badge assignee team" title="Team member${assigneeInfo.department ? ' (' + escapeHtml(assigneeInfo.department) + ')' : ''}">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            <span class="assignee-name">@${escapeHtml(assigneeInfo.name)}</span>
            ${assigneeInfo.department ? `<span class="assignee-dept">${escapeHtml(assigneeInfo.department)}</span>` : ''}
          </span>
        `;
      } else {
        assigneeBadge = `
          <span class="badge assignee not-on-team" title="Not on team: This person is not registered as a team member" aria-label="Assignee: @${escapeHtml(assigneeInfo.name)} (Not on team)">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            <span class="assignee-name">@${escapeHtml(assigneeInfo.name)}</span>
            <span class="assignee-not-on-team-label">Not on team</span>
          </span>
        `;
      }
    }

    viewContainer.innerHTML = `
      <div class="ticket-header">
        <h3 class="ticket-title">${escapeHtml(ticket.title)}</h3>
        <div class="ticket-tags">
          ${statusBadge}
          <span class="badge p-${p}">${p}</span>
          ${assigneeBadge}
        </div>
      </div>
      <div class="ticket-desc">${escapeHtml(ticket.description || '')}</div>
      ${acItems ? `
        <div class="ticket-criteria">
          <div class="ticket-criteria-label">Acceptance Criteria</div>
          <ul class="criteria-list">${acItems}</ul>
        </div>
      ` : ''}
      <div class="ticket-footer">
        <div class="ticket-footer-msg" aria-live="polite">
          ${readOnlyReason ? `<span class="ticket-read-only-note">${escapeHtml(readOnlyReason)}</span>` : ''}
        </div>
        <div class="ticket-footer-actions">
          ${isApproved
            ? `<button class="btn-ticket btn-undo-approval" type="button" aria-label="Undo approval for ${escapeHtml(ticket.title)}"${readOnlyReason ? ' disabled' : ''}>Undo approval</button>`
            : `<button class="btn-ticket btn-approve" type="button" aria-label="Approve ticket ${escapeHtml(ticket.title)}"${readOnlyReason ? ' disabled' : ''}>Approve</button>`
          }
          <button class="btn-ticket btn-edit-ticket" type="button" aria-label="Edit ticket ${escapeHtml(ticket.title)}"${readOnlyReason ? ' disabled' : ''}>Edit</button>
          <button class="btn-copy-ticket" type="button" aria-label="Copy ticket as Markdown">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            <span>Copy</span>
          </button>
        </div>
      </div>
    `;

    const footerMsg = viewContainer.querySelector('.ticket-footer-msg');
    const approveBtn = viewContainer.querySelector('.btn-approve');
    const undoBtn = viewContainer.querySelector('.btn-undo-approval');
    const editBtn = viewContainer.querySelector('.btn-edit-ticket');
    const copyBtn = viewContainer.querySelector('.btn-copy-ticket');
    editBtnRef = editBtn;

    if (approveBtn && !readOnlyReason) {
      approveBtn.addEventListener('click', async () => {
        if (!ticket.id) return;
        approveBtn.disabled = true;
        footerMsg.innerHTML = '';
        try {
          const res = await fetch(`/api/tickets/${ticket.id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'approved' }),
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.detail || `HTTP ${res.status}`);
          }
          const updated = await res.json();
          Object.assign(ticket, updated);
          announceTicketStatus(`Ticket "${ticket.title}" approved.`);
          renderView();
          if (typeof options.onUpdate === 'function') options.onUpdate(ticket);
        } catch (err) {
          footerMsg.innerHTML = `<span class="field-error">Approval failed: ${escapeHtml(err.message)}</span>`;
          approveBtn.disabled = false;
        }
      });
    }

    if (undoBtn && !readOnlyReason) {
      undoBtn.addEventListener('click', async () => {
        if (!ticket.id) return;
        undoBtn.disabled = true;
        footerMsg.innerHTML = '';
        try {
          const res = await fetch(`/api/tickets/${ticket.id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'pending' }),
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.detail || `HTTP ${res.status}`);
          }
          const updated = await res.json();
          Object.assign(ticket, updated);
          announceTicketStatus(`Approval undone for ticket "${ticket.title}". Status is now Pending.`);
          renderView();
          if (typeof options.onUpdate === 'function') options.onUpdate(ticket);
        } catch (err) {
          footerMsg.innerHTML = `<span class="field-error">Undo failed: ${escapeHtml(err.message)}</span>`;
          undoBtn.disabled = false;
        }
      });
    }

    if (editBtn && !readOnlyReason) {
      editBtn.addEventListener('click', () => {
        enterEditMode();
      });
    }

    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const md = formatTicketMd(ticket);
        await navigator.clipboard.writeText(md);
        copyBtn.classList.add('copied');
        copyBtn.querySelector('span').textContent = 'Copied';
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          copyBtn.querySelector('span').textContent = 'Copy';
        }, 2000);
      });
    }
  }

  async function enterEditMode() {
    await ensureTeamDataLoaded();

    viewContainer.style.display = 'none';
    editContainer.style.display = 'block';

    const isApproved = ticket.status === 'approved';
    const formIdPrefix = `t-${ticket.id || Math.random().toString(36).slice(2, 7)}`;

    const depts = state.departments || [];
    const members = state.teamMembers || [];

    const deptMap = new Map();
    depts.forEach(d => deptMap.set(d.id, { name: d.name, members: [] }));

    members.forEach(m => {
      if (deptMap.has(m.department_id)) {
        deptMap.get(m.department_id).members.push(m);
      } else {
        const deptName = m.department_name || 'Other';
        if (!deptMap.has(m.department_id)) {
          deptMap.set(m.department_id, { name: deptName, members: [m] });
        } else {
          deptMap.get(m.department_id).members.push(m);
        }
      }
    });

    let optgroupsHtml = '';
    for (const [, deptData] of deptMap.entries()) {
      if (deptData.members.length > 0) {
        optgroupsHtml += `<optgroup label="${escapeHtml(deptData.name)}">`;
        deptData.members.forEach(m => {
          optgroupsHtml += `<option value="${m.id}">${escapeHtml(m.name)}</option>`;
        });
        optgroupsHtml += `</optgroup>`;
      }
    }

    const currentAssignee = getAssigneeInfo(ticket.assignee);

    editContainer.innerHTML = `
      <form class="ticket-edit-form" novalidate>
        ${isApproved ? `<div class="edit-note-approved">Saving changes will move this ticket back to Pending.</div>` : ''}
        <div class="form-group">
          <label class="form-label" for="${formIdPrefix}-title">Title <span class="required-star">*</span></label>
          <input type="text" id="${formIdPrefix}-title" class="text-input edit-field-title" value="${escapeHtml(ticket.title)}" maxlength="200" required aria-describedby="${formIdPrefix}-err-title">
          <div id="${formIdPrefix}-err-title" class="field-error" aria-live="polite"></div>
        </div>
        <div class="form-group">
          <label class="form-label" for="${formIdPrefix}-desc">Description</label>
          <textarea id="${formIdPrefix}-desc" class="text-input textarea-input edit-field-desc" rows="3" maxlength="2000" aria-describedby="${formIdPrefix}-err-desc">${escapeHtml(ticket.description || '')}</textarea>
          <div id="${formIdPrefix}-err-desc" class="field-error" aria-live="polite"></div>
        </div>
        <div class="form-row-2col">
          <div class="form-group">
            <label class="form-label" for="${formIdPrefix}-priority">Priority</label>
            <select id="${formIdPrefix}-priority" class="text-input select-input edit-field-priority">
              <option value="low" ${ticket.priority === 'low' ? 'selected' : ''}>Low</option>
              <option value="medium" ${ticket.priority === 'medium' || !ticket.priority ? 'selected' : ''}>Medium</option>
              <option value="high" ${ticket.priority === 'high' ? 'selected' : ''}>High</option>
            </select>
            <div id="${formIdPrefix}-err-priority" class="field-error" aria-live="polite"></div>
          </div>
          <div class="form-group">
            <label class="form-label" for="${formIdPrefix}-assignee-select">Assignee</label>
            <select id="${formIdPrefix}-assignee-select" class="text-input select-input edit-field-assignee-select">
              <option value="">Unassigned</option>
              ${optgroupsHtml}
              <option value="__other__">Someone else...</option>
            </select>
            <div id="${formIdPrefix}-other-wrapper" class="assignee-other-wrapper" style="display: none; margin-top: 0.4rem;">
              <input type="text" id="${formIdPrefix}-assignee-other" class="text-input edit-field-assignee-other" maxlength="100" placeholder="Enter name not on team..." aria-describedby="${formIdPrefix}-err-assignee">
            </div>
            <div id="${formIdPrefix}-err-assignee" class="field-error" aria-live="polite"></div>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="${formIdPrefix}-criteria">Acceptance Criteria <span class="form-hint" style="font-size:0.75rem; color:var(--text-subtle);">(one per line)</span></label>
          <textarea id="${formIdPrefix}-criteria" class="text-input textarea-input edit-field-criteria" rows="4" placeholder="One criterion per line" aria-describedby="${formIdPrefix}-err-criteria">${escapeHtml((ticket.acceptance_criteria || []).join('\n'))}</textarea>
          <div id="${formIdPrefix}-err-criteria" class="field-error" aria-live="polite"></div>
        </div>
        <div class="edit-general-error field-error" aria-live="polite"></div>
        <div class="edit-form-footer">
          <button type="submit" class="btn-primary btn-save-ticket">Save</button>
          <button type="button" class="btn-secondary btn-cancel-ticket">Cancel</button>
        </div>
      </form>
    `;

    const form = editContainer.querySelector('.ticket-edit-form');
    const titleInput = editContainer.querySelector('.edit-field-title');
    const descInput = editContainer.querySelector('.edit-field-desc');
    const priorityInput = editContainer.querySelector('.edit-field-priority');
    const assigneeSelect = editContainer.querySelector('.edit-field-assignee-select');
    const otherWrapper = document.getElementById(`${formIdPrefix}-other-wrapper`);
    const otherInput = editContainer.querySelector('.edit-field-assignee-other');
    const criteriaInput = editContainer.querySelector('.edit-field-criteria');
    const saveBtn = editContainer.querySelector('.btn-save-ticket');
    const cancelBtn = editContainer.querySelector('.btn-cancel-ticket');
    const genError = editContainer.querySelector('.edit-general-error');

    const errTitle = document.getElementById(`${formIdPrefix}-err-title`);
    const errDesc = document.getElementById(`${formIdPrefix}-err-desc`);
    const errPriority = document.getElementById(`${formIdPrefix}-err-priority`);
    const errAssignee = document.getElementById(`${formIdPrefix}-err-assignee`);
    const errCriteria = document.getElementById(`${formIdPrefix}-err-criteria`);

    if (currentAssignee && currentAssignee.member_id) {
      assigneeSelect.value = String(currentAssignee.member_id);
      otherWrapper.style.display = 'none';
      otherInput.value = '';
    } else if (currentAssignee && currentAssignee.name) {
      assigneeSelect.value = '__other__';
      otherWrapper.style.display = 'block';
      otherInput.value = currentAssignee.name;
    } else {
      assigneeSelect.value = '';
      otherWrapper.style.display = 'none';
      otherInput.value = '';
    }

    assigneeSelect.addEventListener('change', () => {
      if (assigneeSelect.value === '__other__') {
        otherWrapper.style.display = 'block';
        otherInput.focus();
      } else {
        otherWrapper.style.display = 'none';
        otherInput.value = '';
        if (errAssignee) errAssignee.textContent = '';
      }
    });

    function clearErrors() {
      if (errTitle) errTitle.textContent = '';
      if (errDesc) errDesc.textContent = '';
      if (errPriority) errPriority.textContent = '';
      if (errAssignee) errAssignee.textContent = '';
      if (errCriteria) errCriteria.textContent = '';
      if (genError) genError.textContent = '';
    }

    function exitEditMode() {
      editContainer.style.display = 'none';
      viewContainer.style.display = 'block';
      if (editBtnRef) {
        editBtnRef.focus();
      }
    }

    cancelBtn.addEventListener('click', () => {
      exitEditMode();
    });

    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        exitEditMode();
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors();

      let hasError = false;
      const titleVal = titleInput.value.trim();
      if (!titleVal) {
        errTitle.textContent = 'Title is required';
        hasError = true;
      } else if (titleVal.length > 200) {
        errTitle.textContent = 'Title must be at most 200 characters';
        hasError = true;
      }

      const descVal = descInput.value;
      if (descVal.length > 2000) {
        errDesc.textContent = 'Description must be at most 2000 characters';
        hasError = true;
      }

      let targetMemberId = null;
      let targetAssigneeName = null;

      if (assigneeSelect.value === '__other__') {
        const customName = otherInput.value.trim();
        if (customName.length > 100) {
          errAssignee.textContent = 'Assignee must be at most 100 characters';
          hasError = true;
        }
        targetAssigneeName = customName || null;
      } else if (assigneeSelect.value) {
        targetMemberId = parseInt(assigneeSelect.value, 10);
      }

      const priorityVal = priorityInput.value.toLowerCase();
      if (!['low', 'medium', 'high'].includes(priorityVal)) {
        errPriority.textContent = "Priority must be 'low', 'medium', or 'high'";
        hasError = true;
      }

      const rawLines = criteriaInput.value.split('\n');
      const cleanCriteria = rawLines.map(l => l.trim()).filter(Boolean);
      if (cleanCriteria.length > 20) {
        errCriteria.textContent = 'At most 20 acceptance criteria allowed';
        hasError = true;
      } else {
        for (const item of cleanCriteria) {
          if (item.length > 300) {
            errCriteria.textContent = 'Each criterion must be at most 300 characters';
            hasError = true;
            break;
          }
        }
      }

      if (hasError) return;

      saveBtn.disabled = true;
      cancelBtn.disabled = true;

      try {
        const payload = {
          title: titleVal,
          description: descVal,
          priority: priorityVal,
          acceptance_criteria: cleanCriteria,
          assignee_member_id: targetMemberId,
          assignee_name: targetAssigneeName,
        };

        const res = await fetch(`/api/tickets/${ticket.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          if (res.status === 422 && errData.errors) {
            if (errData.errors.title && errTitle) errTitle.textContent = errData.errors.title;
            if (errData.errors.description && errDesc) errDesc.textContent = errData.errors.description;
            const aErr = errData.errors.assignee || errData.errors.assignee_name || errData.errors.assignee_member_id;
            if (aErr && errAssignee) errAssignee.textContent = aErr;
            if (errData.errors.priority && errPriority) errPriority.textContent = errData.errors.priority;
            if (errData.errors.acceptance_criteria && errCriteria) errCriteria.textContent = errData.errors.acceptance_criteria;
            return;
          }
          throw new Error(errData.detail || `HTTP ${res.status}`);
        }

        const updated = await res.json();
        Object.assign(ticket, updated);
        announceTicketStatus(`Ticket "${ticket.title}" saved.`);
        renderView();
        exitEditMode();
        if (typeof options.onUpdate === 'function') options.onUpdate(ticket);
      } catch (err) {
        genError.textContent = `Save failed: ${err.message}`;
      } finally {
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
      }
    });

    titleInput.focus();
    titleInput.select();
  }

  renderView();
  return card;
}

function renderTickets(tickets, options = {}) {
  state.currentTickets = tickets || [];
  if (!els.resultsTicketsList) return;
  els.resultsTicketsList.innerHTML = '';
  if (els.ticketsBadgeCount) {
    els.ticketsBadgeCount.textContent = state.currentTickets.length;
  }

  state.currentTickets.forEach((t, i) => {
    const card = createTicketCard(t, {
      context: 'results',
      readOnlyReason: options.readOnlyReason || (!t.id ? "Meeting wasn't saved, so changes can't be saved." : null),
      onUpdate: (updatedTicket) => {
        state.currentTickets[i] = updatedTicket;
      }
    });
    els.resultsTicketsList.appendChild(card);
  });
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
    setupTranscribeAudio(state.selectedAudioFile);
  } else {
    const textVal = els.notesInput.value.trim();
    if (!textVal) return;
    formData.append('text', textVal);
    cleanupTranscribeAudio();
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
          const readOnlyReason = (!data.meeting_id || data.save_error) ? "Meeting wasn't saved, so changes can't be saved." : null;
          renderTickets(data.tickets || [], { meetingId: data.meeting_id, readOnlyReason });

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

  // Departments actions
  if (els.btnCreateDepartment) {
    els.btnCreateDepartment.addEventListener('click', () => openDepartmentDialog());
  }
  if (els.btnCreateDepartmentEmpty) {
    els.btnCreateDepartmentEmpty.addEventListener('click', () => openDepartmentDialog());
  }
  if (els.btnCloseDeptDialog) {
    els.btnCloseDeptDialog.addEventListener('click', closeDepartmentDialog);
  }
  if (els.btnCancelDept) {
    els.btnCancelDept.addEventListener('click', closeDepartmentDialog);
  }
  if (els.departmentDialogForm) {
    els.departmentDialogForm.addEventListener('submit', handleSaveDepartment);
  }
  if (els.departmentDialog) {
    els.departmentDialog.addEventListener('click', (e) => {
      if (e.target === els.departmentDialog) closeDepartmentDialog();
    });
  }

  // Delete Department Dialog events
  if (els.btnCloseDeleteDeptDialog) {
    els.btnCloseDeleteDeptDialog.addEventListener('click', closeDeleteDepartmentDialog);
  }
  if (els.btnCancelDeleteDept) {
    els.btnCancelDeleteDept.addEventListener('click', closeDeleteDepartmentDialog);
  }
  if (els.btnConfirmDeleteDept) {
    els.btnConfirmDeleteDept.addEventListener('click', handleConfirmDeleteDepartment);
  }
  if (els.deleteDepartmentDialog) {
    els.deleteDepartmentDialog.addEventListener('click', (e) => {
      if (e.target === els.deleteDepartmentDialog) closeDeleteDepartmentDialog();
    });
  }

  // Team Members actions
  if (els.btnCreateTeamMember) {
    els.btnCreateTeamMember.addEventListener('click', () => openTeamMemberDialog());
  }
  if (els.btnCreateMemberEmpty) {
    els.btnCreateMemberEmpty.addEventListener('click', () => openTeamMemberDialog());
  }
  if (els.btnCloseTeamMemberDialog) {
    els.btnCloseTeamMemberDialog.addEventListener('click', closeTeamMemberDialog);
  }
  if (els.btnCancelTeamMember) {
    els.btnCancelTeamMember.addEventListener('click', closeTeamMemberDialog);
  }
  if (els.teamMemberDialogForm) {
    els.teamMemberDialogForm.addEventListener('submit', handleSaveTeamMember);
  }
  if (els.teamMemberDialog) {
    els.teamMemberDialog.addEventListener('click', (e) => {
      if (e.target === els.teamMemberDialog) closeTeamMemberDialog();
    });
  }

  // Delete Team Member Dialog events
  if (els.btnCloseDeleteMemberDialog) {
    els.btnCloseDeleteMemberDialog.addEventListener('click', closeDeleteTeamMemberDialog);
  }
  if (els.btnCancelDeleteMember) {
    els.btnCancelDeleteMember.addEventListener('click', closeDeleteTeamMemberDialog);
  }
  if (els.btnConfirmDeleteMember) {
    els.btnConfirmDeleteMember.addEventListener('click', handleConfirmDeleteTeamMember);
  }
  if (els.deleteTeamMemberDialog) {
    els.deleteTeamMemberDialog.addEventListener('click', (e) => {
      if (e.target === els.deleteTeamMemberDialog) closeDeleteTeamMemberDialog();
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

  // Transcribe audio error handler (unsupported audio format fallback)
  if (els.transcribeAudioPlayer) {
    els.transcribeAudioPlayer.addEventListener('error', () => {
      if (els.transcribeAudioPlayer.src) {
        els.transcribeAudioPlayer.style.display = 'none';
        if (els.transcribeAudioUnsupported) {
          els.transcribeAudioUnsupported.style.display = 'flex';
        }
      }
    });
  }

  // Saved meeting audio error handler (unsupported audio format fallback)
  if (els.meetingAudioPlayer) {
    els.meetingAudioPlayer.addEventListener('error', () => {
      if (els.meetingAudioPlayer.src) {
        els.meetingAudioPlayer.style.display = 'none';
        if (els.meetingAudioUnsupported) {
          els.meetingAudioUnsupported.style.display = 'flex';
        }
      }
    });
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
  ensureTeamDataLoaded();
  validateInputs();
  refreshHealth();
  loadModelsRegistry();
  setInterval(refreshHealth, 5000);
});

