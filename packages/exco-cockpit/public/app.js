/* ============================================================
   EIP ExCo Cockpit — Client Application
   Synthetic-fixture POC. All data from /api/v1 endpoints.
   Feedback is browser-session only — never server-side.
   ============================================================ */

'use strict';

// ── State ─────────────────────────────────────────────────

const state = {
  // API data (populated on init)
  overview: null,
  decisions: null,
  risksActions: null,   // { evidenceProxyNotice, risks[], actions[] }
  topicMemory: null,
  topics: null,

  // Feedback (browser-session only)
  feedback: [],
  feedbackTarget: null, // { itemType, itemId, itemLabel } | null
  feedbackPanelOpen: false,

  // Filters
  filters: { type: '', meeting: '', domain: '', entityFamily: '', keyword: '' },
};

// ── Overview card → content-type mapping ──────────────────
// Used by deep-link navigation from Overview stat cards.

const OVERVIEW_CARD_MAP = {
  meetingCount:           { type: 'Meeting',      state: null },
  topicCount:             { type: 'Topic',        state: null },
  decisionCount:          { type: 'Decision',     state: null },
  openActionCount:        { type: 'Action',       state: 'open' },
  topicMemoryCount:       { type: 'Topic Memory', state: null },
  pendingReviewCount:     { type: 'Topic Memory', state: 'pending_review' },
  validationWarningCount: { type: 'Topic',        state: 'warning' },
  riskCount:              { type: 'Risk',         state: null },
};

// ── Utilities ─────────────────────────────────────────────

function el(id) { return document.getElementById(id); }

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function notExtracted(val) {
  return val === 'Not extracted' || val === null || val === undefined || val === '';
}

function renderMaybeExtracted(val) {
  if (notExtracted(val)) return '<span class="not-extracted">Not extracted</span>';
  if (Array.isArray(val)) return val.length ? val.map(esc).join(', ') : '<span class="not-extracted">Not extracted</span>';
  return esc(val);
}

function validationBadge(status) {
  if (status === 'warning') return '<span class="badge badge-warning">⚠ Warning</span>';
  if (status === 'fail')    return '<span class="badge badge-risk">✗ Fail</span>';
  return '<span class="badge badge-pass">✓ Pass</span>';
}

// ── API ───────────────────────────────────────────────────

async function apiFetch(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`API error ${res.status} for ${path}`);
  const json = await res.json();
  return json.data;
}

// ── Tab navigation ────────────────────────────────────────

function initTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.tab-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => activateTab(tab, tabs, panels));
    tab.addEventListener('keydown', e => {
      const list = [...tabs];
      const idx = list.indexOf(tab);
      if (e.key === 'ArrowRight') { list[(idx + 1) % list.length].focus(); e.preventDefault(); }
      if (e.key === 'ArrowLeft')  { list[(idx - 1 + list.length) % list.length].focus(); e.preventDefault(); }
      if (e.key === 'Home')       { list[0].focus(); e.preventDefault(); }
      if (e.key === 'End')        { list[list.length - 1].focus(); e.preventDefault(); }
    });
  });
}

function activateTab(targetTab, tabs, panels) {
  tabs = tabs || document.querySelectorAll('.tab-btn');
  panels = panels || document.querySelectorAll('.tab-panel');
  tabs.forEach(t => {
    t.setAttribute('aria-selected', 'false');
    t.tabIndex = -1;
  });
  panels.forEach(p => p.classList.remove('active'));
  targetTab.setAttribute('aria-selected', 'true');
  targetTab.tabIndex = 0;
  el(targetTab.getAttribute('aria-controls')).classList.add('active');
}

function switchToAllContent(typeFilter, stateFilter) {
  // Set filters
  state.filters.type = typeFilter || '';
  state.filters.meeting = '';
  state.filters.domain = '';
  state.filters.entityFamily = '';
  state.filters.keyword = '';

  // Update filter UI
  if (el('filter-type')) el('filter-type').value = typeFilter || '';
  if (el('filter-meeting')) el('filter-meeting').value = '';
  if (el('filter-domain')) el('filter-domain').value = '';
  if (el('filter-entity-family')) el('filter-entity-family').value = '';
  if (el('filter-keyword')) el('filter-keyword').value = '';

  // Store state filter for render (e.g. open actions, pending memory)
  state._stateFilter = stateFilter || null;

  // Activate All Content tab
  const allTab = el('tab-all-content');
  activateTab(allTab);
  allTab.focus();

  // Render
  renderAllContent();
}

// ── Filter helpers ────────────────────────────────────────

