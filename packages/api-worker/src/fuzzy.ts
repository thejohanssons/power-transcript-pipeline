// ============================================================
// Copyright (c) 2026 Virrata AB. All rights reserved.
// EIP Platform — Fuzzy Topic Deduplication Helper
// ============================================================

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for',
  'with', 'by', 'from', 'is', 'are', 'was', 'be', 'as', 'it', 'its',
]);

/**
 * Extract meaningful keywords from a topic slug or name.
 * e.g. "pcb-supply-risk" → ["pcb", "supply", "risk"]
 */
export function extractKeywords(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .split(/[-\s]+/)
    .filter(w => w.length > 1 && !STOPWORDS.has(w));
}

/**
 * Compute Levenshtein distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Keyword overlap score: shared keywords / union of keywords (Jaccard)
 */
function keywordSimilarity(kw1: string[], kw2: string[]): number {
  if (kw1.length === 0 || kw2.length === 0) return 0;
  const set1 = new Set(kw1);
  const set2 = new Set(kw2);
  const intersection = [...set1].filter(w => set2.has(w)).length;
  const union = new Set([...set1, ...set2]).size;
  return intersection / union;
}

export interface FuzzyMatch {
  topic_id: string;
  topic_name: string;
  similarity: number;
  method: 'exact' | 'levenshtein' | 'keyword';
}

/**
 * Find fuzzy duplicate candidates for an incoming topic.
 *
 * Returns:
 *  - exact match (similarity = 1.0) → should update existing, not create
 *  - near matches (similarity > threshold) → flag as merge candidates
 *  - empty array → no match, safe to create new topic
 */
export function findFuzzyMatches(
  incomingId: string,
  incomingName: string,
  incomingDomain: string,
  existingTopics: Array<{ topic_id: string; topic_name: string; domain: string }>
): FuzzyMatch[] {
  const matches: FuzzyMatch[] = [];
  const incomingKw = extractKeywords(incomingId + ' ' + incomingName);

  for (const existing of existingTopics) {
    // Only compare within the same domain (cross-domain same name = different topics)
    const sameDomain = existing.domain === incomingDomain;

    // 1. Exact slug match
    if (existing.topic_id === incomingId) {
      matches.push({ topic_id: existing.topic_id, topic_name: existing.topic_name, similarity: 1.0, method: 'exact' });
      continue;
    }

    // 2. Levenshtein on slug (only same domain)
    if (sameDomain) {
      const dist = levenshtein(incomingId, existing.topic_id);
      const maxLen = Math.max(incomingId.length, existing.topic_id.length);
      const lev = 1 - dist / maxLen;
      if (lev >= 0.75) {
        matches.push({ topic_id: existing.topic_id, topic_name: existing.topic_name, similarity: lev, method: 'levenshtein' });
        continue;
      }
    }

    // 3. Keyword overlap (same domain, ≥2 shared keywords OR Jaccard ≥ 0.5)
    if (sameDomain) {
      const existingKw = extractKeywords(existing.topic_id + ' ' + existing.topic_name);
      const sharedCount = incomingKw.filter(w => existingKw.includes(w)).length;
      const jaccard = keywordSimilarity(incomingKw, existingKw);
      if (sharedCount >= 2 || jaccard >= 0.5) {
        matches.push({ topic_id: existing.topic_id, topic_name: existing.topic_name, similarity: jaccard, method: 'keyword' });
      }
    }
  }

  // Sort by similarity descending
  return matches.sort((a, b) => b.similarity - a.similarity);
}
