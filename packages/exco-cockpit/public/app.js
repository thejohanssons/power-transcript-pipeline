/* ============================================================
   EIP ExCo Cockpit — Client Application
   LOCAL LIVE-DATA POC. All data from /api/v1 endpoints backed by
   production runtime D1 (live, read-only).
   Feedback is persisted server-side to a dedicated isolated D1.
   Approved scope: D1 live data + append-only feedback only.
   R2 is not used in this POC.
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
  reviewQueue: null,
  reviewQueueAudit: false,

  // Feedback (server-side persistent, dedicated D1)
  feedback: [],
  feedbackTarget: null, // { itemType, itemId, itemLabel } | null
  feedbackPanelOpen: false,

  // Filters
  filters: { type: '', meeting: '', domain: '', entityFamily: '', keyword: '', trajectoryScope: '' },
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
  state.filters.trajectoryScope = '';
  // Update filter UI
  if (el('filter-type')) el('filter-type').value = typeFilter || '';
  if (el('filter-meeting')) el('filter-meeting').value = '';
  if (el('filter-domain')) el('filter-domain').value = '';
  if (el('filter-entity-family')) el('filter-entity-family').value = '';
  if (el('filter-keyword')) el('filter-keyword').value = '';
  if (el('filter-trajectory-scope')) el('filter-trajectory-scope').value = '';

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

// A Risk outcome is the canonical topic classification. Extracted risks[] are
// supporting assertions for that topic, except when attached to a non-Risk
// topic, where they are shown as explicitly labelled evidence-only cards.
function deriveRisksFromTopics(topics, meetings) {
  const meetingById = new Map((meetings || []).map(meeting => [meeting.meetingId, meeting]));
  const risks = [];

  (topics || []).forEach(topic => {
    const meeting = meetingById.get(topic.meetingId);
    const base = {
      meetingId: topic.meetingId,
      meetingSubject: meeting?.subject || null,
      meetingEventDate: meeting?.eventDate || null,
      topicId: topic.topicId,
      topicStatement: topic.topicStatement,
      owner: topic.owners && topic.owners.length ? topic.owners[0] : null,
      topicDomain: topic.domain || null,
      topicEntityType: topic.entityType || null,
      topicEntity: topic.entity || null,
      executiveScope: topic.executiveScope || null,
      confidence: topic.confidence || null,
      validation: topic.validation || null,
      updatedAt: topic.updatedAt || topic.createdAt || null,
    };
    const assertions = Array.isArray(topic.risks) ? topic.risks : [];

    if (topic.outcome === 'Risk') {
      risks.push({
        ...base,
        riskId: `topic-risk:${topic.topicId}`,
        kind: 'classified_topic',
        riskText: topic.topicStatement,
        supportingEvidence: assertions,
        evidenceLabel: assertions.length
          ? 'Risk-classified topic — extracted assertions shown as supporting evidence.'
          : 'Risk-classified topic — no separate risk assertions were extracted.',
      });
      return;
    }

    assertions.forEach((assertion, index) => {
      const text = assertion && typeof assertion === 'object' ? assertion.text : assertion;
      if (!text) return;
      const assertionId = assertion && typeof assertion === 'object' && assertion.id ? assertion.id : index;
      risks.push({
        ...base,
        riskId: `risk-evidence:${topic.topicId}:${assertionId}`,
        kind: 'evidence_only',
        riskText: text,
        supportingEvidence: [assertion],
        evidenceLabel: 'Evidence-only risk assertion from a non-Risk topic.',
      });
    });
  });

  return risks;
}

function buildAllItems() {
  const items = [];
  const meetings = state.overview ? state.overview.meetings : [];
  const decisions = state.decisions || [];
  const risks = state.risksActions ? state.risksActions.risks : [];
  const actions = state.risksActions ? state.risksActions.actions : [];
  // Topic Memory results are grouped by canonical root. Merged source
  // observations are attached as branches and never become separate items.
  const allMemories = state.topicMemory || [];
  const rootMemories = allMemories.filter(m => !m.mergedIntoMemoryId && m.matchStatus !== 'merged');
  const branchesByRoot = new Map();
  allMemories.filter(m => m.mergedIntoMemoryId || m.matchStatus === 'merged').forEach(branch => {
    const targetId = branch.mergedIntoMemoryId;
    if (!targetId) return;
    if (!branchesByRoot.has(targetId)) branchesByRoot.set(targetId, []);
    branchesByRoot.get(targetId).push(branch);
  });
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

  // Topic Memory: one All Content item per canonical root. Merged
  // observations are attached to the root as trajectoryBranches.
  rootMemories.forEach(root => {
    const branches = branchesByRoot.get(root.memoryId) || [];
    const observations = [root, ...branches];
    items.push({
      _type: 'Topic Memory',
      _id: root.memoryId,
      _searchText: observations.flatMap(m => [
        m.canonicalStatement, m.entity, m.entityType, m.aspect, m.domain,
        m.latestOutcome, m.proposedMatchStatement,
      ]).filter(s => s && !notExtracted(s)).join(' ').toLowerCase(),
      _meetingId: root.firstSeenMeetingId,
      _lastMeetingId: root.lastSeenMeetingId,
      _meetingIds: observations.flatMap(m => [m.firstSeenMeetingId, m.lastSeenMeetingId]).filter(Boolean),
      _domain: root.domain && root.domain !== 'Not extracted' ? root.domain : null,
      _entityFamily: root.entityType,
      _stateValue: root.matchStatus,
      data: { ...root, trajectoryBranches: branches },
    });
  });

  return items;
}

function applyFilters(items) {
  const { type, meeting, domain, entityFamily, keyword, trajectoryScope } = state.filters;
  const stateFilter = state._stateFilter || null;

  return items.filter(item => {
    if (type && item._type !== type) return false;
    if (trajectoryScope && item._type === 'Topic Memory') {
      const memory = item.data;
      if (trajectoryScope === 'multi_meeting' && memory.meetingCount <= 1) return false;
      if (trajectoryScope === 'standalone' && (memory.meetingCount !== 1 || memory.matchStatus === 'pending_review')) return false;
      if (trajectoryScope === 'pending_review' && memory.matchStatus !== 'pending_review') return false;
    }
    // For Topic Memory items, match if either first OR last meeting ID matches
    if (meeting) {
      if (item._type === 'Topic Memory') {
        const meetingIds = item._meetingIds || [item._meetingId, item._lastMeetingId];
        if (!meetingIds.includes(meeting)) return false;
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
  const memories = state.topicMemory || [];

  // Meeting options
  const meetingSelect = el('filter-meeting');
  meetings.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.meetingId;
    opt.textContent = `${(m.eventDate || '').substring(0,10)} — ${m.subject}`;
    meetingSelect.appendChild(opt);
  });

  // Domain options come from both Topics and Topic Memories.
  const domains = [...new Set([
    ...topics.map(t => t.domain),
    ...memories.map(m => m.domain),
  ].filter(d => d && d !== 'Not extracted'))].sort();
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
  if (state.filters.trajectoryScope) {
    const scopeLabels = { multi_meeting: 'multi-meeting trajectories', standalone: 'standalone one-meeting memories', pending_review: 'pending review memories' };
    active.push(`Trajectory: <span class="filter-active-tag">${esc(scopeLabels[state.filters.trajectoryScope] || state.filters.trajectoryScope)}</span>`);
  }
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

function meetingAggregateCounts(meetingId) {
  const topics = (state.topics || []).filter(topic => topic.meetingId === meetingId);
  const decisions = (state.decisions || []).filter(decision => decision.meetingId === meetingId);
  const actions = (state.risksActions?.actions || []).filter(action => action.meetingId === meetingId);

  return {
    topicCount: topics.length,
    decisionCount: decisions.length,
    actionCount: actions.length,
    validationStatus: topics.some(topic => topic.validation?.status === 'fail')
      ? 'fail'
      : topics.some(topic => topic.validation?.status === 'warning')
        ? 'warning'
        : 'pass',
  };
}

function renderItemCard(item) {
  const type = item._type;
  const d = item.data;

  switch (type) {
    case 'Meeting': {
      const counts = meetingAggregateCounts(d.meetingId);
      return `<div class="card">
        <div class="card-header">
          <div class="card-title">${esc(d.subject)}</div>
          ${validationBadge(counts.validationStatus)}
        </div>
        <div class="card-meta">${esc(d.organiser)} · ${esc((d.eventDate||'').substring(0,10))} · ${counts.topicCount} topics · ${counts.decisionCount} decisions · ${counts.actionCount} actions</div>
      </div>`;
    }

    case 'Topic': {
      const evidenceUrl = `/api/v1/evidence/topic/${d.topicId}`;
      return `<div class="card">
        <div class="card-header">
          <div class="card-title">${esc(d.topicStatement)}</div>
          <div class="btn-actions">
            <button class="btn-evidence" onclick="showEvidence('topic','${esc(d.topicId)}','Topic evidence')">Evidence</button>
            <button class="btn-feedback" onclick="openFeedback('topic','${esc(d.topicId)}','${esc((d.topicStatement||'').substring(0,40))}...','${esc(d.updatedAt||'')}')">Feedback</button>
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
            <button class="btn-feedback" onclick="openFeedback('decision','${esc(d.decisionId)}','${esc((d.text||'').substring(0,40))}...','${esc(d.createdAt||'')}')">Feedback</button>
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
            <button class="btn-feedback" onclick="openFeedback('action','${esc(d.actionId)}','${esc((d.text||'').substring(0,40))}...','${esc(d.createdAt||'')}')">Feedback</button>
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

    case 'Risk': {
      const supportingEvidence = Array.isArray(d.supportingEvidence) ? d.supportingEvidence : [];
      return `<div class="card" style="border-left:3px solid var(--color-risk);">
        <div class="card-header">
          <div class="card-title">${esc(d.riskText)}</div>
          <div class="btn-actions">
            <button class="btn-evidence" onclick="showEvidence('topic','${esc(d.topicId)}','Risk evidence')">Evidence</button>
            <button class="btn-feedback" onclick="openFeedback('topic','${esc(d.topicId)}','Risk: ${esc((d.riskText||'').substring(0,30))}...','${esc(d.updatedAt||'')}')">Feedback</button>
          </div>
        </div>
        <div class="card-meta">Owner: ${renderMaybeExtracted(d.owner)} · ${esc(d.meetingSubject || d.meetingId)}${d.meetingEventDate ? ` · ${esc(d.meetingEventDate.substring(0,10))}` : ''}</div>
        ${d.kind === 'evidence_only' ? `<div style="font-size:12px;color:var(--color-text-muted);margin-top:4px;">Topic: ${esc(d.topicStatement)}</div>` : ''}
        ${supportingEvidence.length ? `<div style="margin-top:8px;font-size:12px;color:var(--color-text-muted);">Supporting evidence:<ul class="assertion-list">${supportingEvidence.map(assertion => `<li>${esc(assertion?.text || String(assertion))}</li>`).join('')}</ul></div>` : ''}
        <div style="margin-top:6px;font-size:11px;color:var(--color-text-muted);font-style:italic;">${esc(d.evidenceLabel)}</div>
      </div>`;
    }

    case 'Topic Memory': {
      const isPending = d.matchStatus === 'pending_review';
      const branches = Array.isArray(d.trajectoryBranches) ? d.trajectoryBranches : [];
      const branchRows = branches.map(branch => `<div style="position:relative;padding:8px 0 8px 22px;border-left:2px solid var(--color-border);margin-left:7px;">
        <span aria-hidden="true" style="position:absolute;left:-7px;top:12px;width:11px;height:11px;border-radius:50%;background:var(--color-surface);border:2px solid var(--color-primary);"></span>
        <strong>Matched and merged source observation</strong>
        <span class="card-meta"> · ${esc(branch.memoryId)} · ${esc(branch.firstSeenDate)} · Meeting: ${esc(branch.firstSeenMeetingId)}</span>
        ${branch.reviewResolvedAt ? `<div class="card-meta">Reviewed: ${esc(branch.reviewResolvedAt)}${branch.reviewEventId ? ` · Audit: ${esc(branch.reviewEventId)}` : ''}</div>` : ''}
        <div style="font-size:12px;margin-top:3px;">${esc(branch.canonicalStatement)}</div>
      </div>`).join('');
      const trajectoryHtml = `<div class="topic-memory-timeline" style="margin-top:12px;padding:10px;border:1px solid var(--color-border);border-radius:6px;">
        <strong>Trajectory observations (${branches.length + 1})</strong>
        <div style="position:relative;margin-top:8px;padding:8px 0 8px 22px;">
          <span aria-hidden="true" style="position:absolute;left:1px;top:12px;width:13px;height:13px;border-radius:50%;background:var(--color-primary);border:2px solid var(--color-primary);"></span>
          <strong>Root observation</strong>
          <span class="card-meta"> · ${esc(d.memoryId)} · ${esc(d.firstSeenDate)} · Meeting: ${esc(d.firstSeenMeetingId)}</span>
        </div>
        ${branchRows}
      </div>`;
      return `<div class="card" style="position:relative;">
        ${isPending ? '<span class="badge badge-pending" style="position:absolute;top:12px;right:12px;">⚡ Pending review</span>' : ''}
        <div class="card-header">
          <div>
            <div class="card-title">${esc(d.canonicalStatement)}</div>
            <div class="card-meta">[${esc(d.entityType)}] ${esc(d.entity)}${d.domain ? ` · Domain: ${esc(d.domain)}` : ''}</div>
          </div>
          <div class="btn-actions">
            <button class="btn-evidence" onclick="showEvidence('memory','${esc(d.memoryId)}','Memory evidence')">Evidence</button>
            <button class="btn-feedback" onclick="openFeedback('memory','${esc(d.memoryId)}','${esc(d.entity)} — ${esc((d.canonicalStatement||'').substring(0,30))}...','${esc(d.updatedAt||'')}')">Feedback</button>
          </div>
        </div>
        <div class="card-meta">
          ${d.matchStatus === 'pending_review' ? 'Pending match · 1 meeting' : (d.meetingCount === 1 ? 'Standalone memory · 1 meeting' : `Active trajectory · ${d.meetingCount} meetings`)} · First: ${esc(d.firstSeenDate)} · Last: ${esc(d.lastSeenDate)} ·
          Latest classification: ${renderMaybeExtracted(d.latestOutcome)} · Status: ${esc(d.status || 'open')} · Match: ${esc(d.matchStatus)}
        </div>
        <div style="font-size:12px;color:var(--color-text-muted);margin-top:4px;">
          Disposition: ${renderMaybeExtracted(d.latestDisposition)} · Scope: ${renderMaybeExtracted(d.latestExecutiveScope)}
        </div>
        ${d.reviewResolvedAt ? `<div style="font-size:11px;color:var(--color-text-muted);margin-top:4px;">Reviewed: ${esc(d.reviewResolvedAt)}${d.reviewEventId ? ` · Audit: ${esc(d.reviewEventId)}` : ''}</div>` : ''}
        ${branches.length ? trajectoryHtml : ''}
        ${isPending && !notExtracted(d.proposedMatchStatement) ? `<div class="validation-warning" style="margin-top:8px;">Proposed match: ${esc(d.proposedMatchStatement)}</div>` : ''}
      </div>`;
    }

    default:
      return '';
  }
}

// ── Overview panel ────────────────────────────────────────

// ── Reviewer name — localStorage persistence ──────────────
const REVIEWER_NAME_KEY = 'eip-cockpit-reviewer-name';

function getReviewerName() {
  return localStorage.getItem(REVIEWER_NAME_KEY) || '';
}

function setReviewerName(name) {
  localStorage.setItem(REVIEWER_NAME_KEY, name.trim());
  ['feedback-reviewer-name', 'pending-reviewer-name'].forEach(id => {
    const inp = el(id);
    if (inp && inp.value !== name.trim()) inp.value = name.trim();
  });
}

function initReviewerNameInputs() {
  const saved = getReviewerName();
  ['feedback-reviewer-name', 'pending-reviewer-name'].forEach(id => {
    const inp = el(id);
    if (!inp) return;
    if (saved) inp.value = saved;
    inp.addEventListener('input', () => setReviewerName(inp.value));
    inp.addEventListener('change', () => setReviewerName(inp.value));
  });
}

// ── Pending Review tab ────────────────────────────────────

// ── Match decision quick-submit (no modal) ───────────────

function handleMatchClick(btn) {
  if (btn.disabled) return;
  const memoryId    = btn.dataset.memoryId;
  const topicId     = btn.dataset.topicId || '';
  const memoryUpdatedAt = btn.dataset.memoryUpdated || '';
  const topicUpdatedAt  = btn.dataset.topicUpdated || '';
  const decision    = btn.dataset.decision;
  const reviewerName = getReviewerName();
  submitMatchDecision(memoryId, topicId, decision, memoryUpdatedAt, topicUpdatedAt, reviewerName);
}

async function submitMatchDecision(memoryId, topicId, decision, memoryUpdatedAt, topicUpdatedAt, reviewerName) {
  const noteInput = el('pending-decision-note');
  const acknowledgement = el('pending-decision-warning');
  const note = noteInput?.value?.trim() || '';
  if (!reviewerName || !reviewerName.trim()) {
    alert('Please enter your reviewer name before recording a runtime decision.');
    return;
  }
  if (!note) {
    alert('Please enter a non-empty decision note.');
    noteInput?.focus();
    return;
  }
  if (!acknowledgement?.checked) {
    alert('Please acknowledge permanent retention before recording a runtime decision.');
    return;
  }
  const approve = decision === 'match';
  const outcome = approve ? 'approve this match and merge the candidate trajectory into the existing thread' : 'reject this match and keep the candidate as a separate confirmed memory';
  if (!window.confirm(`Confirm runtime decision: ${outcome}?`)) return;

  const buttons = document.querySelectorAll(`#match-card-${memoryId} .match-actions button`);
  buttons.forEach(button => { button.disabled = true; button.setAttribute('aria-disabled', 'true'); });
  const status = el('pending-decision-status');
  if (status) { status.textContent = 'Applying runtime decision…'; status.className = 'loading'; }

  try {
    const response = await fetch(`/api/v1/review-queue/memory/${encodeURIComponent(memoryId)}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decision: approve ? 'approve_match' : 'reject_match',
        expectedSourceVersion: memoryUpdatedAt,
        expectedProposedMatchMemoryId: (document.querySelector(`#match-card-${memoryId} [data-expected-target]`))?.dataset.expectedTarget || '',
        reviewerName: reviewerName.trim(),
        note,
        warningAcknowledged: true,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 409) {
      await refreshReviewQueue();
      throw new Error(result.error || 'The candidate changed. The queue was refreshed; reassess the current data.');
    }
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    await refreshLiveSnapshot();
    if (status) { status.textContent = `${approve ? 'Approve match and merge' : 'Reject match and keep separate'} applied. Audit event: ${result.data?.auditEventId || result.auditEventId}`; status.className = 'success'; }
  } catch (e) {
    buttons.forEach(button => { button.disabled = false; button.removeAttribute('aria-disabled'); });
    if (status) { status.textContent = `Runtime decision failed: ${e.message}`; status.className = 'error-msg'; }
    alert(`Failed to apply runtime decision: ${e.message}`);
  }
}

function renderPendingReview() {
  const container = el('pending-review-content');
  if (!container) return;

  const proposedMatches = (state.topicMemory || []).filter(m => m.matchStatus === 'pending_review');

  // Update tab badge
  const badge = el('tab-pending-count');
  if (badge) badge.textContent = proposedMatches.length ? `(${proposedMatches.length})` : '';

  // ── Section: Proposed matches (with matching topic details) ─
  const proposedMatchesHtml = proposedMatches.length
    ? proposedMatches.map(m => {
        // Find the topic(s) from the same meeting that share entity+aspect
        // The memory record represents the new observation; find the source topic
        const sourceTopic = (state.topics || []).find(t =>
          t.meetingId === m.lastSeenMeetingId &&
          t.entity === m.entity &&
          t.entityType === m.entityType
        );

        // Find the target memory record (what it's proposed to merge into)
        const targetMemory = (state.topicMemory || []).find(x => x.memoryId === m.proposedMatchMemoryId);

        const safeId = `match-card-${m.memoryId}`;
        return `
          <div class="card" id="${esc(safeId)}" style="margin-bottom:16px;padding:0;overflow:hidden;">

            <!-- Proposed match context header -->
            <div style="background:var(--color-info-bg,#eff6ff);border-bottom:1px solid var(--color-border);padding:10px 14px;">
              <span class="badge" style="background:var(--color-info,#3b82f6);color:#fff;margin-bottom:4px;">⚡ Proposed addition to existing thread</span>
              <div style="font-size:12px;font-weight:600;margin-top:4px;">${esc(m.entity)} — ${esc(m.entityType)}</div>
              ${m.proposedMatchReason
                ? `<div style="font-size:11px;color:var(--color-text-muted);margin-top:2px;">${esc(m.proposedMatchReason)}</div>`
                : ''}
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border-bottom:1px solid var(--color-border);">

              <!-- New topic -->
              <div style="padding:12px 14px;border-right:1px solid var(--color-border);">
                <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--color-warning,#f59e0b);margin-bottom:6px;">🆕 New observation</div>
                <div style="font-size:12px;font-weight:600;">${esc(m.canonicalStatement)}</div>
                <div class="card-meta" style="margin-top:4px;font-size:11px;">
                  Outcome: ${esc(m.latestOutcome||'?')} · ${esc(m.latestDisposition||'?')} · ${esc(m.latestExecutiveScope||'?')}
                </div>
                <div class="card-meta" style="font-size:11px;">Meeting: ${esc(m.lastSeenMeetingId||'?')}</div>
                ${sourceTopic ? `
                  <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--color-border);">
                    <div style="font-size:11px;color:var(--color-text-muted);margin-bottom:4px;">Source topic:</div>
                    <div style="font-size:12px;">${esc(sourceTopic.topicStatement)}</div>
                    ${sourceTopic.keyFacts?.length ? `<ul style="margin:4px 0 0 16px;padding:0;font-size:11px;">${sourceTopic.keyFacts.slice(0,3).map(f=>`<li>${esc(f.text||f)}</li>`).join('')}</ul>` : ''}
                  </div>` : ''}
              </div>

              <!-- Existing memory thread -->
              <div style="padding:12px 14px;">
                <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--color-info,#3b82f6);margin-bottom:6px;">📚 Existing thread</div>
                ${targetMemory ? (() => {
                  // Find most recent topic from the existing thread's last-seen meeting
                  const threadTopic = (state.topics || []).find(t =>
                    t.meetingId === targetMemory.lastSeenMeetingId &&
                    t.entity === targetMemory.entity &&
                    t.entityType === targetMemory.entityType
                  );
                  const sectionHtml = (title, items) => {
                    if (!items || !items.length) return '';
                    return `<div style="margin-top:6px;">
                      <div style="font-size:11px;font-weight:600;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px;">${esc(title)}</div>
                      <ul style="margin:0;padding-left:16px;font-size:11px;">
                        ${items.map(a => `<li>${esc(a.text || String(a))}</li>`).join('')}
                      </ul>
                    </div>`;
                  };
                  return `
                    <div style="font-size:12px;font-weight:600;">${esc(targetMemory.canonicalStatement)}</div>
                    <div class="card-meta" style="margin-top:4px;">
                      <strong>[${esc(targetMemory.entityType||'?')}]</strong> ${esc(targetMemory.entity||'?')}
                      ${targetMemory.aspect ? `· <em>${esc(targetMemory.aspect)}</em>` : ''}
                      · ${esc(targetMemory.domain||'?')}
                    </div>
                    <div class="card-meta" style="font-size:11px;margin-top:2px;">
                      Outcome: ${esc(targetMemory.latestOutcome||'?')} · ${esc(targetMemory.latestDisposition||'?')} · ${esc(targetMemory.latestExecutiveScope||'?')}
                    </div>
                    <div class="card-meta" style="font-size:11px;margin-top:2px;">
                      Seen ${targetMemory.meetingCount} time${targetMemory.meetingCount !== 1 ? 's' : ''}
                      · First: ${esc((targetMemory.firstSeenDate||'').substring(0,10))}
                      · Last: ${esc((targetMemory.lastSeenDate||'').substring(0,10))}
                      · Status: ${esc(targetMemory.status||'?')}
                    </div>
                    ${threadTopic ? `
                      <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--color-border);">
                        <div style="font-size:11px;color:var(--color-text-muted);margin-bottom:4px;">Last seen topic (${esc(targetMemory.lastSeenMeetingId||'')}):</div>
                        <div style="font-size:12px;">${esc(threadTopic.topicStatement)}</div>
                        ${sectionHtml('Key Facts', threadTopic.keyFacts)}
                        ${sectionHtml('Decisions', threadTopic.decisions)}
                        ${sectionHtml('Actions', threadTopic.actions)}
                        ${sectionHtml('Risks', threadTopic.risks)}
                      </div>` : `
                      <div style="margin-top:8px;font-size:11px;color:var(--color-text-muted);">
                        Last seen meeting: ${esc(targetMemory.lastSeenMeetingId||'?')}<br/>
                        (Topic not in current 200-record page)
                      </div>`}`;
                })()
                : `<div style="font-size:12px;color:var(--color-text-muted);">Target: <code style="font-size:10px;">${esc(m.proposedMatchMemoryId||'?')}</code><br/><span style="font-size:11px;">Not in current memory page (500 limit)</span></div>`}
              </div>
            </div>

            <!-- Match / No match actions -->
            <div class="match-actions" style="padding:10px 14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;background:var(--color-bg,#f9fafb);border-top:1px solid var(--color-border);">
              <button class="btn-primary" style="font-size:12px;background:var(--color-pass,#16a34a);border-color:var(--color-pass,#16a34a);"
                data-memory-id="${esc(m.memoryId)}"
                data-topic-id="${esc(sourceTopic?.topicId||'')}"
                data-memory-updated="${esc(m.updatedAt||'')}"
                data-topic-updated="${esc(sourceTopic?.updatedAt||'')}"
                data-expected-target="${esc(m.proposedMatchMemoryId||'')}"
                data-decision="match"
                onclick="handleMatchClick(this)">
                ✓ Match
              </button>
              <button class="btn-secondary" style="font-size:12px;color:var(--color-risk,#dc2626);border-color:var(--color-risk,#dc2626);"
                data-memory-id="${esc(m.memoryId)}"
                data-topic-id="${esc(sourceTopic?.topicId||'')}"
                data-memory-updated="${esc(m.updatedAt||'')}"
                data-topic-updated="${esc(sourceTopic?.updatedAt||'')}"
                data-expected-target="${esc(m.proposedMatchMemoryId||'')}"
                data-decision="no-match"
                onclick="handleMatchClick(this)">
                ✗ No match
              </button>
              <button class="btn-feedback" style="font-size:11px;margin-left:auto;"
                onclick="openFeedback('memory','${esc(m.memoryId)}','${esc(m.entity)} — match review','${esc(m.updatedAt||'')}')">
                Add note
              </button>
            </div>
          </div>`;
      }).join('')
    : '<div class="empty-state">No proposed matches awaiting review.</div>';

  container.innerHTML = `
    <div style="padding:16px 0;">
      <h2 class="section-title">
        Pending Memory Review
        <span style="font-size:13px;font-weight:400;color:var(--color-text-muted);">
          — ${proposedMatches.length} proposed match${proposedMatches.length !== 1 ? 'es' : ''} awaiting decision
        </span>
      </h2>

      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;padding:10px 14px;background:var(--color-bg,#f9fafb);border:1px solid var(--color-border);border-radius:6px;">
        <label style="font-size:12px;font-weight:600;white-space:nowrap;" for="pending-reviewer-name">Your name:</label>
        <input id="pending-reviewer-name" type="text"
          placeholder="Required before recording Match / No match"
          style="flex:1;padding:5px 10px;border:1px solid var(--color-border);border-radius:4px;font-size:12px;" />
        <span style="font-size:11px;color:var(--color-text-muted);">Runtime decisions change the live memory state and are permanently audited.</span>
      </div>
      <div style="margin-bottom:12px;display:grid;gap:8px;">
        <label for="pending-decision-note" style="font-size:12px;font-weight:600;">Decision note <span aria-hidden="true">*</span></label>
        <textarea id="pending-decision-note" rows="2" placeholder="Explain why this match should be merged or kept separate. Do not paste transcript text." style="width:100%;padding:7px 10px;border:1px solid var(--color-border);border-radius:4px;font-size:12px;"></textarea>
        <label style="font-size:11px;color:var(--color-text-muted);display:flex;gap:7px;align-items:flex-start;">
          <input id="pending-decision-warning" type="checkbox" aria-required="true" />
          <span>I acknowledge this note is permanently retained and contains no raw transcript or sensitive source material.</span>
        </label>
        <div id="pending-decision-status" role="status" aria-live="polite" style="min-height:16px;font-size:12px;"></div>
      </div>

      <p style="font-size:12px;color:var(--color-text-muted);margin-bottom:16px;">
        For each proposed match: review the new observation (left) against the existing memory thread (right),
        then record <strong>Match</strong> (merges the candidate trajectory into the existing thread) or <strong>No match</strong>
        (keeps the candidate as a separate confirmed memory). Decisions mutate runtime state and are retained in the authoritative audit log.
      </p>

      ${proposedMatchesHtml || '<div class="empty-state">No proposed matches awaiting review.</div>'}
    </div>`;
}

function reviewDispositionHtml(disposition) {
  if (!disposition) return '';
  return `<div class="card-meta" style="margin-top:8px;">
    Reviewer: ${esc(disposition.reviewerName)} · Verdict: <strong>${esc(disposition.verdict)}</strong><br/>
    Field: ${esc(disposition.affectedField)} · Recorded: ${esc(disposition.createdAt)}
    ${disposition.correctsFeedbackId ? `<br/>Correction of: ${esc(disposition.correctsFeedbackId)}` : ''}
  </div>`;
}

function renderReviewQueue() {
  const queue = state.reviewQueue;
  const container = el('review-queue-content');
  if (!container) return;
  if (!queue) {
    container.innerHTML = '<div class="loading">Loading review queue…</div>';
    return;
  }
  const awaiting = queue.awaitingReview || [];
  const recorded = queue.recordedDecisions || [];
  const card = item => `<div class="card" style="margin-bottom:8px;">
    <div class="card-title" style="font-size:13px;">${esc(item.title)}</div>
    <div class="card-meta">[${esc(item.entityType || '?')}] ${esc(item.entity || '?')}${item.aspect ? ` · ${esc(item.aspect)}` : ''}</div>
    ${item.summary ? `<div style="font-size:12px;margin-top:5px;">${esc(item.summary)}</div>` : ''}
    ${item.proposedMatchMemoryId ? `<div class="validation-warning" style="margin-top:6px;font-size:11px;">Proposed match: ${esc(item.proposedMatchMemoryId)}${item.proposedMatchReason ? ` — ${esc(item.proposedMatchReason)}` : ''}</div>` : ''}
    <div class="card-meta" style="margin-top:6px;">Source version: ${esc(item.sourceVersion)}</div>
    ${item.disposition ? reviewDispositionHtml(item.disposition) : `<button class="btn-feedback" style="margin-top:8px;font-size:11px;" onclick="openFeedback('memory','${esc(item.itemId)}','${esc(item.title)}','${esc(item.sourceVersion)}')">Give feedback</button>`}
  </div>`;
  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
      <div><strong>${awaiting.length}</strong> awaiting review</div>
      <label style="font-size:12px;display:flex;align-items:center;gap:6px;cursor:pointer;">
        <input type="checkbox" id="review-queue-audit-toggle" ${state.reviewQueueAudit ? 'checked' : ''} aria-controls="review-queue-recorded" />
        Show recorded decisions (audit)
      </label>
    </div>
    <div style="margin-top:10px;">${awaiting.length ? awaiting.map(card).join('') : '<div class="empty-state">No candidates awaiting review.</div>'}</div>
    <div id="review-queue-recorded" ${state.reviewQueueAudit ? '' : 'hidden'} style="margin-top:14px;padding-top:10px;border-top:1px solid var(--color-border);">
      <h4 style="margin:0 0 8px;">Recorded decisions (${recorded.length})</h4>
      ${recorded.length ? recorded.map(card).join('') : '<div class="empty-state">No recorded decisions.</div>'}
      <p class="card-meta">Recorded decisions are audit history only and do not alter runtime state.</p>
    </div>`;
  const toggle = el('review-queue-audit-toggle');
  if (toggle) toggle.addEventListener('change', () => { state.reviewQueueAudit = toggle.checked; renderReviewQueue(); });
}

async function refreshLiveSnapshot() {
  const [overview, decisions, risksActions, topicMemory, topics, reviewQueue] = await Promise.all([
    apiFetch('/api/v1/overview'),
    apiFetch('/api/v1/decisions'),
    apiFetch('/api/v1/risks-actions'),
    apiFetch('/api/v1/topic-memory'),
    apiFetch('/api/v1/topics'),
    apiFetch('/api/v1/review-queue'),
  ]);
  state.overview = overview;
  state.decisions = decisions;
  state.topicMemory = topicMemory;
  state.topics = topics;
  state.reviewQueue = reviewQueue;
  state.risksActions = {
    actions: Array.isArray(risksActions) ? risksActions : (risksActions?.actions || []),
    risks: deriveRisksFromTopics(topics, overview?.meetings),
    evidenceProxyNotice: 'Risk-classified topics are shown once; assertions on non-Risk topics are evidence-only, not a governed risk register.',
  };
  populateFilterOptions();
  renderOverview(overview);
  renderReviewQueue();
  renderPendingReview();
  initReviewerNameInputs();
  renderAllContent();
}

async function refreshReviewQueue() {
  try {
    await refreshLiveSnapshot();
  } catch (error) {
    const container = el('review-queue-content');
    if (container) container.innerHTML = `<div class="error-msg">Review queue unavailable: ${esc(error.message)}</div>`;
  }
}

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
        <div class="card-meta">Owner: ${renderMaybeExtracted(r.owner)} · ${esc(r.meetingSubject || r.meetingId)}</div>
        ${r.supportingEvidence?.length ? `<div style="font-size:11px;color:var(--color-text-muted);margin-top:4px;">${r.supportingEvidence.length} supporting risk assertion${r.supportingEvidence.length === 1 ? '' : 's'}</div>` : ''}
      </div>`).join('')
    : '<div class="empty-state">No risk-classified topics or evidence-only risk assertions.</div>';

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

  // ── Pending review — two categories ─────────────────────
  // 1. New topics: topics with no memoryId (not yet linked to any memory thread)
  // 2. Proposed match: memory records with matchStatus === 'pending_review'
  //    (pipeline thinks this topic extends an existing thread, needs confirmation)

  const newTopics = (state.topics || []).filter(t => !t.memoryId);
  const proposedMatches = (state.topicMemory || []).filter(m => m.matchStatus === 'pending_review');
  const SHOW_NEW = 5;

  const newTopicsHtml = newTopics.length
    ? `<div style="font-size:11px;color:var(--color-text-muted);margin-bottom:6px;">
        ${newTopics.length} topic${newTopics.length !== 1 ? 's' : ''} not yet linked to a memory thread
       </div>` +
      newTopics.slice(0, SHOW_NEW).map(t => `
        <div class="card" style="border-left:3px solid var(--color-warning,#f59e0b);margin-bottom:6px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
            <div>
              <span class="badge" style="background:var(--color-warning,#f59e0b);color:#fff;margin-bottom:4px;">🆕 New topic</span>
              <div class="card-title" style="font-size:12px;">${esc(t.topicStatement)}</div>
              <div class="card-meta">[${esc(t.entityType||'?')}] ${esc(t.entity||'?')} · ${esc(t.domain||'?')}</div>
              <div class="card-meta" style="font-size:11px;">${esc(t.meetingId)}</div>
            </div>
            <button class="btn-feedback" style="flex-shrink:0;"
              onclick="openFeedback('topic','${esc(t.topicId)}','${esc((t.topicStatement||'').substring(0,40))}...','${esc(t.updatedAt||'')}')">
              Feedback
            </button>
          </div>
        </div>`).join('') +
      (newTopics.length > SHOW_NEW
        ? `<div style="font-size:11px;color:var(--color-text-muted);margin-top:4px;">
            + ${newTopics.length - SHOW_NEW} more —
            <button class="btn-secondary" style="font-size:11px;" onclick="switchToAllContent('Topic','')">
              View all in All Content →
            </button>
           </div>`
        : '')
    : '<div class="card-meta" style="font-size:12px;">No unlinked topics.</div>';

  const proposedMatchesHtml = proposedMatches.length
    ? proposedMatches.map(m => `
        <div class="card" style="border-left:3px solid var(--color-info,#3b82f6);margin-bottom:6px;">
          <span class="badge" style="background:var(--color-info,#3b82f6);color:#fff;margin-bottom:4px;">⚡ Proposed match</span>
          <div class="card-title" style="font-size:12px;">${esc(m.canonicalStatement)}</div>
          <div class="card-meta">[${esc(m.entityType)}] ${esc(m.entity)} · ${esc(m.domain||'?')}</div>
          ${m.proposedMatchMemoryId
            ? `<div class="validation-warning" style="margin-top:4px;font-size:11px;">
                Proposed match to: <code style="font-size:10px;">${esc(m.proposedMatchMemoryId)}</code>
               </div>
               ${m.proposedMatchReason ? `<div style="font-size:11px;color:var(--color-text-muted);margin-top:2px;">${esc(m.proposedMatchReason)}</div>` : ''}`
            : ''}
          <div style="margin-top:6px;">
            <button class="btn-feedback" style="font-size:11px;"
              onclick="openFeedback('memory','${esc(m.memoryId)}','${esc(m.entity)} — match review','${esc(m.updatedAt||'')}')">
              Feedback
            </button>
          </div>
        </div>`).join('')
    : '<div class="card-meta" style="font-size:12px;">No proposed matches awaiting review.</div>';

  const pendingHtml = `
    <div style="margin-bottom:10px;">
      <div style="font-size:12px;font-weight:600;margin-bottom:6px;color:var(--color-warning,#f59e0b);">
        🆕 New (not yet in memory thread)
      </div>
      ${newTopicsHtml}
    </div>
    <div>
      <div style="font-size:12px;font-weight:600;margin-bottom:6px;color:var(--color-info,#3b82f6);">
        ⚡ Proposed additions to existing thread (${proposedMatches.length})
      </div>
      ${proposedMatchesHtml}
    </div>`;

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
    <section class="card" id="review-queue" aria-labelledby="review-queue-title" style="margin-top:20px;">
      <h3 class="section-title" id="review-queue-title">Review Queue</h3>
      <div id="review-queue-content"></div>
    </section>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:20px;" class="overview-grid">
      <div>
        <h3 class="section-title">Risks</h3>${risksHtml}
        <h3 class="section-title" style="margin-top:16px;">Key Decisions</h3>${decisionsHtml}
      </div>
      <div>
        <h3 class="section-title">Open Actions</h3>${actionsHtml}
        <h3 class="section-title" style="margin-top:16px;">Validation Warnings</h3>${warningsHtml}
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
  state.filters = { type: '', meeting: '', domain: '', entityFamily: '', keyword: '', trajectoryScope: '' };
  state._stateFilter = null;
  if (el('filter-type')) el('filter-type').value = '';
  if (el('filter-meeting')) el('filter-meeting').value = '';
  if (el('filter-domain')) el('filter-domain').value = '';
  if (el('filter-entity-family')) el('filter-entity-family').value = '';
  if (el('filter-keyword')) el('filter-keyword').value = '';
  if (el('filter-trajectory-scope')) el('filter-trajectory-scope').value = '';
  renderAllContent();
}

function initFilters() {
  ['filter-type','filter-trajectory-scope','filter-meeting','filter-domain','filter-entity-family'].forEach(id => {
    const sel = el(id);
    if (!sel) return;
    sel.addEventListener('change', () => {
      const key = {
        'filter-type': 'type',
        'filter-trajectory-scope': 'trajectoryScope',
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

function showEvidence(itemType, itemId, label) {
  // Evidence drill-down via /api/v1/evidence/ is not implemented in this POC.
  // Approved scope: D1 live data + append-only feedback only. R2 is not used in this POC.
  // Topic key-facts, decisions, actions, and risks are available per-topic via
  // the /api/v1/meetings/:id and /api/v1/topics endpoints (already loaded in state).
  // A future production cockpit should implement a dedicated evidence endpoint.
  const modal = el('evidence-modal');
  const body = el('evidence-modal-body');
  el('evidence-modal-title').textContent = `Evidence — ${label}`;

  // Surface the already-loaded D1 data for this item from state
  let content = '';
  if (itemType === 'topic' || itemType === 'memory') {
    const topic = state.topics && state.topics.find
      ? state.topics.find(t => t.topicId === itemId || t.memoryId === itemId)
      : null;
    if (topic) {
      const section = (title, items) => {
        if (!items || !items.length) return '';
        return `<div class="modal-section">
          <div class="modal-section-title">${esc(title)}</div>
          <ul class="assertion-list">${items.map(a => `<li>${esc(a.text || String(a))}</li>`).join('')}</ul>
        </div>`;
      };
      content = `
        <div class="card-meta" style="margin-bottom:12px;">${esc(topic.topicStatement)}</div>
        ${topic.validation?.status ? `<div style="margin-bottom:8px;">${validationBadge(topic.validation.status)}</div>` : ''}
        ${topic.validation?.reasons?.length ? `<div class="validation-warning">Validation: ${topic.validation.reasons.map(esc).join('; ')}</div>` : ''}
        ${section('Key Facts', topic.keyFacts)}
        ${section('Decisions', topic.decisions)}
        ${section('Actions', topic.actions)}
        ${section('Risks', topic.risks)}
        ${!topic.keyFacts?.length && !topic.decisions?.length && !topic.actions?.length && !topic.risks?.length
          ? '<div class="empty-state">No evidence assertions in the D1 record for this item.</div>' : ''}`;
    } else {
      content = '<div class="empty-state">Item not found in loaded D1 data.</div>';
    }
  } else {
    content = `<div class="empty-state" style="color:var(--color-text-muted);font-size:13px;">
      Evidence drill-down is not available for <strong>${esc(itemType)}</strong> items in this POC.<br/>
      Use the meeting detail view to see all extracted fields for this item.
    </div>`;
  }

  body.innerHTML = content;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeEvidence() {
  const modal = el('evidence-modal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

// ── Feedback ──────────────────────────────────────────────

function openFeedback(itemType, itemId, itemLabel, sourceVersion) {
  // sourceVersion captures the item's updatedAt or ETag for feedback provenance
  state.feedbackTarget = { itemType, itemId, itemLabel, sourceVersion: sourceVersion || null };
  el('feedback-target-label').textContent = itemLabel || `${itemType}/${itemId}`;
  el('feedback-verdict').value = '';
  el('feedback-field').value = '';
  el('feedback-notes').value = '';
  el('feedback-warning-ack') && (el('feedback-warning-ack').checked = false);
  el('feedback-error').textContent = '';
  el('feedback-success').textContent = '';
  // Enable Save — target is now set
  const saveBtn = el('feedback-save');
  saveBtn.disabled = false;
  saveBtn.removeAttribute('aria-disabled');
  // Open panel and load existing feedback for this item
  state.feedbackPanelOpen = true;
  el('feedback-panel').classList.add('open');
  el('feedback-panel').setAttribute('aria-hidden', 'false');
  el('feedback-toggle').setAttribute('aria-expanded', 'true');
  // Load existing feedback for this item from server
  loadFeedbackForItem(itemType, itemId);
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

async function saveFeedback() {
  const errorEl = el('feedback-error');
  const successEl = el('feedback-success');
  errorEl.textContent = '';
  successEl.textContent = '';

  // Guard: no target selected (panel opened via toggle without item selection)
  if (!state.feedbackTarget) {
    errorEl.textContent = 'No item selected — use an item-level Feedback button first';
    return;
  }

  const reviewerName = (el('feedback-reviewer-name')?.value || '').trim();
  const verdict = el('feedback-verdict').value;
  const field = el('feedback-field').value;
  const notes = el('feedback-notes').value.trim();
  const warningAck = el('feedback-warning-ack')?.checked === true;

  if (!reviewerName) { errorEl.textContent = 'Please enter your reviewer name.'; return; }
  if (!verdict) { errorEl.textContent = 'Please select a verdict.'; return; }
  if (!field) { errorEl.textContent = 'Please select an affected field.'; return; }
  if (!notes) { errorEl.textContent = 'Please enter notes.'; return; }
  if (!warningAck) { errorEl.textContent = 'You must acknowledge the data retention warning before submitting.'; return; }

  const saveBtn = el('feedback-save');
  saveBtn.disabled = true;

  try {
    const body = {
      itemType: state.feedbackTarget.itemType,
      itemId: state.feedbackTarget.itemId,
      sourceKind: 'd1',
      sourceVersion: state.feedbackTarget.sourceVersion,
      reviewerName,
      verdict,
      affectedField: field,
      note: notes,
      warningAcknowledged: true,
      correctsFeedbackId: null,
      sourceLocation: state.feedbackTarget.itemId,
    };

    const res = await fetch('/api/v1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      errorEl.textContent = `Submission failed: ${data.error || res.status}`;
      return;
    }

    const result = await res.json();
    // Add to local session cache and refresh per-item history
    state.feedback.push({ ...body, feedbackId: result.data?.feedbackId, createdAt: new Date().toISOString() });
    successEl.textContent = '✓ Feedback saved to the dedicated feedback database.';
    renderFeedbackList();
    updateFeedbackCount();
    // Reload server-side history for this item
    loadFeedbackForItem(state.feedbackTarget.itemType, state.feedbackTarget.itemId);
    void refreshReviewQueue();
  } catch (fetchErr) {
    errorEl.textContent = `Network error: ${fetchErr.message}`;
  } finally {
    saveBtn.disabled = false;
  }
}

async function loadFeedbackForItem(itemType, itemId) {
  const historyEl = el('feedback-item-history');
  if (!historyEl) return;
  historyEl.innerHTML = '<li style="color:var(--color-text-muted);font-size:11px;">Loading history…</li>';
  try {
    const res = await fetch(`/api/v1/feedback/item/${encodeURIComponent(itemType)}/${encodeURIComponent(itemId)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const rows = json.data || [];
    if (!rows.length) {
      historyEl.innerHTML = '<li style="color:var(--color-text-muted);font-size:11px;">No prior feedback for this item.</li>';
      return;
    }
    historyEl.innerHTML = rows.map(f => `
      <li class="feedback-list-item" style="font-size:11px;">
        <div class="feedback-list-item-header">
          <span>${esc(f.reviewer_name)}</span>
          <span class="badge ${f.verdict === 'accurate' ? 'badge-pass' : f.verdict === 'incomplete' ? 'badge-warning' : 'badge-risk'}">${esc(f.verdict)}</span>
        </div>
        <div style="color:var(--color-text-muted);">Field: ${esc(f.affected_field)} · ${esc((f.created_at||'').substring(0,10))}</div>
        <div>${esc(f.note)}</div>
      </li>`).join('');
  } catch (e) {
    historyEl.innerHTML = `<li style="color:var(--color-text-muted);font-size:11px;">Could not load history: ${esc(e.message)}</li>`;
  }
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
      <div style="color:var(--color-text-muted);">Field: ${esc(f.affectedField)} · ${esc(f.reviewerName || '')}</div>
      <div>${esc(f.note || f.notes || '')}</div>
    </li>`).join('');
}

async function exportFeedback() {
  // Export from server (full persistent store), not just session cache
  try {
    const res = await fetch('/api/v1/feedback/export');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eip-cockpit-feedback-${new Date().toISOString().substring(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(`Export failed: ${e.message}`);
  }
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
  initReviewerNameInputs(); // populates feedback-reviewer-name from localStorage

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
    const [overview, decisions, risksActions, topicMemory, topics, reviewQueue] = await Promise.all([
      apiFetch('/api/v1/overview'),
      apiFetch('/api/v1/decisions'),
      apiFetch('/api/v1/risks-actions'),
      apiFetch('/api/v1/topic-memory'),
      apiFetch('/api/v1/topics'),
      apiFetch('/api/v1/review-queue'),
    ]);

    state.overview = overview;
    state.decisions = decisions;
    state.topicMemory = topicMemory;
    state.topics = topics;
    state.reviewQueue = reviewQueue;

    // risksActions currently returns a flat action array. Derive the canonical
    // Risk collection once from D1 topic classification plus risk assertions.
    state.risksActions = {
      actions: Array.isArray(risksActions) ? risksActions : (risksActions?.actions || []),
      risks: deriveRisksFromTopics(topics, overview?.meetings),
      evidenceProxyNotice: 'Risk-classified topics are shown once; assertions on non-Risk topics are evidence-only, not a governed risk register.',
    };

    populateFilterOptions();
    renderOverview(overview);
    renderReviewQueue();
    renderPendingReview();
    initReviewerNameInputs(); // re-init after renderPendingReview creates pending-reviewer-name input
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
window.handleMatchClick = handleMatchClick;
window.openFeedback = openFeedback;
window.closeFeedback = closeFeedback;
window.switchToAllContent = switchToAllContent;
window.onStatCardClick = onStatCardClick;
window.clearFilters = clearFilters;
window.showEvidence = showEvidence;