function buildAllItems() {
  const items = [];
  const meetings = state.overview ? state.overview.meetings : [];
  const decisions = state.decisions || [];
  const risks = state.risksActions ? state.risksActions.risks : [];
  const actions = state.risksActions ? state.risksActions.actions : [];
  const memories = state.topicMemory || [];
  const topics = state.topics || [];

  // Meetings
  meetings.forEach(m => items.push({
    _type: 'Meeting',
    _id: m.meetingId,
    _searchText: [m.subject, m.organiser].filter(Boolean).join(' ').toLowerCase(),
    _meetingId: m.meetingId,
    _domain: null,
    _entityFamily: null,
    _stateValue: null,
    data: m,
  }));

  // Topics
  topics.forEach(t => {
    const meetingSubject = state.overview && state.overview.meetings ? 
      state.overview.meetings.find(m => m.meetingId === t.meetingId)?.subject : null;
    items.push({
      _type: 'Topic',
      _id: t.topicId,
      _searchText: [t.topicStatement, t.entity, t.entityType, t.domain, t.aspect, t.outcome, meetingSubject].filter(s => s && !notExtracted(s)).join(' ').toLowerCase(),
      _meetingId: t.meetingId,
      _domain: t.domain && t.domain !== 'Not extracted' ? t.domain : null,
      _entityFamily: t.entityType && t.entityType !== 'Not extracted' ? t.entityType : null,
      _stateValue: t.validation?.status !== 'pass' ? t.validation?.status : null,
      data: t,
    });
  });

  // Decisions
  decisions.forEach(d => {
    const meeting = meetings.find(m => m.meetingId === d.meetingId);
    items.push({
      _type: 'Decision',
      _id: d.decisionId,
      _searchText: [
        d.text, d.owner, d.meetingSubject, d.topicStatement, d.evidenceContext,
        d.topicDomain, d.topicEntityType, d.topicEntity,
      ].filter(s => s && !notExtracted(s)).join(' ').toLowerCase(),
      _meetingId: d.meetingId,
      _domain: d.topicDomain && d.topicDomain !== 'Not extracted' ? d.topicDomain : null,
      _entityFamily: d.topicEntityType && d.topicEntityType !== 'Not extracted' ? d.topicEntityType : null,
      _stateValue: null,
      _linkedMeeting: meeting,
      data: d,
    });
  });

  // Risks
  risks.forEach(r => {
    const meeting = meetings.find(m => m.meetingId === r.meetingId);
    items.push({
      _type: 'Risk',
      _id: r.riskId,
      _searchText: [
        r.riskText, r.topicStatement, r.owner, 
        r.topicDomain, r.topicEntityType, r.topicEntity,
        meeting && meeting.subject,
      ].filter(s => s && !notExtracted(s)).join(' ').toLowerCase(),
      _meetingId: r.meetingId,
      _domain: r.topicDomain && r.topicDomain !== 'Not extracted' ? r.topicDomain : null,
      _entityFamily: r.topicEntityType && r.topicEntityType !== 'Not extracted' ? r.topicEntityType : null,
      _stateValue: null,
      _linkedMeeting: meeting,
      data: r,
    });
  });

  // Actions
  actions.forEach(a => {
    const meeting = meetings.find(m => m.meetingId === a.meetingId);
    items.push({
      _type: 'Action',
      _id: a.actionId,
      _searchText: [
        a.text, a.owner, a.meetingSubject, a.topicStatement,
        a.topicDomain, a.topicEntityType, a.topicEntity,
        meeting && meeting.subject,
      ].filter(s => s && !notExtracted(s)).join(' ').toLowerCase(),
      _meetingId: a.meetingId,
      _domain: a.topicDomain && a.topicDomain !== 'Not extracted' ? a.topicDomain : null,
      _entityFamily: a.topicEntityType && a.topicEntityType !== 'Not extracted' ? a.topicEntityType : null,
      _stateValue: a.status,
      _linkedMeeting: meeting,
      data: a,
    });
  });

  // Topic Memory
  // Topic Memory: Domain filter explicitly excludes all Topic Memory records.
  // No domain is extracted from or derivable for memory records — they are
  // enduring condition records without an organisational owner field.
  // The Domain filter select will never match Topic Memory items.
  // Use the Entity Family filter (on entityType) or Keyword to find relevant memories.
  memories.forEach(m => items.push({
    _type: 'Topic Memory',
    _id: m.memoryId,
    _searchText: [
      m.canonicalStatement, m.entity, m.entityType, m.aspect,
      m.latestOutcome, m.proposedMatchStatement,
    ].filter(s => s && !notExtracted(s)).join(' ').toLowerCase(),
    _meetingId: m.firstSeenMeetingId,
    _lastMeetingId: m.lastSeenMeetingId,
    _domain: null, // explicitly excluded — no domain extracted for Topic Memory
    _entityFamily: m.entityType,
    _stateValue: m.matchStatus,
    data: m,
  }));

  return items;
}

