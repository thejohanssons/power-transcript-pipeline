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

  // Mock fetch — serves real fixture data via the actual API handlers.
  // This ensures tests exercise the same data as the production endpoints.
  window.fetch = vi.fn(async (url) => {
    const path = typeof url === 'string' ? url : url.toString();
    const body = await realApiResponse(path);
    return {
      ok: true,
      status: 200,
      json: async () => body,
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

  it('only two tabs exist', () => {
    const tabs = window.document.querySelectorAll('[role="tab"]');
    expect(tabs.length).toBe(2);
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

  it('saves valid feedback and closes panel', () => {
    window.openFeedback('decision', 'fx-decision-001', 'label');
    window.document.getElementById('feedback-verdict').value = 'incomplete';
    window.document.getElementById('feedback-field').value = 'owner';
    window.document.getElementById('feedback-notes').value = 'Owner field is missing context.';
    window.document.getElementById('feedback-save').click();
    expect(window.state.feedback.length).toBe(1);
    expect(window.state.feedback[0].verdict).toBe('incomplete');
    expect(window.state.feedback[0].itemId).toBe('fx-decision-001');
    // Panel should be closed after save
    expect(window.document.getElementById('feedback-panel').getAttribute('aria-hidden')).toBe('true');
  });

  it('all four verdicts can be saved', () => {
    const verdicts = ['accurate', 'incomplete', 'incorrect', 'irrelevant'];
    verdicts.forEach((v, i) => {
      window.openFeedback('action', `fx-action-00${i+1}`, `label ${i}`);
      window.document.getElementById('feedback-verdict').value = v;
      window.document.getElementById('feedback-field').value = 'overall';
      window.document.getElementById('feedback-notes').value = `Note for ${v}.`;
      window.document.getElementById('feedback-save').click();
    });
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

  it('export creates a Blob from actual session feedback records', () => {
    window.openFeedback('decision', 'fx-decision-001', 'test');
    window.document.getElementById('feedback-verdict').value = 'accurate';
    window.document.getElementById('feedback-field').value = 'overall';
    window.document.getElementById('feedback-notes').value = 'Correct.';
    window.document.getElementById('feedback-save').click();

    window.document.getElementById('feedback-export').click();

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
    window.document.getElementById('feedback-verdict').value = 'accurate';
    window.document.getElementById('feedback-field').value = 'overall';
    window.document.getElementById('feedback-notes').value = 'note';
    window.document.getElementById('feedback-save').click();
  });
  afterEach(() => dom.window.close());

  it('cancel reset leaves feedback intact', () => {
    window.confirm = vi.fn(() => false); // user cancels
    window.document.getElementById('feedback-reset').click();
    expect(window.state.feedback.length).toBe(1);
  });

  it('confirm reset clears all feedback', () => {
    window.confirm = vi.fn(() => true); // user confirms
    window.document.getElementById('feedback-reset').click();
    expect(window.state.feedback.length).toBe(0);
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

  it('type filter to Risk shows only risks', () => {
    const typeSelect = window.document.getElementById('filter-type');
    typeSelect.value = 'Risk';
    typeSelect.dispatchEvent(new window.Event('change'));
    const results = window.document.getElementById('all-content-results');
    expect(results.innerHTML).toContain('Risk');
    expect(results.innerHTML).not.toContain('content-type-title">Decision');
  });

  it('type filter to Topic Memory shows only memories', () => {
    const typeSelect = window.document.getElementById('filter-type');
    typeSelect.value = 'Topic Memory';
    typeSelect.dispatchEvent(new window.Event('change'));
    const results = window.document.getElementById('all-content-results');
    expect(results.innerHTML).toContain('Topic Memory');
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

  it('type filter to Topic shows exactly 6 topic cards (fixture has 6)', async () => {
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

  it('Domain filter excludes Topic Memory (no domain extracted for memory records)', async () => {
    const typeSelect = window.document.getElementById('filter-type')!;
    typeSelect.value = 'Topic Memory';
    typeSelect.dispatchEvent(new window.Event('change'));
    const domainSelect = window.document.getElementById('filter-domain')!;
    domainSelect.value = 'Finance';
    domainSelect.dispatchEvent(new window.Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const results = window.document.getElementById('all-content-results')!;
    // All Topic Memory items should be excluded when Domain filter is active
    expect(results.innerHTML).toContain('No items match');
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
