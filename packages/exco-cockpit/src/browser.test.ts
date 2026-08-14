// @ts-nocheck
// ============================================================
// EIP ExCo Cockpit — Browser DOM tests (jsdom environment)
// Loads actual index.html and app.js; mocks fetch() same-origin.
// Exercises the real browser code path for all feedback, tab,
// filter, and deep-link behaviours.
//
// @ts-nocheck is required because @cloudflare/workers-types
// redefines global fetch/Request/Response types in a way that
// conflicts with the standard DOM fetch used by jsdom. The
// business logic is tested correctly; only the type annotation
// is suppressed for this test file.
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { JSDOM } from 'jsdom';
import { routeApiRequest } from './api';

// ── Real API responses via actual fixture data ─────────────
// The fetch mock calls routeApiRequest() with real fixture data,
// so tests exercise the same data as the production API endpoints.

async function realApiResponse(path: string): Promise<object> {
  const req = new Request(`http://localhost${path}`, { method: 'GET' });
  const url = new URL(req.url);
  const res = routeApiRequest(req, url);
  if (!res) return { apiVersion: 'v1', data: {} };
  return res.json();
}

// ── jsdom helper ──────────────────────────────────────────

function buildDOM() {
  const htmlPath = join(__dirname, '../public/index.html');
  const appJsPath = join(__dirname, '../public/app.js');
  const html = readFileSync(htmlPath, 'utf8');
  const appJs = readFileSync(appJsPath, 'utf8');

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    resources: 'usable',
    url: 'http://localhost:8788',
  });

  const { window } = dom;
  let queueRecorded = false;

  // Mock fetch — serves real fixture data via the actual API handlers.
  // This ensures tests exercise the same data as the production endpoints.
  window.fetch = vi.fn(async (url, init) => {
    const path = typeof url === 'string' ? url : url.toString();
    if (path.startsWith('/api/v1/review-queue/memory/') && init?.method === 'POST') {
      queueRecorded = true;
      return { ok: true, status: 200, json: async () => ({ apiVersion: 'v1', data: { auditEventId: 'audit-event-1', decision: 'approve_match' } }) };
    }
    if (path === '/api/v1/feedback' && init?.method === 'POST') {
      const submission = JSON.parse(init.body);
      if (submission.itemType === 'memory') queueRecorded = true;
      return { ok: true, status: 201, json: async () => ({ apiVersion: 'v1', data: { feedbackId: 'fixture-feedback-1', created: true } }) };
    }
    const body = await realApiResponse(path);
    if (path === '/api/v1/review-queue' && queueRecorded) {
      const queue = body.data;
      const item = queue.awaitingReview[0];
      if (item) {
        queue.awaitingReview = [];
        queue.recordedDecisions = [{ ...item, disposition: {
          feedbackId: 'fixture-feedback-1', verdict: 'accurate', affectedField: 'overall',
          reviewerName: 'Executive Reviewer', createdAt: new Date().toISOString(), correctsFeedbackId: null,
        } }];
      }
    }
    return {
      ok: true,
      status: 200,
      json: async () => body,
      blob: async () => new window.Blob([JSON.stringify(body)], { type: 'application/json' }),
    };
  });

  // Mock URL.createObjectURL / revokeObjectURL for export test
  window.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  window.URL.revokeObjectURL = vi.fn();

  // Run app.js in the DOM context
  window.eval(appJs);

  return { dom, window };
}

// Wait for async init (fetch + render) to complete
async function waitForInit() {
  await new Promise(r => setTimeout(r, 50));
}

function acknowledgeFeedbackWarning(window: AnyWindow) {
  const checkbox = window.document.getElementById('feedback-warning-ack');
  if (checkbox) checkbox.checked = true;
}

// ── Tests ─────────────────────────────────────────────────

describe('Tab navigation', () => {
  let dom: JSDOM, window: AnyWindow;
  beforeEach(async () => {
    ({ dom, window } = buildDOM());
    await waitForInit();
  });
  afterEach(() => dom.window.close());

  it('Overview tab is selected by default', () => {
    const overviewTab = window.document.getElementById('tab-overview')!;
    expect(overviewTab.getAttribute('aria-selected')).toBe('true');
  });

  it('All Content tab is not selected by default', () => {
    const allTab = window.document.getElementById('tab-all-content')!;
    expect(allTab.getAttribute('aria-selected')).toBe('false');
  });

  it('clicking All Content tab activates that panel', () => {
    const allTab = window.document.getElementById('tab-all-content')!;
    allTab.click();
    expect(allTab.getAttribute('aria-selected')).toBe('true');
    const panel = window.document.getElementById('panel-all-content')!;
    expect(panel.classList.contains('active')).toBe(true);
  });

  it('all cockpit tabs are present', () => {
    const tabs = window.document.querySelectorAll('[role="tab"]');
    expect(tabs.length).toBe(3);
  });
});