function applyFilters(items) {
  const { type, meeting, domain, entityFamily, keyword } = state.filters;
  const stateFilter = state._stateFilter || null;

  return items.filter(item => {
    if (type && item._type !== type) return false;
    // For Topic Memory items, match if either first OR last meeting ID matches
    if (meeting) {
      if (item._type === 'Topic Memory') {
        if (item._meetingId !== meeting && item._lastMeetingId !== meeting) return false;
      } else {
        if (item._meetingId !== meeting) return false;
      }
    }
    if (domain && item._domain !== domain) return false;
    if (entityFamily && item._entityFamily !== entityFamily) return false;
    if (stateFilter && item._stateValue !== stateFilter) return false;
    if (keyword) {
      const kw = keyword.toLowerCase().trim();
      if (!item._searchText.includes(kw)) return false;
    }
    return true;
  });
}

function populateFilterOptions() {
  const meetings = state.overview ? state.overview.meetings : [];
  const topics = state.topics || [];

  // Meeting options
  const meetingSelect = el('filter-meeting');
  meetings.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.meetingId;
    opt.textContent = `${m.eventDate.substring(0,10)} — ${m.subject}`;
    meetingSelect.appendChild(opt);
  });

  // Domain options — from Topics
  const domains = [...new Set(topics.map(t => t.domain).filter(d => d && d !== 'Not extracted'))].sort();
  const domainSelect = el('filter-domain');
  domains.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    domainSelect.appendChild(opt);
  });

  // Entity Family options — from Topics
  const entityTypes = [...new Set(topics.map(t => t.entityType).filter(et => et && et !== 'Not extracted'))].sort();
  const entitySelect = el('filter-entity-family');
  entityTypes.forEach(et => {
    const opt = document.createElement('option');
    opt.value = et;
    opt.textContent = et;
    entitySelect.appendChild(opt);
  });
}

function renderFilterSummary(filtered, total) {
  const active = [];
  if (state.filters.type) active.push(`Type: <span class="filter-active-tag">${esc(state.filters.type)}</span>`);
  if (state.filters.meeting) {
    const m = state.overview && state.overview.meetings.find(x => x.meetingId === state.filters.meeting);
    active.push(`Meeting: <span class="filter-active-tag">${esc(m ? m.subject.substring(0,30) : state.filters.meeting)}</span>`);
  }
  if (state.filters.domain) active.push(`Domain: <span class="filter-active-tag">${esc(state.filters.domain)}</span>`);
  if (state.filters.entityFamily) active.push(`Entity family: <span class="filter-active-tag">${esc(state.filters.entityFamily)}</span>`);
  if (state.filters.keyword) active.push(`Keyword: <span class="filter-active-tag">${esc(state.filters.keyword)}</span>`);
  if (state._stateFilter) active.push(`State: <span class="filter-active-tag">${esc(state._stateFilter)}</span>`);

  const summaryEl = el('filter-summary');
  if (!summaryEl) return;
  if (active.length) {
    summaryEl.innerHTML = `${active.join(' · ')} · <strong>${filtered}</strong> of ${total} results`;
  } else {
    summaryEl.innerHTML = `<strong>${filtered}</strong> of ${total} items`;
  }
}

// ── All Content rendering ─────────────────────────────────

function renderAllContent() {
  const resultsEl = el('all-content-results');
  if (!resultsEl) return;

  const allItems = buildAllItems();
  const filtered = applyFilters(allItems);
  renderFilterSummary(filtered.length, allItems.length);

  if (!filtered.length) {
    resultsEl.innerHTML = '<div class="empty-state">No items match the current filters. <button class="btn-secondary" onclick="clearFilters()">Clear all filters</button></div>';
    return;
  }

  // Group by type
  const order = ['Meeting', 'Topic', 'Topic Memory', 'Decision', 'Action', 'Risk'];
  const groups = {};
  for (const t of order) groups[t] = [];
  filtered.forEach(item => {
    if (!groups[item._type]) groups[item._type] = [];
    groups[item._type].push(item);
  });

  let html = '';
  for (const type of order) {
    const group = groups[type];
    if (!group.length) continue;
    html += `<div class="content-type-section">
      <div class="content-type-header">
        <span class="content-type-title">${esc(type)}</span>
        <span class="content-type-count">${group.length}</span>
      </div>
      ${group.map(item => renderItemCard(item)).join('')}
    </div>`;
  }
  resultsEl.innerHTML = html;
}

