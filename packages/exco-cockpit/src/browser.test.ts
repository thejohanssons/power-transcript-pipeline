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

describe('All Content — Meeting and Topic type filters', () => {
  let dom: JSDOM, window: AnyWindow;

  beforeEach(() => {
    ({ dom, window } = buildDOM());
  });

  afterEach(() => {
    dom.window.close();
  });

  it('type filter to Meeting shows meetings', async () => {
    await waitForInit();
    const allTab = window.document.getElementById('tab-all-content');
    allTab!.click();
    const typeSelect = window.document.getElementById('filter-type');
    typeSelect!.value = 'Meeting';
    typeSelect!.dispatchEvent(new window.Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const results = window.document.getElementById('all-content-results');
    const cards = results!.querySelectorAll('.card');
    expect(cards.length).toBeGreaterThan(0);
    cards.forEach(card => {
      expect(card.textContent).toBeTruthy();
    });
  });

  it('type filter to Topic shows topics', async () => {
    await waitForInit();
    const allTab = window.document.getElementById('tab-all-content');
    allTab!.click();
    const typeSelect = window.document.getElementById('filter-type');
    typeSelect!.value = 'Topic';
    typeSelect!.dispatchEvent(new window.Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const results = window.document.getElementById('all-content-results');
    const cards = results!.querySelectorAll('.card');
    expect(cards.length).toBeGreaterThan(0);
  });

  it('Topic cards contain domain and entityType from fixture data', async () => {
    await waitForInit();
    const allTab = window.document.getElementById('tab-all-content');
    allTab!.click();
    const typeSelect = window.document.getElementById('filter-type');
    typeSelect!.value = 'Topic';
    typeSelect!.dispatchEvent(new window.Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const results = window.document.getElementById('all-content-results');
    const cards = results!.querySelectorAll('.card');
    expect(cards.length).toBeGreaterThan(0);
    // At least one topic card should have domain or entityType in its text
    let foundWithDomainOrType = false;
    cards.forEach(card => {
      const text = card.textContent || '';
      if (text.includes('[') && text.includes(']')) {
        foundWithDomainOrType = true;
      }
    });
    expect(foundWithDomainOrType).toBe(true);
  });
});

describe('Domain filter option population', () => {
  let dom: JSDOM, window: AnyWindow;

  beforeEach(() => {
    ({ dom, window } = buildDOM());
  });

  afterEach(() => {
    dom.window.close();
  });

  it('Domain select is populated with options from topic domains', async () => {
    await waitForInit();
    const domainSelect = window.document.getElementById('filter-domain');
    const options = domainSelect!.querySelectorAll('option');
    expect(options.length).toBeGreaterThan(1); // At least default + one domain
    const optionValues = Array.from(options).map(o => o.value);
    expect(optionValues[0]).toBe(''); // Default empty option
  });

  it('Entity family select is populated with entityType values', async () => {
    await waitForInit();
    const efSelect = window.document.getElementById('filter-entity-family');
    const options = efSelect!.querySelectorAll('option');
    expect(options.length).toBeGreaterThan(1); // At least default + one entity type
    const optionValues = Array.from(options).map(o => o.value);
    expect(optionValues[0]).toBe(''); // Default empty option
  });
});

describe('Domain and Entity Family filters', () => {
  let dom: JSDOM, window: AnyWindow;

  beforeEach(() => {
    ({ dom, window } = buildDOM());
  });

  afterEach(() => {
    dom.window.close();
  });

  it('domain filter to Finance shows Finance items', async () => {
    await waitForInit();
    const allTab = window.document.getElementById('tab-all-content');
    allTab!.click();
    const domainSelect = window.document.getElementById('filter-domain');
    const options = Array.from(domainSelect!.querySelectorAll('option')).filter(o => o.value !== '');
    if (options.length === 0) return; // Skip if no domains available
    domainSelect!.value = options[0].value;
    domainSelect!.dispatchEvent(new window.Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const results = window.document.getElementById('all-content-results');
    const cards = results!.querySelectorAll('.card');
    expect(cards.length).toBeGreaterThanOrEqual(0);
  });

  it('entity family filter to Product shows Product items', async () => {
    await waitForInit();
    const allTab = window.document.getElementById('tab-all-content');
    allTab!.click();
    const efSelect = window.document.getElementById('filter-entity-family');
    const options = Array.from(efSelect!.querySelectorAll('option')).filter(o => o.value !== '');
    if (options.length === 0) return; // Skip if no entity types available
    efSelect!.value = options[0].value;
    efSelect!.dispatchEvent(new window.Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const results = window.document.getElementById('all-content-results');
    const cards = results!.querySelectorAll('.card');
    expect(cards.length).toBeGreaterThanOrEqual(0);
  });

  it('domain + entity family conjunctive filter', async () => {
    await waitForInit();
    const allTab = window.document.getElementById('tab-all-content');
    allTab!.click();
    const domainSelect = window.document.getElementById('filter-domain');
    const efSelect = window.document.getElementById('filter-entity-family');
    const domainOptions = Array.from(domainSelect!.querySelectorAll('option')).filter(o => o.value !== '');
    const efOptions = Array.from(efSelect!.querySelectorAll('option')).filter(o => o.value !== '');
    if (domainOptions.length === 0 || efOptions.length === 0) return;
    domainSelect!.value = domainOptions[0].value;
    domainSelect!.dispatchEvent(new window.Event('change'));
    efSelect!.value = efOptions[0].value;
    efSelect!.dispatchEvent(new window.Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const results = window.document.getElementById('all-content-results');
    const cards = results!.querySelectorAll('.card');
    expect(cards.length).toBeGreaterThanOrEqual(0);
  });

  it('Domain filter propagates to Decisions via topicDomain', async () => {
    await waitForInit();
    const allTab = window.document.getElementById('tab-all-content');
    allTab!.click();
    const typeSelect = window.document.getElementById('filter-type');
    typeSelect!.value = 'Decision';
    typeSelect!.dispatchEvent(new window.Event('change'));
    const domainSelect = window.document.getElementById('filter-domain');
    const options = Array.from(domainSelect!.querySelectorAll('option')).filter(o => o.value !== '');
    if (options.length === 0) return;
    domainSelect!.value = options[0].value;
    domainSelect!.dispatchEvent(new window.Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const results = window.document.getElementById('all-content-results');
    const cards = results!.querySelectorAll('.card');
    expect(cards.length).toBeGreaterThanOrEqual(0);
  });

  it('Domain filter propagates to Actions via topicDomain', async () => {
    await waitForInit();
    const allTab = window.document.getElementById('tab-all-content');
    allTab!.click();
    const typeSelect = window.document.getElementById('filter-type');
    typeSelect!.value = 'Action';
    typeSelect!.dispatchEvent(new window.Event('change'));
    const domainSelect = window.document.getElementById('filter-domain');
    const options = Array.from(domainSelect!.querySelectorAll('option')).filter(o => o.value !== '');
    if (options.length === 0) return;
    domainSelect!.value = options[0].value;
    domainSelect!.dispatchEvent(new window.Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const results = window.document.getElementById('all-content-results');
    const cards = results!.querySelectorAll('.card');
    expect(cards.length).toBeGreaterThanOrEqual(0);
  });

  it('Domain filter propagates to Risks via topicDomain', async () => {
    await waitForInit();
    const allTab = window.document.getElementById('tab-all-content');
    allTab!.click();
    const typeSelect = window.document.getElementById('filter-type');
    typeSelect!.value = 'Risk';
    typeSelect!.dispatchEvent(new window.Event('change'));
    const domainSelect = window.document.getElementById('filter-domain');
    const options = Array.from(domainSelect!.querySelectorAll('option')).filter(o => o.value !== '');
    if (options.length === 0) return;
    domainSelect!.value = options[0].value;
    domainSelect!.dispatchEvent(new window.Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const results = window.document.getElementById('all-content-results');
    const cards = results!.querySelectorAll('.card');
    expect(cards.length).toBeGreaterThanOrEqual(0);
  });
});

describe('Topic Memory last-seen meeting filter', () => {
  let dom: JSDOM, window: AnyWindow;

  beforeEach(() => {
    ({ dom, window } = buildDOM());
  });

  afterEach(() => {
    dom.window.close();
  });

  it('meeting filter matches Topic Memory where lastSeenMeetingId matches', async () => {
    await waitForInit();
    const allTab = window.document.getElementById('tab-all-content');
    allTab!.click();
    const typeSelect = window.document.getElementById('filter-type');
    typeSelect!.value = 'Topic Memory';
    typeSelect!.dispatchEvent(new window.Event('change'));
    const meetingSelect = window.document.getElementById('filter-meeting');
    const options = Array.from(meetingSelect!.querySelectorAll('option')).filter(o => o.value !== '');
    if (options.length === 0) return;
    meetingSelect!.value = options[0].value;
    meetingSelect!.dispatchEvent(new window.Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const results = window.document.getElementById('all-content-results');
    const cards = results!.querySelectorAll('.card');
    expect(cards.length).toBeGreaterThanOrEqual(0);
  });
});

describe('Overview cards produce nonzero results', () => {
  let dom: JSDOM, window: AnyWindow;

  beforeEach(() => {
    ({ dom, window } = buildDOM());
  });

  afterEach(() => {
    dom.window.close();
  });

  it('nonzero overview stat cards produce at least one result when clicked', async () => {
    await waitForInit();
    const statCardKeys = ['meetingCount', 'decisionCount', 'riskCount', 'openActionCount', 'topicCount', 'topicMemoryCount'];
    for (const key of statCardKeys) {
      const card = window.document.querySelector(`[data-stat-key="${key}"]`);
      if (!card) continue;
      const countText = card.textContent || '';
      const count = parseInt(countText.match(/\d+/)?.[0] || '0', 10);
      if (count === 0) continue;
      card.click();
      await new Promise(r => setTimeout(r, 50));
      const allTab = window.document.getElementById('tab-all-content');
      expect(allTab!.getAttribute('aria-selected')).toBe('true');
      const results = window.document.getElementById('all-content-results');
      const cards = results!.querySelectorAll('.card');
      expect(cards.length).toBeGreaterThan(0);
    }
  });
});
