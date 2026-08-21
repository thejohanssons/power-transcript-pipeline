import type { D1Database } from '@cloudflare/workers-types';

export interface ConsolidationRequest { meetingIds: string[]; }
export interface ConsolidationProposal {
  topicId: string;
  meetingId: string;
  topicStatement: string;
  memoryId: string | null;
  confidence: 'high' | 'ambiguous' | 'unmatched' | 'new-memory-candidate';
  score: number;
  competingMemoryIds: string[];
  bestCandidateMemoryId: string | null;
  bestCandidateScore: number;
  bestCandidateStatement: string | null;
}
export interface RootTopicProposal { memoryId: string; rootTopicId: string | null; linkedTopicIds: string[]; duplicateMemoryIds: string[]; }
interface TopicRow { topic_id: string; meeting_id: string; event_date: string | null; entity_type: string | null; entity: string | null; aspect: string | null; topic_statement: string; memory_id: string | null; }
interface MemoryRow { memory_id: string; entity_type: string; entity: string; aspect: string | null; canonical_statement: string; root_topic_id: string | null; first_seen_date: string | null; status: string; match_status: string; }
interface MemoryCluster { representative: MemoryRow; members: MemoryRow[]; }

function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((word) => word.length > 2));
}
function overlap(a: string, b: string): number {
  const left = tokens(a); const right = tokens(b); let count = 0;
  for (const word of left) if (right.has(word)) count += 1;
  return count;
}
export function normalizeStatement(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function similarity(a: string, b: string): number {
  const left = tokens(a); const right = tokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let common = 0;
  for (const word of left) if (right.has(word)) common += 1;
  return common / (left.size + right.size - common);
}
export function normalizeEntityKey(value: string | null): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/\b(v|ver|version)?\s*\d+(?:\.\d+)+(?:\b|$)/g, '')
    .replace(/\b(update|updates|work|workstream|issue|readiness|project)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function sameIdentity(a: MemoryRow, b: { entity_type: string | null; entity: string | null; aspect: string | null }): boolean {
  return a.entity_type === b.entity_type && normalizeEntityKey(a.entity) === normalizeEntityKey(b.entity) && a.aspect === b.aspect;
}
function isTestId(value: string | null | undefined): boolean { return Boolean(value && /^TEST-/i.test(value)); }

export function parseConsolidationRequest(body: unknown): ConsolidationRequest {
  const value = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  return { meetingIds: Array.isArray(value.meetingIds) ? value.meetingIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0) : [] };
}

function clusterMemories(memories: MemoryRow[]): MemoryCluster[] {
  const clusters: MemoryCluster[] = [];
  for (const memory of memories) {
    const cluster = clusters.find((candidate) => sameIdentity(candidate.representative, memory) && similarity(candidate.representative.canonical_statement, memory.canonical_statement) >= 0.8);
    if (cluster) {
      cluster.members.push(memory);
      if ((memory.first_seen_date ?? memory.memory_id) < (cluster.representative.first_seen_date ?? cluster.representative.memory_id)) cluster.representative = memory;
    } else {
      clusters.push({ representative: memory, members: [memory] });
    }
  }
  return clusters;
}