function renderItemCard(item) {
  const type = item._type;
  const d = item.data;

  switch (type) {
    case 'Meeting':
      return `<div class="card">
        <div class="card-header">
          <div class="card-title">${esc(d.subject)}</div>
          ${validationBadge(d.validationStatus)}
        </div>
        <div class="card-meta">${esc(d.organiser)} · ${esc((d.eventDate||'').substring(0,10))} · ${d.topicCount} topics · ${d.decisionCount} decisions · ${d.actionCount} actions</div>
      </div>`;

    case 'Topic': {
      const evidenceUrl = `/api/v1/evidence/topic/${d.topicId}`;
      return `<div class="card">
        <div class="card-header">
          <div class="card-title">${esc(d.topicStatement)}</div>
          <div class="btn-actions">
            <button class="btn-evidence" onclick="showEvidence('topic','${esc(d.topicId)}','Topic evidence')">Evidence</button>
            <button class="btn-feedback" onclick="openFeedback('topic','${esc(d.topicId)}','${esc((d.topicStatement||'').substring(0,40))}...')">Feedback</button>
          </div>
        </div>
        <div class="card-meta">
          ${d.entityType && !notExtracted(d.entityType) ? `[${esc(d.entityType)}] ` : ''}${d.entity && !notExtracted(d.entity) ? esc(d.entity) : ''} · 
          ${d.domain && d.domain !== 'Not extracted' ? `Domain: ${esc(d.domain)}` : ''} · 
          ${d.aspect && !notExtracted(d.aspect) ? `Aspect: ${esc(d.aspect)}` : ''}
        </div>
        ${d.outcome && !notExtracted(d.outcome) ? `<div style="font-size:12px;color:var(--color-text-muted);margin-top:4px;">Outcome: ${esc(d.outcome)}</div>` : ''}
        ${d.executiveScope && !notExtracted(d.executiveScope) ? `<div style="font-size:12px;color:var(--color-text-muted);margin-top:4px;">Scope: ${esc(d.executiveScope)}</div>` : ''}
        ${d.validation?.status ? `<div style="margin-top:8px;">${validationBadge(d.validation.status)}</div>` : ''}
      </div>`;
    }

    case 'Decision': {
      const evUrl = d.evidenceDetailUrl;
      const evType = evUrl ? evUrl.split('/')[4] : 'decision';
      const evId   = evUrl ? evUrl.split('/')[5] : d.decisionId;
      return `<div class="card">
        <div class="card-header">
          <div class="card-title">${esc(d.text)}</div>
          <div class="btn-actions">
            <button class="btn-evidence" onclick="showEvidence('${esc(evType)}','${esc(evId)}','${esc((d.text||'').substring(0,40))}...')">Evidence</button>
            <button class="btn-feedback" onclick="openFeedback('decision','${esc(d.decisionId)}','${esc((d.text||'').substring(0,40))}...')">Feedback</button>
          </div>
        </div>
        <div class="card-meta">
          Owner: ${renderMaybeExtracted(d.owner)} ·
          ${esc(d.meetingSubject || d.meetingId)} ·
          ${d.meetingEventDate ? esc(d.meetingEventDate.substring(0,10)) : ''}
        </div>
        ${d.topicStatement && !notExtracted(d.topicStatement) ? `<div style="font-size:12px;color:var(--color-text-muted);margin-top:4px;">Topic: ${esc(d.topicStatement)}</div>` : ''}
      </div>`;
    }

    case 'Action': {
      const evUrl = d.evidenceDetailUrl;
      const evType = evUrl ? evUrl.split('/')[4] : 'action';
      const evId   = evUrl ? evUrl.split('/')[5] : d.actionId;
      return `<div class="card">
        <div class="card-header">
          <div class="card-title">${esc(d.text)}</div>
          <div class="btn-actions">
            <button class="btn-evidence" onclick="showEvidence('${esc(evType)}','${esc(evId)}','Action evidence')">Evidence</button>
            <button class="btn-feedback" onclick="openFeedback('action','${esc(d.actionId)}','${esc((d.text||'').substring(0,40))}...')">Feedback</button>
          </div>
        </div>
        <div class="card-meta">
          Owner: ${renderMaybeExtracted(d.owner)} ·
          ${esc(d.meetingSubject || d.meetingId)} ·
          Due: ${renderMaybeExtracted(d.dueDate)} ·
          <span class="badge ${d.status === 'open' ? 'badge-warning' : 'badge-pass'}">${esc(d.status)}</span>
        </div>
        ${d.topicStatement && !notExtracted(d.topicStatement) ? `<div style="font-size:12px;color:var(--color-text-muted);margin-top:4px;">Topic: ${esc(d.topicStatement)}</div>` : ''}
      </div>`;
    }

    case 'Risk':
      return `<div class="card" style="border-left:3px solid var(--color-risk);">
        <div class="card-header">
          <div class="card-title">${esc(d.riskText)}</div>
          <div class="btn-actions">
            <button class="btn-evidence" onclick="showEvidence('topic','${esc(d.topicId)}','Risk evidence')">Evidence</button>
            <button class="btn-feedback" onclick="openFeedback('topic','${esc(d.topicId)}','Risk: ${esc((d.riskText||'').substring(0,30))}...')">Feedback</button>
          </div>
        </div>
        <div class="card-meta">Owner: ${renderMaybeExtracted(d.owner)} · Meeting: ${esc(d.meetingId)}</div>
        <div style="font-size:12px;color:var(--color-text-muted);margin-top:4px;">${esc(d.topicStatement)}</div>
        <div style="margin-top:6px;font-size:11px;color:var(--color-text-muted);font-style:italic;">${esc(d.evidenceLabel)}</div>
      </div>`;

    case 'Topic Memory': {
      const isPending = d.matchStatus === 'pending_review';
      return `<div class="card" style="position:relative;">
        ${isPending ? '<span class="badge badge-pending" style="position:absolute;top:12px;right:12px;">⚡ Pending review</span>' : ''}
        <div class="card-header">
          <div>
            <div class="card-title">${esc(d.canonicalStatement)}</div>
            <div class="card-meta">[${esc(d.entityType)}] ${esc(d.entity)}</div>
          </div>
          <div class="btn-actions">
            <button class="btn-evidence" onclick="showEvidence('memory','${esc(d.memoryId)}','Memory evidence')">Evidence</button>
            <button class="btn-feedback" onclick="openFeedback('memory','${esc(d.memoryId)}','${esc(d.entity)} — ${esc((d.canonicalStatement||'').substring(0,30))}...')">Feedback</button>
          </div>
        </div>
        <div class="card-meta">
          Seen ${d.meetingCount}× · First: ${esc(d.firstSeenDate)} · Last: ${esc(d.lastSeenDate)} ·
          Outcome: ${renderMaybeExtracted(d.latestOutcome)} · Scope: ${renderMaybeExtracted(d.latestExecutiveScope)}
        </div>
        ${isPending && !notExtracted(d.proposedMatchStatement) ? `<div class="validation-warning" style="margin-top:8px;">Proposed match: ${esc(d.proposedMatchStatement)}</div>` : ''}
      </div>`;
    }

    default:
      return '';
  }
}

