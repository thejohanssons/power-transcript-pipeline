#!/usr/bin/env node
/**
 * Read-only runtime D1 smoke test.
 *
 * Pulls topics and topic memory from the production runtime D1, then prints:
 *   1. Actions grouped by owner
 *   2. Decisions
 *   3. Risks
 *
 * Usage:
 *   node --env-file=.env.local scripts/test-runtime-topic-lists.mjs
 *   node --env-file=.env.local scripts/test-runtime-topic-lists.mjs --json
 *   node --env-file=.env.local scripts/test-runtime-topic-lists.mjs --limit 100
 *   node --env-file=.env.local scripts/test-runtime-topic-lists.mjs --owner "Theo Davies"
 *   node --env-file=.env.local scripts/test-runtime-topic-lists.mjs --status Open
 *   node --env-file=.env.local scripts/test-runtime-topic-lists.mjs --meeting-id 2026-08-13_1100_example
 *   node --env-file=.env.local scripts/test-runtime-topic-lists.mjs --topic-memory-id memory-123
 */

const argv = process.argv.slice(2);
const args = new Set(argv);
const jsonOutput = args.has('--json');

function optionValue(name) {
  const inline = argv.find(arg => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

const limitValue = Number(optionValue('--limit') ?? 200);
const pageSize = Number.isFinite(limitValue) && limitValue > 0 ? Math.floor(limitValue) : 200;
const filters = {
  owner: optionValue('--owner')?.trim() || null,
  status: optionValue('--status')?.trim() || null,
  meetingId: optionValue('--meeting-id')?.trim() || null,
  topicMemoryId: optionValue('--topic-memory-id')?.trim() || null,
};

const required = [
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_D1_READ_TOKEN',
  'RUNTIME_D1_DATABASE_ID',
];
const missing = required.filter(name => !process.env[name]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const queryUrl = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${process.env.RUNTIME_D1_DATABASE_ID}/query`;

async function query(sql, params = []) {
  const response = await fetch(queryUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_D1_READ_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params }),
  });

  const payload = await response.json();
  if (!response.ok || !payload.success) {
    const detail = payload.errors?.map(error => error.message).join('; ') || response.statusText;
    throw new Error(`D1 query failed: ${detail}`);
  }
  return payload.result?.[0]?.results ?? [];
}

async function paginate(sql, params = []) {
  const rows = [];
  let offset = 0;
  while (true) {
    const page = await query(sql, [...params, pageSize, offset]);
    rows.push(...page);
    if (page.length < pageSize) return rows;
    offset += pageSize;
  }
}

function parseJson(raw, fallback) {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function evidenceText(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.text === 'string') return value.text;
  return value == null ? '' : JSON.stringify(value);
}

function ownerName(owner) {
  const value = typeof owner === 'string' ? owner.trim() : '';
  return value || 'Unassigned';
}

function topicLabel(topic) {
  return topic.topic_statement || topic.entity || topic.topic_id;
}

function matchesFilters(item) {
  if (filters.owner && (item.owner ?? '').toLowerCase() !== filters.owner.toLowerCase()) return false;
  if (filters.status && (item.status ?? '').toLowerCase() !== filters.status.toLowerCase()) return false;
  if (filters.meetingId && item.meetingId !== filters.meetingId) return false;
  if (filters.topicMemoryId && item.memoryId !== filters.topicMemoryId) return false;
  return true;
}

function matchesMemoryFilters(memory) {
  if (filters.status && (memory.status ?? '').toLowerCase() !== filters.status.toLowerCase()) return false;
  if (filters.meetingId && memory.last_seen_meeting_id !== filters.meetingId) return false;
  if (filters.topicMemoryId && memory.memory_id !== filters.topicMemoryId) return false;
  return true;
}

async function main() {
  const topics = await paginate(
    `SELECT topic_id, meeting_id, topic_statement, summary, actions_json,
            decisions_json, risks_json, owners_json, memory_id, created_at
       FROM topics
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?`,
  );
  const memories = await paginate(
    `SELECT memory_id, domain, entity_type, entity, aspect, canonical_statement,
            last_seen_meeting_id, last_seen_date, meeting_count, match_status,
            status, updated_at
       FROM topic_memory
      ORDER BY last_seen_date DESC
      LIMIT ? OFFSET ?`,
  );

  const actions = await paginate(
    `SELECT action_id, meeting_id, topic_id, owner, text, due_date, status,
            created_at, updated_at
       FROM actions
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
  );
  const decisionsFromTable = await paginate(
    `SELECT decision_id, meeting_id, topic_id, owner, text, created_at, updated_at
       FROM decisions
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
  );

  const memoryById = new Map(memories.map(memory => [memory.memory_id, memory]));
  const topicById = new Map(topics.map(topic => [topic.topic_id, topic]));
  const actionsByOwner = new Map();
  const decisions = [];
  const risks = [];

  function contextFor(topicId, meetingId) {
    const topic = topicById.get(topicId);
    const memory = topic?.memory_id ? memoryById.get(topic.memory_id) ?? null : null;
    return {
      topicId: topicId ?? null,
      meetingId,
      topic: topic ? topicLabel(topic) : topicId ?? 'Unlinked topic',
      memoryId: topic?.memory_id ?? null,
      memory: memory?.canonical_statement ?? null,
    };
  }

  // The normalized action table is authoritative. Topic JSON is retained as
  // a compatibility fallback for older records that have no table row.
  const actionTopicIds = new Set(actions.map(action => action.topic_id).filter(Boolean));
  for (const action of actions) {
    const item = {
      ...contextFor(action.topic_id, action.meeting_id),
      actionId: action.action_id,
      owner: ownerName(action.owner),
      text: action.text,
      status: action.status,
      dueDate: action.due_date,
    };
    if (matchesFilters(item)) {
      const list = actionsByOwner.get(item.owner) ?? [];
      list.push(item);
      actionsByOwner.set(item.owner, list);
    }
  }

  for (const decision of decisionsFromTable) {
    const item = {
      ...contextFor(decision.topic_id, decision.meeting_id),
      decisionId: decision.decision_id,
      owner: decision.owner,
      text: decision.text,
    };
    if (matchesFilters(item)) decisions.push(item);
  }

  for (const topic of topics) {
    const context = contextFor(topic.topic_id, topic.meeting_id);
    const owners = parseJson(topic.owners_json, []);
    if (!actionTopicIds.has(topic.topic_id)) {
      for (const action of parseJson(topic.actions_json, [])) {
        const item = {
          ...context,
          owner: ownerName(action?.owner ?? owners[0]),
          text: evidenceText(action),
          status: action?.status ?? null,
          dueDate: action?.due_date ?? action?.dueDate ?? null,
        };
        if (matchesFilters(item)) {
          const list = actionsByOwner.get(item.owner) ?? [];
          list.push(item);
          actionsByOwner.set(item.owner, list);
        }
      }
    }

    for (const risk of parseJson(topic.risks_json, [])) {
      const item = {
        ...context,
        raisedBy: risk?.raised_by ?? risk?.raisedBy ?? null,
        severity: risk?.severity ?? null,
        status: risk?.status ?? null,
        text: evidenceText(risk),
      };
      if (matchesFilters(item)) risks.push(item);
    }
  }

  const filteredTopicMemory = memories.filter(matchesMemoryFilters);

  const result = {
    filters,
    source: {
      databaseId: process.env.RUNTIME_D1_DATABASE_ID,
      topicCount: topics.length,
      topicMemoryCount: memories.length,
      actionRowCount: actions.length,
      decisionRowCount: decisionsFromTable.length,
    },
    actionsByOwner: Object.fromEntries(
      [...actionsByOwner.entries()].sort(([left], [right]) => left.localeCompare(right)),
    ),
    decisions,
    risks,
    topicMemory: filteredTopicMemory,
  };

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Runtime D1: ${result.source.databaseId}`);
  const activeFilters = Object.entries(filters).filter(([, value]) => value).map(([key, value]) => `${key}=${value}`);
  if (activeFilters.length) console.log(`Filters: ${activeFilters.join(', ')}`);
  console.log(`Topics: ${topics.length} | Topic memories: ${result.topicMemory.length}`);
  console.log(`Actions: ${[...actionsByOwner.values()].reduce((count, list) => count + list.length, 0)}`);
  console.log(`Decisions: ${decisions.length} | Risks: ${risks.length}`);

  console.log('\n=== TOPIC MEMORY CARDS ===');
  if (result.topicMemory.length === 0) {
    console.log('(none)');
  }
  for (const [index, memory] of result.topicMemory.entries()) {
    const title = memory.canonical_statement || `${memory.entity}${memory.aspect ? ` — ${memory.aspect}` : ''}`;
    console.log(`\n[${index + 1}] ${title}`);
    console.log(`    ├─ Memory ID: ${memory.memory_id}`);
    console.log(`    ├─ Domain: ${memory.domain || '—'} | Type: ${memory.entity_type || '—'}`);
    console.log(`    ├─ Status: ${memory.status || '—'} | Match: ${memory.match_status || '—'}`);
    console.log(`    ├─ Meetings: ${memory.meeting_count} | First seen: ${memory.first_seen_date || '—'} | Last seen: ${memory.last_seen_date || '—'}`);
    console.log(`    ├─ Outcome: ${memory.latest_outcome || '—'}`);
    console.log(`    ├─ Disposition: ${memory.latest_disposition || '—'} | Scope: ${memory.latest_executive_scope || '—'}`);
    console.log(`    └─ Last meeting: ${memory.last_seen_meeting_id || '—'}`);
  }

  console.log('\n=== ACTIONS BY OWNER ===');
  for (const [owner, items] of Object.entries(result.actionsByOwner)) {
    console.log(`\n${owner} (${items.length} action${items.length === 1 ? '' : 's'})`);
    for (const [index, item] of items.entries()) {
      const status = item.status ? ` [${item.status}]` : '';
      const due = item.dueDate ? ` [due ${item.dueDate}]` : '';
      const actionId = item.actionId ? ` ${item.actionId}` : '';
      const meeting = item.meetingId ? `\n  Meeting: ${item.meetingId}` : '';
      const topic = item.topic ? `\n  Topic: ${item.topic}` : '';
      const memory = item.memory ? `\n  Memory: ${item.memory}` : '';
      console.log(`${index + 1}.${actionId}${status}${due}\n  Action: ${item.text}${meeting}${topic}${memory}`);
    }
  }

  console.log('\n=== DECISIONS ===');
  if (decisions.length === 0) {
    console.log('(none)');
  }
  for (const [index, item] of decisions.entries()) {
    const owner = item.owner ? ` | Owner: ${item.owner}` : '';
    console.log(`\n${index + 1}. ${item.text}${owner}`);
    console.log(`   ├─ Meeting: ${item.meetingId || '—'}`);
    console.log(`   ├─ Topic: ${item.topic || '—'}`);
    console.log(`   └─ Memory: ${item.memory || '—'}`);
  }

  console.log('\n=== RISKS ===');
  if (risks.length === 0) {
    console.log('(none)');
  }
  for (const [index, item] of risks.entries()) {
    const severity = item.severity ? ` | Severity: ${item.severity}` : '';
    const raisedBy = item.raisedBy ? ` | Raised by: ${item.raisedBy}` : '';
    console.log(`\n${index + 1}. ${item.text}${severity}${raisedBy}`);
    console.log(`   ├─ Status: ${item.status || '—'}`);
    console.log(`   ├─ Meeting: ${item.meetingId || '—'}`);
    console.log(`   ├─ Topic: ${item.topic || '—'}`);
    console.log(`   └─ Memory: ${item.memory || '—'}`);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