export async function previewMemoryConsolidation(db: D1Database, request: ConsolidationRequest) {
  const meetingFilter = request.meetingIds.length > 0;
  const placeholders = meetingFilter ? request.meetingIds.map(() => '?').join(',') : '';
  const topicSql = `SELECT t.topic_id,t.meeting_id,m.event_date,t.entity_type,t.entity,t.aspect,t.topic_statement,t.memory_id
    FROM topics t JOIN meetings m ON m.meeting_id=t.meeting_id
    WHERE m.state <> 'invalidated' AND t.memory_id IS NULL ${meetingFilter ? `AND t.meeting_id IN (${placeholders})` : ''}
    ORDER BY m.event_date,t.topic_id`;
  const allTopics = (meetingFilter ? await db.prepare(topicSql).bind(...request.meetingIds).all<TopicRow>() : await db.prepare(topicSql).all<TopicRow>()).results;
  const topics = allTopics.filter((topic) => !isTestId(topic.meeting_id));
  const memories = (await db.prepare(`SELECT memory_id,entity_type,entity,aspect,canonical_statement,root_topic_id,first_seen_date,status,match_status
    FROM topic_memory WHERE status <> 'invalidated' ORDER BY first_seen_date,memory_id`).all<MemoryRow>()).results.filter((memory) => !isTestId(memory.memory_id) && !isTestId(memory.entity));
  const clusters = clusterMemories(memories);

  const proposals: ConsolidationProposal[] = topics.map((topic) => {
    const candidates = clusters
      .filter((cluster) => cluster.representative.entity_type === topic.entity_type && normalizeEntityKey(cluster.representative.entity) === normalizeEntityKey(topic.entity))
      .map((cluster) => {
        const exactStatement = normalizeStatement(cluster.representative.canonical_statement) === normalizeStatement(topic.topic_statement);
        return { cluster, exactStatement, score: exactStatement ? 100 : overlap(cluster.representative.canonical_statement, topic.topic_statement) + (cluster.representative.aspect === topic.aspect ? 2 : 0) };
      })
      .sort((a, b) => b.score - a.score);
    const best = candidates[0]; const second = candidates[1];
    const confidence: ConsolidationProposal['confidence'] = !best
      ? 'new-memory-candidate'
      : best.exactStatement
        ? 'high'
        : best.score < 4
          ? 'new-memory-candidate'
          : (!second || best.score - second.score >= 2) ? 'high' : 'ambiguous';
    const relevantCompetitors = candidates.slice(1).filter((candidate) => candidate.score >= (best?.score ?? 0) - 2).slice(0, 5);
    return {
      topicId: topic.topic_id,
      meetingId: topic.meeting_id,
      topicStatement: topic.topic_statement,
      memoryId: confidence === 'high' ? best.cluster.representative.memory_id : null,
      confidence,
      score: best?.score ?? 0,
      competingMemoryIds: relevantCompetitors.map((candidate) => candidate.cluster.representative.memory_id),
      bestCandidateMemoryId: best?.cluster.representative.memory_id ?? null,
      bestCandidateScore: best?.score ?? 0,
      bestCandidateStatement: best?.cluster.representative.canonical_statement ?? null,
    };
  });

  const roots: RootTopicProposal[] = clusters.map((cluster) => {
    const linked = proposals.filter((proposal) => proposal.memoryId === cluster.representative.memory_id).sort((a, b) => a.meetingId.localeCompare(b.meetingId));
    return {
      memoryId: cluster.representative.memory_id,
      rootTopicId: cluster.representative.root_topic_id ?? linked[0]?.topicId ?? null,
      linkedTopicIds: linked.map((proposal) => proposal.topicId),
      duplicateMemoryIds: cluster.members.map((member) => member.memory_id).filter((id) => id !== cluster.representative.memory_id),
    };
  }).filter((root) => root.linkedTopicIds.length > 0 || root.duplicateMemoryIds.length > 0 || root.rootTopicId !== null);

  return {
    dryRun: true,
    topicsScanned: topics.length,
    excludedTestTopics: allTopics.length - topics.length,
    memoriesScanned: memories.length,
    duplicateMemoryClusters: clusters.filter((cluster) => cluster.members.length > 1).length,
    duplicateMemoryRows: clusters.reduce((count, cluster) => count + Math.max(0, cluster.members.length - 1), 0),
    highConfidenceLinks: proposals.filter((proposal) => proposal.confidence === 'high').length,
    ambiguousLinks: proposals.filter((proposal) => proposal.confidence === 'ambiguous').length,
    unmatchedTopics: proposals.filter((proposal) => proposal.confidence === 'unmatched').length,
    newMemoryCandidates: proposals.filter((proposal) => proposal.confidence === 'new-memory-candidate').length,
    proposals,
    roots,
  };
}