// ── Overview panel ────────────────────────────────────────

function renderOverview(data) {
  const riskCount = state.risksActions ? state.risksActions.risks.length : 0;

  const statCards = [
    { key: 'meetingCount',           value: data.meetingCount,           label: 'Meetings' },
    { key: 'topicCount',             value: data.topicCount,             label: 'Topics' },
    { key: 'decisionCount',          value: data.decisionCount,          label: 'Decisions' },
    { key: 'openActionCount',        value: data.openActionCount,        label: 'Open Actions' },
    { key: 'topicMemoryCount',       value: data.topicMemoryCount,       label: 'Memory Records' },
    { key: 'pendingReviewCount',     value: data.pendingReviewCount,     label: 'Pending Review' },
    { key: 'validationWarningCount', value: data.validationWarningCount, label: 'Warnings' },
    { key: 'riskCount',              value: riskCount,                   label: 'Risks' },
  ];

  const statsHtml = `<div class="stats-grid" id="stats-grid">
    ${statCards.map(s => `
      <div class="stat-card" role="button" tabindex="0"
        data-stat-key="${esc(s.key)}"
        aria-label="Show ${s.label} in All Content"
        onclick="onStatCardClick('${esc(s.key)}')"
        onkeydown="if(event.key==='Enter'||event.key===' '){onStatCardClick('${esc(s.key)}');event.preventDefault();}">
        <div class="stat-value">${s.value}</div>
        <div class="stat-label">${esc(s.label)} ↗</div>
      </div>`).join('')}
  </div>`;

  // High-signal sections — Risks
  const risks = state.risksActions ? state.risksActions.risks : [];
  const risksHtml = risks.length
    ? `<div class="evidence-proxy-notice">⚠ ${esc(state.risksActions.evidenceProxyNotice)}</div>` +
      risks.map(r => `<div class="card" style="border-left:3px solid var(--color-risk);">
        <div class="card-header">
          <div class="card-title" style="font-size:13px;">${esc(r.riskText)}</div>
          <button class="btn-evidence" onclick="showEvidence('topic','${esc(r.topicId)}','Risk evidence')">Evidence</button>
        </div>
        <div class="card-meta">Owner: ${renderMaybeExtracted(r.owner)} · ${esc(r.meetingId)}</div>
      </div>`).join('')
    : '<div class="empty-state">No risk evidence extracted.</div>';

  // Key decisions
  const decisions = state.decisions ? state.decisions.slice(0,3) : [];
  const decisionsHtml = decisions.length
    ? decisions.map(d => {
        const evUrl = d.evidenceDetailUrl;
        const evType = evUrl ? evUrl.split('/')[4] : 'decision';
        const evId   = evUrl ? evUrl.split('/')[5] : d.decisionId;
        return `<div class="card">
          <div class="card-header">
            <div class="card-title" style="font-size:13px;">${esc(d.text)}</div>
            <button class="btn-evidence" onclick="showEvidence('${esc(evType)}','${esc(evId)}','Decision evidence')">Evidence</button>
          </div>
          <div class="card-meta">
            Owner: ${renderMaybeExtracted(d.owner)} ·
            ${esc(d.meetingSubject || d.meetingId)} ·
            ${d.meetingEventDate ? esc(d.meetingEventDate.substring(0,10)) : ''}
          </div>
        </div>`;
      }).join('')
    : '<div class="empty-state">No decisions extracted.</div>';

  // Open actions
  const actions = state.risksActions ? state.risksActions.actions.filter(a => a.status === 'open').slice(0,3) : [];
  const actionsHtml = actions.length
    ? actions.map(a => `<div class="card">
        <div class="card-meta" style="font-weight:600;margin-bottom:4px;">${esc(a.text)}</div>
        <div class="card-meta">Owner: ${renderMaybeExtracted(a.owner)} · Due: ${renderMaybeExtracted(a.dueDate)}</div>
      </div>`).join('')
    : '<div class="empty-state">No open actions extracted.</div>';

  // Validation warnings
  const warningsHtml = data.validationWarningCount > 0
    ? `<div class="validation-warning">
        ${data.validationWarningCount} item${data.validationWarningCount !== 1 ? 's have' : ' has'} validation warnings.
        <button class="btn-secondary" style="margin-left:8px;font-size:11px;" onclick="switchToAllContent('Topic','warning')">Review →</button>
      </div>`
    : '<div class="card-meta">No validation warnings.</div>';

  // Pending memory review
  const pending = state.topicMemory ? state.topicMemory.filter(m => m.matchStatus === 'pending_review') : [];
  const pendingHtml = pending.length
    ? pending.map(m => `<div class="card">
        <span class="badge badge-pending" style="margin-bottom:6px;">⚡ Pending review</span>
        <div class="card-title" style="font-size:13px;">${esc(m.canonicalStatement)}</div>
        <div class="card-meta">[${esc(m.entityType)}] ${esc(m.entity)}</div>
        ${!notExtracted(m.proposedMatchStatement) ? `<div class="validation-warning" style="margin-top:6px;font-size:11px;">Proposed match: ${esc(m.proposedMatchStatement)}</div>` : ''}
      </div>`).join('')
    : '<div class="card-meta">No pending reviews.</div>';

  // Data gaps
  const gaps = [];
  if (state.decisions) {
    state.decisions.forEach(d => { if (notExtracted(d.owner)) gaps.push(`Decision — owner not extracted`); });
  }
  if (state.risksActions) {
    state.risksActions.actions.forEach(a => {
      if (notExtracted(a.owner)) gaps.push(`Action — owner not extracted`);
      if (notExtracted(a.dueDate)) gaps.push(`Action — due date not extracted`);
    });
    state.risksActions.risks.forEach(r => { if (notExtracted(r.owner)) gaps.push(`Risk — owner not extracted`); });
  }
  const gapsHtml = gaps.length
    ? `<ul style="list-style:none;padding:0;">${gaps.slice(0,6).map(g => `<li class="data-gap" style="padding:4px 0;border-bottom:1px solid var(--color-border);">${esc(g)}</li>`).join('')}</ul>`
    : '<div class="card-meta">No data gaps identified.</div>';

  el('panel-overview').innerHTML = `
    <h2 class="section-title">Overview <span style="font-size:12px;font-weight:400;color:var(--color-text-muted);">— select a card to explore All Content</span></h2>
    ${statsHtml}

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:20px;" class="overview-grid">
      <div>
        <h3 class="section-title">Risks</h3>${risksHtml}
        <h3 class="section-title" style="margin-top:16px;">Key Decisions</h3>${decisionsHtml}
      </div>
      <div>
        <h3 class="section-title">Open Actions</h3>${actionsHtml}
        <h3 class="section-title" style="margin-top:16px;">Validation Warnings</h3>${warningsHtml}
        <h3 class="section-title" style="margin-top:16px;">Pending Memory Review</h3>${pendingHtml}
        <h3 class="section-title" style="margin-top:16px;">Data Gaps</h3>${gapsHtml}
      </div>
    </div>`;
}