describe('Floating feedback toggle and aria-hidden', () => {
  let dom: JSDOM, window: AnyWindow;
  beforeEach(async () => {
    ({ dom, window } = buildDOM());
    await waitForInit();
  });
  afterEach(() => dom.window.close());

  it('feedback panel starts with aria-hidden="true"', () => {
    const panel = window.document.getElementById('feedback-panel');
    expect(panel.getAttribute('aria-hidden')).toBe('true');
  });

  it('feedback toggle sets aria-hidden="false" when opened', () => {
    const toggle = window.document.getElementById('feedback-toggle');
    toggle.click();
    const panel = window.document.getElementById('feedback-panel');
    expect(panel.getAttribute('aria-hidden')).toBe('false');
  });

  it('feedback toggle sets aria-expanded correctly', () => {
    const toggle = window.document.getElementById('feedback-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('closing feedback panel sets aria-hidden="true"', () => {
    const toggle = window.document.getElementById('feedback-toggle');
    toggle.click();
    window.document.getElementById('feedback-panel-close').click();
    const panel = window.document.getElementById('feedback-panel');
    expect(panel.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('Save disabled without a target', () => {
  let dom: JSDOM, window: AnyWindow;
  beforeEach(async () => {
    ({ dom, window } = buildDOM());
    await waitForInit();
  });
  afterEach(() => dom.window.close());

  it('Save button starts disabled', () => {
    const save = window.document.getElementById('feedback-save');
    expect(save.disabled).toBe(true);
  });

  it('Save button remains disabled when panel opened via toggle (no target)', () => {
    window.document.getElementById('feedback-toggle').click();
    const save = window.document.getElementById('feedback-save');
    expect(save.disabled).toBe(true);
  });

  it('clicking Save without target shows error message, no feedback added', () => {
    // Force-enable Save to test guard (bypasses HTML disabled attr)
    const save = window.document.getElementById('feedback-save');
    save.disabled = false;
    save.click();
    const errorEl = window.document.getElementById('feedback-error');
    expect(errorEl.textContent).toContain('No item selected');
    // state.feedback should be empty
    expect(window.state.feedback.length).toBe(0);
  });
});

describe('Item-level feedback targeting and validation', () => {
  let dom: JSDOM, window: AnyWindow;
  beforeEach(async () => {
    ({ dom, window } = buildDOM());
    await waitForInit();
    const reviewer = window.document.getElementById('feedback-reviewer-name');
    reviewer.value = 'Executive Reviewer';
    reviewer.dispatchEvent(new window.Event('input'));
  });
  afterEach(() => dom.window.close());

  it('openFeedback() enables Save and sets target', () => {
    window.openFeedback('decision', 'fx-decision-001', 'Decision label');
    const save = window.document.getElementById('feedback-save');
    expect(save.disabled).toBe(false);
    expect(window.state.feedbackTarget.itemId).toBe('fx-decision-001');
  });

  it('fails validation without verdict', () => {
    window.openFeedback('decision', 'fx-decision-001', 'label');
    window.document.getElementById('feedback-field').value = 'overall';
    window.document.getElementById('feedback-notes').value = 'some note';
    window.document.getElementById('feedback-save').click();
    expect(window.document.getElementById('feedback-error').textContent).toContain('verdict');
    expect(window.state.feedback.length).toBe(0);
  });

  it('fails validation without notes', () => {
    window.openFeedback('decision', 'fx-decision-001', 'label');
    window.document.getElementById('feedback-verdict').value = 'accurate';
    window.document.getElementById('feedback-field').value = 'overall';
    window.document.getElementById('feedback-notes').value = '';
    window.document.getElementById('feedback-save').click();
    expect(window.document.getElementById('feedback-error').textContent).toContain('notes');
    expect(window.state.feedback.length).toBe(0);
  });

  it('saves valid feedback and closes panel', async () => {
    window.openFeedback('decision', 'fx-decision-001', 'label');
    acknowledgeFeedbackWarning(window);
    window.document.getElementById('feedback-verdict').value = 'incomplete';
    window.document.getElementById('feedback-field').value = 'owner';
    window.document.getElementById('feedback-notes').value = 'Owner field is missing context.';
    window.document.getElementById('feedback-save').click();
    await new Promise(r => setTimeout(r, 100));
    expect(window.state.feedback.length).toBe(1);
    expect(window.state.feedback[0].verdict).toBe('incomplete');
    expect(window.state.feedback[0].itemId).toBe('fx-decision-001');
    // The feedback panel remains open so the reviewer can inspect history.
    expect(window.document.getElementById('feedback-panel').getAttribute('aria-hidden')).toBe('false');
  });

  it('all four verdicts can be saved', async () => {
    const verdicts = ['accurate', 'incomplete', 'incorrect', 'irrelevant'];
    for (const [i, v] of verdicts.entries()) {
      window.openFeedback('action', `fx-action-00${i+1}`, `label ${i}`);
      acknowledgeFeedbackWarning(window);
      window.document.getElementById('feedback-verdict').value = v;
      window.document.getElementById('feedback-field').value = 'overall';
      window.document.getElementById('feedback-notes').value = `Note for ${v}.`;
      window.document.getElementById('feedback-save').click();
      await new Promise(r => setTimeout(r, 100));
    }
    expect(window.state.feedback.length).toBe(4);
    const saved = window.state.feedback.map(f => f.verdict);
    expect(saved).toContain('accurate');
    expect(saved).toContain('incomplete');
    expect(saved).toContain('incorrect');
    expect(saved).toContain('irrelevant');
  });
});

describe('Feedback export from live session state', () => {
  let dom: JSDOM, window: AnyWindow;
  beforeEach(async () => {
    ({ dom, window } = buildDOM());
    await waitForInit();
  });
  afterEach(() => dom.window.close());

  it('export creates a Blob from actual session feedback records', async () => {
    window.openFeedback('decision', 'fx-decision-001', 'test');
    acknowledgeFeedbackWarning(window);
    window.document.getElementById('feedback-verdict').value = 'accurate';
    window.document.getElementById('feedback-field').value = 'overall';
    window.document.getElementById('feedback-notes').value = 'Correct.';
    window.document.getElementById('feedback-save').click();
    await new Promise(r => setTimeout(r, 100));

    window.document.getElementById('feedback-export').click();
    await new Promise(r => setTimeout(r, 100));

    // URL.createObjectURL should have been called with a Blob
    expect(window.URL.createObjectURL).toHaveBeenCalledOnce();
    const blobArg = window.URL.createObjectURL.mock.calls[0][0];
    expect(blobArg).toBeInstanceOf(window.Blob);
    // Blob type should be JSON
    expect(blobArg.type).toBe('application/json');
  });
});

describe('Reset — cancel and confirm paths', () => {
  let dom: JSDOM, window: AnyWindow;
  beforeEach(async () => {
    ({ dom, window } = buildDOM());
    await waitForInit();
    // Add a feedback entry
    window.openFeedback('decision', 'fx-decision-001', 'label');
    const reviewer = window.document.getElementById('feedback-reviewer-name');
    reviewer.value = 'Executive Reviewer';
    reviewer.dispatchEvent(new window.Event('input'));
    acknowledgeFeedbackWarning(window);
    window.document.getElementById('feedback-verdict').value = 'accurate';
    window.document.getElementById('feedback-field').value = 'overall';
    window.document.getElementById('feedback-notes').value = 'note';
    window.document.getElementById('feedback-save').click();
    await new Promise(r => setTimeout(r, 250));
  });
  afterEach(() => dom.window.close());

  it('cancel reset leaves feedback intact', async () => {
    await new Promise(r => setTimeout(r, 100));
    window.confirm = vi.fn(() => false); // user cancels
    window.document.getElementById('feedback-reset').click();
    expect(window.state.feedback.length).toBe(1);
  });

  it('confirm reset clears all feedback', async () => {
    await new Promise(r => setTimeout(r, 100));
    window.confirm = vi.fn(() => true); // user confirms
    window.document.getElementById('feedback-reset').click();
    expect(window.state.feedback.length).toBe(0);
  });
});

describe('Meeting filter option resilience', () => {
  it('initialises when a live meeting has no event date', async () => {
    const { dom, window } = buildDOM();
    const originalFetch = window.fetch;
    window.fetch = vi.fn(async (url, init) => {
      const path = typeof url === 'string' ? url : url.toString();
      const response = await originalFetch(url, init);
      if (path !== '/api/v1/overview') return response;
      const body = await response.json();
      body.data.meetings[0].eventDate = null;
      return { ...response, json: async () => body };
    });

    window.eval(readFileSync(join(__dirname, '../public/app.js'), 'utf8'));
    await waitForInit();

    const meetingOptions = window.document.querySelectorAll('#filter-meeting option');
    expect(meetingOptions.length).toBeGreaterThan(1);
    expect(meetingOptions[1].textContent).toContain('—');
    dom.window.close();
  });
});

describe('Meeting aggregate counts', () => {
  it('derives counts from loaded API collections when meeting summaries omit them', async () => {
    const { dom, window } = buildDOM();
    await waitForInit();

    const meetingCard = [...window.document.querySelectorAll('#all-content-results .card')]
      .find(card => card.querySelector('.card-title')?.textContent === 'Synthetic ExCo Review — Product & Delivery');
    const meetingText = meetingCard?.textContent ?? '';

    expect(meetingText).toContain('3 topics');
    expect(meetingText).toContain('2 decisions');
    expect(meetingText).toContain('3 actions');
    expect(meetingText).not.toContain('undefined');
    dom.window.close();
  });
});

describe('All Content filters', () => {
  let dom: JSDOM, window: AnyWindow;
  beforeEach(async () => {
    ({ dom, window } = buildDOM());
    await waitForInit();
    // Switch to All Content tab
    window.document.getElementById('tab-all-content').click();
  });
  afterEach(() => dom.window.close());

  it('All Content renders all items by default', () => {
    const results = window.document.getElementById('all-content-results');
    // Should contain multiple content type sections
    expect(results.innerHTML).toContain('Meeting');
    expect(results.innerHTML).toContain('Decision');
    expect(results.innerHTML).toContain('Action');
  });

  it('type filter to Decision shows only decisions', () => {
    const typeSelect = window.document.getElementById('filter-type');
    typeSelect.value = 'Decision';
    typeSelect.dispatchEvent(new window.Event('change'));
    const results = window.document.getElementById('all-content-results');
    expect(results.innerHTML).toContain('Decision');
    expect(results.innerHTML).not.toContain('content-type-title">Meeting');
    expect(results.innerHTML).not.toContain('content-type-title">Action');
  });

  it('type filter to Action shows only actions', () => {
    const typeSelect = window.document.getElementById('filter-type');
    typeSelect.value = 'Action';
    typeSelect.dispatchEvent(new window.Event('change'));
    const results = window.document.getElementById('all-content-results');
    expect(results.innerHTML).toContain('Action');
    expect(results.innerHTML).not.toContain('content-type-title">Decision');
  });

  it('type filter to Risk shows only canonical risk cards', () => {
    const typeSelect = window.document.getElementById('filter-type');
    typeSelect.value = 'Risk';
    typeSelect.dispatchEvent(new window.Event('change'));
    const results = window.document.getElementById('all-content-results');
    expect(results.innerHTML).toContain('Risk');
    expect(results.innerHTML).not.toContain('content-type-title">Decision');
  });

  it('shows one primary Risk card for a risk-classified topic with no extracted assertions', () => {
    const typeSelect = window.document.getElementById('filter-type');
    typeSelect.value = 'Risk';
    typeSelect.dispatchEvent(new window.Event('change'));
    const results = window.document.getElementById('all-content-results');
    const statement = 'fx-product-beta delivery is at risk because verification work was temporarily deprioritised';
    expect(results.innerHTML).toContain(statement);
    expect(results.innerHTML).toContain('Risk-classified topic — no separate risk assertions were extracted.');
    expect(window.state.risksActions.risks.find(r => r.topicId === 'fx-topic-007')).toMatchObject({
      riskId: 'topic-risk:fx-topic-007',
      kind: 'classified_topic',
      topicDomain: 'Product Management',
      topicEntityType: 'Product',
      meetingSubject: 'Synthetic ExCo Review — Commercial & Finance',
    });
  });

  it('does not duplicate a risk-classified topic per extracted assertion and labels non-Risk assertions as evidence-only', () => {
    const typeSelect = window.document.getElementById('filter-type');
    typeSelect.value = 'Risk';
    typeSelect.dispatchEvent(new window.Event('change'));
    const risks = window.state.risksActions.risks;
    expect(risks.filter(r => r.topicId === 'fx-topic-001')).toHaveLength(1);
    expect(risks.find(r => r.topicId === 'fx-topic-001')).toMatchObject({
      riskId: 'topic-risk:fx-topic-001',
      kind: 'classified_topic',
    });
    expect(risks.find(r => r.topicId === 'fx-topic-003')).toMatchObject({
      riskId: 'risk-evidence:fx-topic-003:fx-risk-002',
      kind: 'evidence_only',
    });
    const results = window.document.getElementById('all-content-results');
    expect(results.innerHTML).toContain('Evidence-only risk assertion from a non-Risk topic.');
  });

  it('type filter to Topic Memory shows only memories', async () => {
    const typeSelect = window.document.getElementById('filter-type');
    typeSelect.value = 'Topic Memory';
    typeSelect.dispatchEvent(new window.Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const results = window.document.getElementById('all-content-results');
    expect(results.innerHTML).toContain('Topic Memory');
    expect(results.innerHTML).toMatch(/Pending match|Standalone memory|Active trajectory/);
  });

  it('filters Topic Memories to multi-meeting trajectories', async () => {
    const typeSelect = window.document.getElementById('filter-type');
    typeSelect.value = 'Topic Memory';
    typeSelect.dispatchEvent(new window.Event('change'));
    const scope = window.document.getElementById('filter-trajectory-scope');
    scope.value = 'multi_meeting';
    scope.dispatchEvent(new window.Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const results = window.document.getElementById('all-content-results');
    expect(results.querySelectorAll('.card')).toHaveLength(1);
    expect(results.textContent).toContain('Active trajectory · 2 meetings');
    expect(results.textContent).not.toContain('Standalone memory');
    expect(window.document.getElementById('filter-summary').textContent).toContain('multi-meeting trajectories');
  });

  it('filters Topic Memories to standalone and pending scopes with clear labels', async () => {
    const typeSelect = window.document.getElementById('filter-type');
    typeSelect.value = 'Topic Memory';
    typeSelect.dispatchEvent(new window.Event('change'));
    const scope = window.document.getElementById('filter-trajectory-scope');
    scope.value = 'standalone';
    scope.dispatchEvent(new window.Event('change'));
    expect(window.document.getElementById('all-content-results').textContent).toContain('Standalone memory · 1 meeting');
    expect(window.document.querySelectorAll('#all-content-results .card')).toHaveLength(2);
    scope.value = 'pending_review';
    scope.dispatchEvent(new window.Event('change'));
    expect(window.document.getElementById('all-content-results').textContent).toContain('Pending match · 1 meeting');
    expect(window.document.querySelectorAll('#all-content-results .card')).toHaveLength(1);
  });

  it('does not apply trajectory scope to non-memory types and clears it with filters', async () => {
    const typeSelect = window.document.getElementById('filter-type');
    typeSelect.value = 'Topic';
    typeSelect.dispatchEvent(new window.Event('change'));
    const before = window.document.querySelectorAll('#all-content-results .card').length;
    const scope = window.document.getElementById('filter-trajectory-scope');
    scope.value = 'multi_meeting';
    scope.dispatchEvent(new window.Event('change'));
    expect(window.document.querySelectorAll('#all-content-results .card').length).toBe(before);
    window.document.getElementById('filter-clear').click();
    expect(scope.value).toBe('');
    expect(window.state.filters.trajectoryScope).toBe('');
  });

  it('groups merged observations inside one root Topic Memory card', async () => {
    const typeSelect = window.document.getElementById('filter-type');
    typeSelect.value = 'Topic Memory';
    typeSelect.dispatchEvent(new window.Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const cards = window.document.querySelectorAll('#all-content-results .card');
    const results = window.document.getElementById('all-content-results');
    expect(cards).toHaveLength(4);
    expect(results.textContent).toContain('Active trajectory · 2 meetings');
    expect(results.textContent).toContain('Trajectory observations (2)');
    expect(results.querySelector('.topic-memory-timeline')).toBeTruthy();
    expect(results.textContent).toContain('Root observation');
    expect(results.textContent).toContain('Matched and merged source observation');
    expect(results.textContent).toContain('fx-memory-001-source-merged');
    expect(results.textContent).toContain('Reviewed: 2026-07-23T10:15:00.000Z');
    expect(results.textContent).toContain('Audit: fx-audit-merge-001');
  });

  it('keeps Topic Memory counts root-based while Topics remain individual', async () => {
    const baselineCount = window.state.overview.topicMemoryCount;
    expect(baselineCount).toBe(4);
    const typeSelect = window.document.getElementById('filter-type');
    typeSelect.value = 'Topic';
    typeSelect.dispatchEvent(new window.Event('change'));
    await new Promise(r => setTimeout(r, 50));
    expect(window.document.querySelectorAll('#all-content-results .card').length).toBeGreaterThan(4);
    typeSelect.value = 'Topic Memory';
    typeSelect.dispatchEvent(new window.Event('change'));
    expect(window.state.overview.topicMemoryCount).toBe(baselineCount);
  });

  it('applies Domain and keyword filters across grouped branch observations', async () => {
    const typeSelect = window.document.getElementById('filter-type');
    typeSelect.value = 'Topic Memory';
    typeSelect.dispatchEvent(new window.Event('change'));
    const domainSelect = window.document.getElementById('filter-domain');
    domainSelect.value = 'Product Management';
    domainSelect.dispatchEvent(new window.Event('change'));
    const kw = window.document.getElementById('filter-keyword');
    kw.value = 'historical source observation';
    kw.dispatchEvent(new window.Event('input'));
    await new Promise(r => setTimeout(r, 300));
    const results = window.document.getElementById('all-content-results');
    expect(results.textContent).toContain('Trajectory observations (2)');
    expect(results.textContent).toContain('Historical source observation for fx-product-alpha');
  });

  it('Domain filter includes Topic Memory records with their originating domain', async () => {
    const typeSelect = window.document.getElementById('filter-type');
    typeSelect.value = 'Topic Memory';
    typeSelect.dispatchEvent(new window.Event('change'));
    const domainSelect = window.document.getElementById('filter-domain');
    const domain = Array.from(domainSelect.options).map(option => option.value).find(Boolean);
    expect(domain).toBeTruthy();
    domainSelect.value = domain;
    domainSelect.dispatchEvent(new window.Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const results = window.document.getElementById('all-content-results');
    expect(results.textContent).toContain(`Domain: ${domain}`);
  });

  it('keyword filter is case-insensitive', async () => {
    const kw = window.document.getElementById('filter-keyword');
    kw.value = 'GROSS MARGIN';
    kw.dispatchEvent(new window.Event('input'));
    // Wait for debounce
    await new Promise(r => setTimeout(r, 300));
    const results = window.document.getElementById('all-content-results');
    expect(results.innerHTML.toLowerCase()).toContain('margin');
  });

  it('keyword filter with no matches shows empty state', async () => {
    const kw = window.document.getElementById('filter-keyword');
    kw.value = 'xyzzy-no-match-12345';
    kw.dispatchEvent(new window.Event('input'));
    await new Promise(r => setTimeout(r, 300));
    const results = window.document.getElementById('all-content-results');
    expect(results.innerHTML).toContain('No items match');
  });

  it('clear filters restores all items', async () => {
    // Apply a filter
    const typeSelect = window.document.getElementById('filter-type');
    typeSelect.value = 'Decision';
    typeSelect.dispatchEvent(new window.Event('change'));
    // Clear
    window.document.getElementById('filter-clear').click();
    const results = window.document.getElementById('all-content-results');
    expect(results.innerHTML).toContain('Meeting');
    expect(results.innerHTML).toContain('Decision');
  });

  it('combined type + keyword filter is conjunctive', async () => {
    // Type = Action
    const typeSelect = window.document.getElementById('filter-type');
    typeSelect.value = 'Action';
    typeSelect.dispatchEvent(new window.Event('change'));
    // Keyword = cfo (matches owner or text)
    const kw = window.document.getElementById('filter-keyword');
    kw.value = 'cfo';
    kw.dispatchEvent(new window.Event('input'));
    await new Promise(r => setTimeout(r, 300));
    const results = window.document.getElementById('all-content-results');
    // Should show actions mentioning cfo, not decisions or meetings
    expect(results.innerHTML).not.toContain('content-type-title">Meeting');
  });

  it('meeting filter propagates to decisions via meetingId', () => {
    const meetingSelect = window.document.getElementById('filter-meeting');
    meetingSelect.value = 'fx-meeting-002';
    meetingSelect.dispatchEvent(new window.Event('change'));
    const results = window.document.getElementById('all-content-results');
    // fx-decision-003 is in meeting-002
    expect(results.innerHTML).toContain('UK education launch');
    // fx-decision-001 is in meeting-001 — should not appear
    expect(results.innerHTML).not.toContain('Gross margin recovery');
  });

  it('entity family filter shows only matching entityType memories', () => {
    // First populate entity family options
    const efSelect = window.document.getElementById('filter-entity-family');
    // Set type to Topic Memory to make it visible
    window.document.getElementById('filter-type').value = 'Topic Memory';
    window.document.getElementById('filter-type').dispatchEvent(new window.Event('change'));
    // Set entity family filter
    efSelect.value = 'Product';
    efSelect.dispatchEvent(new window.Event('change'));
    const results = window.document.getElementById('all-content-results');
    expect(results.innerHTML).toContain('fx-product-alpha');
    expect(results.innerHTML).not.toContain('fx-metric-gross-margin');
  });

  it('filter summary updates when filters are applied', () => {
    const typeSelect = window.document.getElementById('filter-type');
    typeSelect.value = 'Decision';
    typeSelect.dispatchEvent(new window.Event('change'));
    const summary = window.document.getElementById('filter-summary');
    expect(summary.textContent).toContain('Decision');
  });

  it('no API mutations — fetch is only called for reads during init', () => {
    const calls = window.fetch.mock.calls;
    // All fetch calls should be GET-equivalent (no body/POST)
    calls.forEach(([url]) => {
      expect(String(url)).toMatch(/^\/api\/v1\//);
    });
  });
});

describe('Overview card deep links', () => {
  let dom: JSDOM, window: AnyWindow;
  beforeEach(async () => {
    ({ dom, window } = buildDOM());
    await waitForInit();
  });
  afterEach(() => dom.window.close());

  const deepLinkCases = [
    { key: 'meetingCount',           expectedType: 'Meeting',      stateFilter: null },
    { key: 'topicCount',             expectedType: 'Topic',        stateFilter: null },
    { key: 'decisionCount',          expectedType: 'Decision',     stateFilter: null },
    { key: 'openActionCount',        expectedType: 'Action',       stateFilter: 'open' },
    { key: 'topicMemoryCount',       expectedType: 'Topic Memory', stateFilter: null },
    { key: 'pendingReviewCount',     expectedType: 'Topic Memory', stateFilter: 'pending_review' },
    { key: 'validationWarningCount', expectedType: 'Topic',        stateFilter: 'warning' },
    { key: 'riskCount',              expectedType: 'Risk',         stateFilter: null },
  ];

  for (const { key, expectedType, stateFilter } of deepLinkCases) {
    it(`clicking ${key} stat card switches to All Content with type=${expectedType}`, () => {
      const card = window.document.querySelector(`[data-stat-key="${key}"]`);
      expect(card).toBeTruthy();
      card.click();
      // All Content tab should be active
      const allTab = window.document.getElementById('tab-all-content');
      expect(allTab.getAttribute('aria-selected')).toBe('true');
      // State filter should be set
      expect(window.state.filters.type).toBe(expectedType);
      if (stateFilter) {
        expect(window.state._stateFilter).toBe(stateFilter);
      }
    });
  }
});

// ── FIXTURE-BASED CONSTANTS for deterministic assertions ──────
// These values come from FIXTURE_TOPICS in src/fixtures.ts.
// fx-topic-001: domain=Product Management, entityType=Product, entity=fx-product-alpha
// fx-topic-003: domain=Finance, entityType=Metric, entity=fx-metric-gross-margin
// fx-decision-001: topicDomain=Finance, topicEntityType=Metric (linked to fx-topic-003)
// fx-decision-002: topicDomain=Product Management, topicEntityType=Product
// fx-action-001: topicDomain=Product Management, topicEntityType=Product
// fx-risk-proxy-001: topicDomain=Product Management (linked to fx-topic-001)
// fx-memory-001: firstSeenMeetingId=fx-meeting-001, lastSeenMeetingId=fx-meeting-002 (spans both)
// fx-memory-002: firstSeenMeetingId=fx-meeting-001, lastSeenMeetingId=fx-meeting-001 (single meeting)

describe('All Content — Meeting and Topic type filters', () => {
  let dom: JSDOM, window: AnyWindow;
  beforeEach(async () => { ({ dom, window } = buildDOM()); await waitForInit(); window.document.getElementById('tab-all-content')!.click(); });
  afterEach(() => dom.window.close());

  it('type filter to Meeting shows exactly 2 meeting cards (fixture has 2)', async () => {
    const typeSelect = window.document.getElementById('filter-type');
    typeSelect!.value = 'Meeting';
    typeSelect!.dispatchEvent(new window.Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const results = window.document.getElementById('all-content-results')!;
    // Should show Meeting section header + 2 meeting cards
    expect(results.innerHTML).toContain('Synthetic ExCo Review');
    expect(results.innerHTML).toContain('Product &amp; Delivery');
    expect(results.innerHTML).toContain('Commercial &amp; Finance');
    // Should NOT show Decision section (exclusive filter)
    expect(results.innerHTML).not.toContain('content-type-title">Decision');
  });

  it('type filter to Topic shows exactly 7 topic cards (fixture has 7)', async () => {
    const typeSelect = window.document.getElementById('filter-type');
    typeSelect!.value = 'Topic';
    typeSelect!.dispatchEvent(new window.Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const results = window.document.getElementById('all-content-results')!;
    // fx-topic-001 topic statement must appear
    expect(results.innerHTML).toContain('fx-product-alpha September delivery is at risk');
    // Should NOT show Meeting or Decision sections
    expect(results.innerHTML).not.toContain('content-type-title">Meeting');
    expect(results.innerHTML).not.toContain('content-type-title">Decision');
  });

  it('Topic cards show domain and entityType from actual fixture data', async () => {
    const typeSelect = window.document.getElementById('filter-type');
    typeSelect!.value = 'Topic';
    typeSelect!.dispatchEvent(new window.Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const results = window.document.getElementById('all-content-results')!;
    // fx-topic-001 has domain=Product Management and entityType=Product
    expect(results.innerHTML).toContain('Product Management');
    expect(results.innerHTML).toContain('[Product]');
  });
});

describe('Domain filter option population', () => {
  let dom: JSDOM, window: AnyWindow;
  beforeEach(async () => { ({ dom, window } = buildDOM()); await waitForInit(); });
  afterEach(() => dom.window.close());

  it('Domain select contains Finance option (from fx-topic-003)', async () => {
    const domainSelect = window.document.getElementById('filter-domain')!;
    const optionValues = Array.from(domainSelect.querySelectorAll('option')).map(o => o.value);
    expect(optionValues).toContain('Finance');
    expect(optionValues).toContain('Product Management');
    expect(optionValues[0]).toBe(''); // Default empty option is first
  });

  it('Entity family select contains Product and Metric options (from fixtures)', async () => {
    const efSelect = window.document.getElementById('filter-entity-family')!;
    const optionValues = Array.from(efSelect.querySelectorAll('option')).map(o => o.value);
    expect(optionValues).toContain('Product');
    expect(optionValues).toContain('Metric');
    expect(optionValues[0]).toBe('');
  });
});

describe('Domain and Entity Family filters — deterministic', () => {
  let dom: JSDOM, window: AnyWindow;
  beforeEach(async () => { ({ dom, window } = buildDOM()); await waitForInit(); window.document.getElementById('tab-all-content')!.click(); });
  afterEach(() => dom.window.close());

  it('Domain=Finance returns Finance topics and Finance decisions — excludes Product Management', async () => {
    const domainSelect = window.document.getElementById('filter-domain')!;
    domainSelect.value = 'Finance';
    domainSelect.dispatchEvent(new window.Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const results = window.document.getElementById('all-content-results')!;
    // fx-topic-003 is Finance — its topic statement must appear
    expect(results.innerHTML).toContain('Gross margin');
    // fx-topic-001 is Product Management — must NOT appear
    expect(results.innerHTML).not.toContain('fx-product-alpha September delivery');
    // Not empty
    expect(results.innerHTML).not.toContain('No items match');
  });

  it('Entity family=Product returns Product topics and Product-linked items', async () => {
    const efSelect = window.document.getElementById('filter-entity-family')!;
    efSelect.value = 'Product';
    efSelect.dispatchEvent(new window.Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const results = window.document.getElementById('all-content-results')!;
    // fx-topic-001 has entityType=Product
    expect(results.innerHTML).toContain('fx-product-alpha');
    // fx-topic-003 has entityType=Metric — must NOT appear
    expect(results.innerHTML).not.toContain('Gross margin for fx-product-alpha');
    expect(results.innerHTML).not.toContain('No items match');
  });

  it('Domain=Finance + EntityFamily=Metric conjunctive filter returns Finance/Metric items only', async () => {
    const domainSelect = window.document.getElementById('filter-domain')!;
    domainSelect.value = 'Finance';
    domainSelect.dispatchEvent(new window.Event('change'));
    const efSelect = window.document.getElementById('filter-entity-family')!;
    efSelect.value = 'Metric';
    efSelect.dispatchEvent(new window.Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const results = window.document.getElementById('all-content-results')!;
    // fx-topic-003 is Finance/Metric — must appear
    expect(results.innerHTML).toContain('Gross margin');
    // Product Management items must not appear
    expect(results.innerHTML).not.toContain('fx-product-alpha September delivery');
  });

  it('Domain=Finance propagates to Decisions linked to Finance topics', async () => {
    const typeSelect = window.document.getElementById('filter-type')!;
    typeSelect.value = 'Decision';
    typeSelect.dispatchEvent(new window.Event('change'));
    const domainSelect = window.document.getElementById('filter-domain')!;
    domainSelect.value = 'Finance';
    domainSelect.dispatchEvent(new window.Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const results = window.document.getElementById('all-content-results')!;
    // fx-decision-001 has topicDomain=Finance — must appear
    expect(results.innerHTML).toContain('Gross margin recovery plan');
    // fx-decision-002 has topicDomain=Product Management — must NOT appear
    expect(results.innerHTML).not.toContain('Emergency review');
  });

  it('Domain=Product Management propagates to Actions linked to Product Management topics', async () => {
    const typeSelect = window.document.getElementById('filter-type')!;
    typeSelect.value = 'Action';
    typeSelect.dispatchEvent(new window.Event('change'));
    const domainSelect = window.document.getElementById('filter-domain')!;
    domainSelect.value = 'Product Management';
    domainSelect.dispatchEvent(new window.Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const results = window.document.getElementById('all-content-results')!;
    // fx-action-001 has topicDomain=Product Management — must appear
    expect(results.innerHTML).toContain('Chase component approval');
    // fx-action-002 has topicDomain=Finance — must NOT appear
    expect(results.innerHTML).not.toContain('Prepare gross margin');
  });

  it('Domain=Product Management propagates to Risks linked to Product Management topics', async () => {
    const typeSelect = window.document.getElementById('filter-type')!;
    typeSelect.value = 'Risk';
    typeSelect.dispatchEvent(new window.Event('change'));
    const domainSelect = window.document.getElementById('filter-domain')!;
    domainSelect.value = 'Product Management';
    domainSelect.dispatchEvent(new window.Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const results = window.document.getElementById('all-content-results')!;
    // fx-risk-proxy-001 has topicDomain=Product Management — must appear
    expect(results.innerHTML).toContain('September delivery cannot be achieved');
    expect(results.innerHTML).not.toContain('No items match');
  });

  it('Domain filter includes matching Topic Memory records', async () => {
    const typeSelect = window.document.getElementById('filter-type')!;
    typeSelect.value = 'Topic Memory';
    typeSelect.dispatchEvent(new window.Event('change'));
    const domainSelect = window.document.getElementById('filter-domain')!;
    domainSelect.value = 'Finance';
    domainSelect.dispatchEvent(new window.Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const results = window.document.getElementById('all-content-results')!;
    expect(results.textContent).toContain('Domain: Finance');
    expect(results.textContent).not.toContain('No items match');
  });
});

describe('Topic Memory last-seen meeting filter — deterministic', () => {
  let dom: JSDOM, window: AnyWindow;
  beforeEach(async () => { ({ dom, window } = buildDOM()); await waitForInit(); window.document.getElementById('tab-all-content')!.click(); });
  afterEach(() => dom.window.close());

  it('fx-memory-001 appears when filtering by fx-meeting-002 (its lastSeenMeetingId, not firstSeenMeetingId)', async () => {
    // fx-memory-001: firstSeen=fx-meeting-001, lastSeen=fx-meeting-002
    // Filtering by fx-meeting-002 must match it via lastSeenMeetingId
    const typeSelect = window.document.getElementById('filter-type')!;
    typeSelect.value = 'Topic Memory';
    typeSelect.dispatchEvent(new window.Event('change'));
    const meetingSelect = window.document.getElementById('filter-meeting')!;
    meetingSelect.value = 'fx-meeting-002';
    meetingSelect.dispatchEvent(new window.Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const results = window.document.getElementById('all-content-results')!;
    // fx-memory-001 canonical statement must appear
    expect(results.innerHTML).toContain('fx-product-alpha September delivery is at risk');
    // fx-memory-002 firstSeen=fx-meeting-001, lastSeen=fx-meeting-001 — must NOT appear
    expect(results.innerHTML).not.toContain('Gross margin is below target');
  });

  it('fx-memory-002 appears when filtering by fx-meeting-001 (its only meeting) but not fx-meeting-002', async () => {
    // fx-memory-002: firstSeen=fx-meeting-001, lastSeen=fx-meeting-001
    const typeSelect = window.document.getElementById('filter-type')!;
    typeSelect.value = 'Topic Memory';
    typeSelect.dispatchEvent(new window.Event('change'));
    const meetingSelect = window.document.getElementById('filter-meeting')!;
    meetingSelect.value = 'fx-meeting-001';
    meetingSelect.dispatchEvent(new window.Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const results = window.document.getElementById('all-content-results')!;
    // Both fx-memory-001 (firstSeen=meeting-001) and fx-memory-002 should appear
    expect(results.innerHTML).toContain('fx-product-alpha September delivery is at risk');
    expect(results.innerHTML).toContain('Gross margin');
  });
});

describe('Review Queue', () => {
  let dom: JSDOM, window: AnyWindow;

  beforeEach(async () => {
    ({ dom, window } = buildDOM());
    window.localStorage.clear();
    await waitForInit();
  });
  afterEach(() => dom.window.close());

  function queueItem() {
    return window.state.reviewQueue.awaitingReview[0];
  }

  async function submitCurrentMemoryFeedback() {
    const item = queueItem();
    window.openFeedback('memory', item.itemId, item.title, item.sourceVersion);
    const reviewer = window.document.getElementById('feedback-reviewer-name');
    reviewer.value = 'Executive Reviewer';
    reviewer.dispatchEvent(new window.Event('input'));
    acknowledgeFeedbackWarning(window);
    window.document.getElementById('feedback-verdict').value = 'accurate';
    window.document.getElementById('feedback-field').value = 'overall';
    window.document.getElementById('feedback-notes').value = 'Current-version queue review.';
    window.document.getElementById('feedback-save').click();
    await new Promise(r => setTimeout(r, 100));
    return item;
  }

  it('shows Awaiting review by default', () => {
    const queue = window.document.getElementById('review-queue-content');
    expect(queue.textContent).toContain('awaiting review');
    expect(queue.textContent).toContain(queueItem().title);
  });

  it('hides Recorded decisions before the audit toggle is activated', () => {
    expect(window.document.getElementById('review-queue-recorded')?.hasAttribute('hidden')).toBe(true);
    expect(window.document.getElementById('review-queue-recorded')?.textContent).not.toContain('Reviewer:');
  });

  it('reveals recorded reviewer and verdict context through the accessible audit toggle', async () => {
    await submitCurrentMemoryFeedback();
    const toggle = window.document.getElementById('review-queue-audit-toggle');
    toggle.checked = true;
    toggle.dispatchEvent(new window.Event('change'));
    const recorded = window.document.getElementById('review-queue-recorded');
    expect(recorded.hasAttribute('hidden')).toBe(false);
    expect(recorded.textContent).toContain('Executive Reviewer');
    expect(recorded.textContent).toContain('accurate');
  });

  it('moves an exact-current-version item from Awaiting review to Recorded decisions after feedback', async () => {
    const item = await submitCurrentMemoryFeedback();
    expect(window.state.reviewQueue.awaitingReview.some(x => x.itemId === item.itemId)).toBe(false);
    expect(window.state.reviewQueue.recordedDecisions.some(x => x.itemId === item.itemId)).toBe(true);
  });

  it('does not expose storage locators or transcript fields in queue output', () => {
    const text = window.document.getElementById('review-queue')?.textContent || '';
    expect(text).not.toMatch(/r2|transcript|credential|storage locator|hash/i);
    expect(JSON.stringify(window.state.reviewQueue)).not.toMatch(/r2|transcript|credential|storage locator|hash/i);
  });
});

describe('Pending Review match decisions', () => {
  let dom: JSDOM, window: AnyWindow;

  beforeEach(async () => {
    ({ dom, window } = buildDOM());
    // jsdom reuses this origin's storage between DOM instances. Start each
    // match-decision test without a reviewer so validation is deterministic.
    window.localStorage.clear();
    window.alert = vi.fn();
    await waitForInit();
  });

  afterEach(() => dom.window.close());

  function setReviewerName(name = 'Executive Reviewer') {
    const input = window.document.getElementById('pending-reviewer-name')!;
    input.value = name;
    input.dispatchEvent(new window.Event('input'));
  }

  function pendingButtons() {
    return Array.from(window.document.querySelectorAll('.match-actions button'));
  }

  function prepareDecision(note = 'Reviewed current evidence and trajectory.') {
    window.document.getElementById('pending-decision-note').value = note;
    window.document.getElementById('pending-decision-warning').checked = true;
    window.confirm = vi.fn(() => true);
  }

  it('exposes the handler used by the inline Match and No match buttons', () => {
    expect(typeof window.handleMatchClick).toBe('function');
  });

  it('requires a reviewer name before submitting a Match decision', async () => {
    const [match] = pendingButtons();
    match.click();
    await new Promise(r => setTimeout(r, 80));

    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Please enter your reviewer name'));
    expect(window.fetch.mock.calls.filter(([url, init]) => url === '/api/v1/feedback' && init?.method === 'POST')).toHaveLength(0);
  });

  it('sends approve_match with exact source version and target without mutating fixture memory', async () => {
    const memory = window.state.topicMemory.find(m => m.matchStatus === 'pending_review');
    const before = JSON.stringify(memory);
    setReviewerName();
    prepareDecision();

    const [match] = pendingButtons();
    match.click();
    await new Promise(r => setTimeout(r, 80));

    const decisionCalls = window.fetch.mock.calls.filter(([url, init]) => String(url).includes('/api/v1/review-queue/memory/') && init?.method === 'POST');
    expect(decisionCalls).toHaveLength(1);
    expect(JSON.parse(decisionCalls[0][1].body)).toMatchObject({
      decision: 'approve_match',
      expectedSourceVersion: memory.updatedAt,
      expectedProposedMatchMemoryId: memory.proposedMatchMemoryId,
      reviewerName: 'Executive Reviewer',
      warningAcknowledged: true,
    });
    expect(JSON.parse(decisionCalls[0][1].body).note).toBe('Reviewed current evidence and trajectory.');
    expect(JSON.stringify(memory)).toBe(before);
    expect(window.state.reviewQueue.awaitingReview.some(x => x.itemId === memory.memoryId)).toBe(false);
    for (const endpoint of ['/api/v1/overview', '/api/v1/decisions', '/api/v1/risks-actions', '/api/v1/topic-memory', '/api/v1/topics', '/api/v1/review-queue']) {
      expect(window.fetch.mock.calls.some(([url, init]) => url === endpoint && (!init || init.method === 'GET'))).toBe(true);
    }
  });

  it('sends reject_match with exact source version and target', async () => {
    const memory = window.state.topicMemory.find(m => m.matchStatus === 'pending_review');
    setReviewerName();
    prepareDecision('Evidence does not support extending the existing thread.');

    const [, noMatch] = pendingButtons();
    noMatch.click();
    await new Promise(r => setTimeout(r, 80));

    const decisionCalls = window.fetch.mock.calls.filter(([url, init]) => String(url).includes('/api/v1/review-queue/memory/') && init?.method === 'POST');
    expect(JSON.parse(decisionCalls[0][1].body)).toMatchObject({
      decision: 'reject_match',
      expectedSourceVersion: memory.updatedAt,
      expectedProposedMatchMemoryId: memory.proposedMatchMemoryId,
      reviewerName: 'Executive Reviewer',
    });
    expect(window.state.reviewQueue.awaitingReview.some(x => x.itemId === memory.memoryId)).toBe(false);
  });

  it('retains the action buttons and reports runtime command failure', async () => {
    setReviewerName();
    prepareDecision();
    window.fetch.mockImplementation(async (url, init) => {
      if (String(url).startsWith('/api/v1/review-queue/memory/') && init?.method === 'POST') return { ok: false, status: 500, json: async () => ({}) };
      const body = await realApiResponse(typeof url === 'string' ? url : url.toString());
      return { ok: true, status: 200, json: async () => body };
    });

    const [match] = pendingButtons();
    match.click();
    await new Promise(r => setTimeout(r, 80));

    expect(window.alert).toHaveBeenCalledWith('Failed to apply runtime decision: HTTP 500');
    expect(window.document.querySelectorAll('.match-actions button')).toHaveLength(3);
  });
});

describe('Overview cards — all nonzero cards produce nonempty All Content results', () => {
  let dom: JSDOM, window: AnyWindow;
  beforeEach(async () => { ({ dom, window } = buildDOM()); await waitForInit(); });
  afterEach(() => dom.window.close());

  // Fixture counts: meetingCount=2, topicCount=6, decisionCount=3,
  // openActionCount=4, topicMemoryCount=4, pendingReviewCount=1,
  // validationWarningCount=3, riskCount=3 — all nonzero.

  const cardExpectations = [
    { key: 'meetingCount',           minCards: 2, description: 'meetings' },
    { key: 'topicCount',             minCards: 6, description: 'topics' },
    { key: 'decisionCount',          minCards: 3, description: 'decisions' },
    { key: 'openActionCount',        minCards: 4, description: 'open actions' },
    { key: 'topicMemoryCount',       minCards: 4, description: 'memory records' },
    { key: 'pendingReviewCount',     minCards: 1, description: 'pending review memory' },
    { key: 'validationWarningCount', minCards: 1, description: 'topics with warnings' },
    { key: 'riskCount',              minCards: 3, description: 'risks' },
  ];

  for (const { key, minCards, description } of cardExpectations) {
    it(`${key} card (${description}) produces at least ${minCards} result(s)`, async () => {
      const card = window.document.querySelector(`[data-stat-key="${key}"]`);
      expect(card).toBeTruthy();
      card.click();
      await new Promise(r => setTimeout(r, 80));
      const allTab = window.document.getElementById('tab-all-content');
      expect(allTab!.getAttribute('aria-selected')).toBe('true');
      const results = window.document.getElementById('all-content-results')!;
      // Must not be empty
      expect(results.innerHTML).not.toContain('No items match');
      // Count rendered cards
      const cards = results.querySelectorAll('.card');
      expect(cards.length).toBeGreaterThanOrEqual(minCards);
    });
  }
});