function onStatCardClick(key) {
  const mapping = OVERVIEW_CARD_MAP[key];
  if (!mapping) return;
  switchToAllContent(mapping.type, mapping.state);
}

// ── Filter wiring ─────────────────────────────────────────

function clearFilters() {
  state.filters = { type: '', meeting: '', domain: '', entityFamily: '', keyword: '' };
  state._stateFilter = null;
  if (el('filter-type')) el('filter-type').value = '';
  if (el('filter-meeting')) el('filter-meeting').value = '';
  if (el('filter-domain')) el('filter-domain').value = '';
  if (el('filter-entity-family')) el('filter-entity-family').value = '';
  if (el('filter-keyword')) el('filter-keyword').value = '';
  renderAllContent();
}

function initFilters() {
  ['filter-type','filter-meeting','filter-domain','filter-entity-family'].forEach(id => {
    const sel = el(id);
    if (!sel) return;
    sel.addEventListener('change', () => {
      const key = {
        'filter-type': 'type',
        'filter-meeting': 'meeting',
        'filter-domain': 'domain',
        'filter-entity-family': 'entityFamily',
      }[id];
      state.filters[key] = sel.value;
      state._stateFilter = null; // clear deep-link state filter when user manually filters
      renderAllContent();
    });
  });

  const kw = el('filter-keyword');
  if (kw) {
    let kwTimer;
    kw.addEventListener('input', () => {
      clearTimeout(kwTimer);
      kwTimer = setTimeout(() => {
        state.filters.keyword = kw.value;
        state._stateFilter = null;
        renderAllContent();
      }, 250);
    });
  }

  const clearBtn = el('filter-clear');
  if (clearBtn) clearBtn.addEventListener('click', clearFilters);
}

// ── Evidence modal ────────────────────────────────────────

async function showEvidence(itemType, itemId, label) {
  const modal = el('evidence-modal');
  const body = el('evidence-modal-body');
  el('evidence-modal-title').textContent = `Evidence — ${label}`;
  body.innerHTML = '<div class="loading">Loading evidence...</div>';
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');

  try {
    const data = await apiFetch(`/api/v1/evidence/${itemType}/${itemId}`);
    const warnings = data.validationWarnings && data.validationWarnings.length
      ? `<div class="validation-warning"><strong>Validation warnings:</strong><ul>${data.validationWarnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>`
      : '';
    const gaps = data.dataGaps && data.dataGaps.length
      ? `<div class="validation-warning"><strong>Data gaps:</strong> ${data.dataGaps.map(esc).join(', ')}</div>`
      : '';
    const section = (title, items) => {
      if (!items || !items.length) return '';
      return `<div class="modal-section">
        <div class="modal-section-title">${title}</div>
        <ul class="assertion-list">${items.map(a => `<li>${esc(a.text)}</li>`).join('')}</ul>
      </div>`;
    };
    body.innerHTML = `
      <div class="card-meta" style="margin-bottom:12px;">${esc(data.meetingSubject)} · ${esc((data.eventDate||'').substring(0,10))}</div>
      ${warnings}${gaps}
      ${section('Key Facts', data.keyFacts)}
      ${section('Decisions', data.decisions)}
      ${section('Actions', data.actions)}
      ${section('Risks', data.risks)}
      ${!data.keyFacts.length && !data.decisions.length && !data.actions.length && !data.risks.length
        ? '<div class="empty-state">No evidence assertions extracted for this item.</div>' : ''}`;
  } catch (err) {
    body.innerHTML = `<div class="error-msg">Could not load evidence: ${esc(err.message)}</div>`;
  }
}

function closeEvidence() {
  const modal = el('evidence-modal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

// ── Feedback ──────────────────────────────────────────────

function openFeedback(itemType, itemId, itemLabel) {
  state.feedbackTarget = { itemType, itemId, itemLabel };
  el('feedback-target-label').textContent = itemLabel || `${itemType}/${itemId}`;
  el('feedback-verdict').value = '';
  el('feedback-field').value = '';
  el('feedback-notes').value = '';
  el('feedback-error').textContent = '';
  // Enable Save — target is now set
  const saveBtn = el('feedback-save');
  saveBtn.disabled = false;
  saveBtn.removeAttribute('aria-disabled');
  // Open panel
  state.feedbackPanelOpen = true;
  el('feedback-panel').classList.add('open');
  el('feedback-panel').setAttribute('aria-hidden', 'false');
  el('feedback-toggle').setAttribute('aria-expanded', 'true');
}

function closeFeedback() {
  state.feedbackPanelOpen = false;
  state.feedbackTarget = null;
  // Disable Save — no target
  const saveBtn = el('feedback-save');
  saveBtn.disabled = true;
  saveBtn.setAttribute('aria-disabled', 'true');
  el('feedback-panel').classList.remove('open');
  el('feedback-panel').setAttribute('aria-hidden', 'true');
  el('feedback-toggle').setAttribute('aria-expanded', 'false');
}

function saveFeedback() {
  const errorEl = el('feedback-error');

  // Guard: no target selected (panel opened via toggle without item selection)
  if (!state.feedbackTarget) {
    errorEl.textContent = 'No item selected — use an item-level Feedback button first';
    return;
  }

  const verdict = el('feedback-verdict').value;
  const field = el('feedback-field').value;
  const notes = el('feedback-notes').value.trim();

  if (!verdict) { errorEl.textContent = 'Please select a verdict.'; return; }
  if (!field) { errorEl.textContent = 'Please select an affected field.'; return; }
  if (!notes) { errorEl.textContent = 'Please enter notes.'; return; }
  errorEl.textContent = '';

  state.feedback.push({
    itemType: state.feedbackTarget.itemType,
    itemId: state.feedbackTarget.itemId,
    verdict,
    affectedField: field,
    notes,
    createdAt: new Date().toISOString(),
  });

  renderFeedbackList();
  updateFeedbackCount();
  closeFeedback();
}

function renderFeedbackList() {
  const list = el('feedback-list');
  if (!list) return;
  if (!state.feedback.length) {
    list.innerHTML = '<li style="color:var(--color-text-muted);font-size:12px;">No feedback recorded this session.</li>';
    return;
  }
  list.innerHTML = state.feedback.map(f => `
    <li class="feedback-list-item">
      <div class="feedback-list-item-header">
        <span>${esc(f.itemType)}/${esc(f.itemId)}</span>
        <span class="badge ${f.verdict === 'accurate' ? 'badge-pass' : f.verdict === 'incomplete' ? 'badge-warning' : 'badge-risk'}">${esc(f.verdict)}</span>
      </div>
      <div style="color:var(--color-text-muted);">Field: ${esc(f.affectedField)}</div>
      <div>${esc(f.notes)}</div>
    </li>`).join('');
}

function exportFeedback() {
  if (!state.feedback.length) { alert('No feedback to export.'); return; }
  const blob = new Blob([JSON.stringify(state.feedback, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `eip-cockpit-feedback-${new Date().toISOString().substring(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function resetFeedback() {
  if (!state.feedback.length) return;
  if (!confirm('Reset all session feedback? This cannot be undone.')) return;
  state.feedback = [];
  renderFeedbackList();
  updateFeedbackCount();
}

function updateFeedbackCount() {
  const count = state.feedback.length;
  const countEl = el('feedback-count');
  const toggleEl = el('feedback-toggle-count');
  if (countEl) countEl.textContent = count;
  if (toggleEl) toggleEl.textContent = count ? ` (${count})` : '';
}

// ── Initialisation ────────────────────────────────────────

async function init() {
  initTabs();
  initFilters();

  // Evidence modal
  el('evidence-modal-close').addEventListener('click', closeEvidence);
  el('evidence-modal').addEventListener('click', e => { if (e.target === el('evidence-modal')) closeEvidence(); });

  // Keyboard: Escape closes modals and feedback panel
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeEvidence(); closeFeedback(); }
  });

  // Feedback toggle — open panel without a target; Save remains disabled
  el('feedback-toggle').addEventListener('click', () => {
    if (state.feedbackPanelOpen) {
      closeFeedback();
    } else {
      // Open panel but do NOT set a target — Save stays disabled
      state.feedbackPanelOpen = true;
      el('feedback-panel').classList.add('open');
      el('feedback-panel').setAttribute('aria-hidden', 'false');
      el('feedback-toggle').setAttribute('aria-expanded', 'true');
      // Ensure Save is disabled (no target)
      const saveBtn = el('feedback-save');
      saveBtn.disabled = true;
      saveBtn.setAttribute('aria-disabled', 'true');
    }
  });

  el('feedback-panel-close').addEventListener('click', closeFeedback);
  el('feedback-save').addEventListener('click', saveFeedback);
  el('feedback-export').addEventListener('click', exportFeedback);
  el('feedback-reset').addEventListener('click', resetFeedback);

  renderFeedbackList();
  updateFeedbackCount();

  // Load all data in parallel
  try {
    const [overview, decisions, risksActions, topicMemory, topics] = await Promise.all([
      apiFetch('/api/v1/overview'),
      apiFetch('/api/v1/decisions'),
      apiFetch('/api/v1/risks-actions'),
      apiFetch('/api/v1/topic-memory'),
      apiFetch('/api/v1/topics'),
    ]);

    state.overview = overview;
    state.decisions = decisions;
    state.risksActions = risksActions;
    state.topicMemory = topicMemory;
    state.topics = topics;

    populateFilterOptions();
    renderOverview(overview);
    renderAllContent();
  } catch (err) {
    el('overview-loading').className = 'error-msg';
    el('overview-loading').textContent = `Failed to load cockpit data: ${err.message}`;
  }
}

document.addEventListener('DOMContentLoaded', init);

// Expose globals for jsdom browser tests and debugging.
// These are not used by production consumers — the UI is
// the only consumer of this state machine.
window.state = state;
window.openFeedback = openFeedback;
window.closeFeedback = closeFeedback;
window.switchToAllContent = switchToAllContent;
window.clearFilters = clearFilters;
window.showEvidence = showEvidence;
