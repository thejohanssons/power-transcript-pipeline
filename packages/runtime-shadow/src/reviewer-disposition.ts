import type { ComparisonDifference, ComparisonDisposition } from './contracts';

const DISPOSITIONS = new Set<ComparisonDisposition>([
  'accepted_equivalent',
  'accepted_intentional_improvement',
  'baseline_defect',
  'cloudflare_defect',
  'unresolved',
]);

export interface ReviewerDispositionInput {
  path?: unknown;
  disposition?: unknown;
  reviewerId?: unknown;
  note?: unknown;
}

export interface ValidReviewerDisposition {
  path: string;
  disposition: ComparisonDisposition;
  reviewerId: string;
  note: string;
}

export function validateReviewerDisposition(
  input: ReviewerDispositionInput,
  differences: ComparisonDifference[],
): ValidReviewerDisposition | null {
  if (typeof input.path !== 'string' || input.path.length === 0 || input.path.length > 256) return null;
  if (!DISPOSITIONS.has(input.disposition as ComparisonDisposition)) return null;
  if (typeof input.reviewerId !== 'string' || input.reviewerId.trim().length === 0 || input.reviewerId.length > 128) return null;
  if (typeof input.note !== 'string' || input.note.trim().length === 0 || input.note.length > 2_000) return null;

  const matchingDifference = differences.find((difference) => difference.path === input.path);
  if (!matchingDifference || matchingDifference.severity !== 'material') return null;

  return {
    path: input.path,
    disposition: input.disposition as ComparisonDisposition,
    reviewerId: input.reviewerId.trim(),
    note: input.note.trim(),
  };
}

export async function hasMatchingReviewerToken(request: Request, expectedToken: string): Promise<boolean> {
  const suppliedToken = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!suppliedToken || !expectedToken) return false;

  const encoder = new TextEncoder();
  const supplied = encoder.encode(suppliedToken);
  const expected = encoder.encode(expectedToken);
  if (supplied.byteLength !== expected.byteLength) return false;

  if (typeof crypto.subtle.timingSafeEqual === 'function') {
    return crypto.subtle.timingSafeEqual(supplied, expected);
  }

  // Node's Web Crypto test runtime lacks Workers' timingSafeEqual implementation.
  let mismatch = 0;
  for (let index = 0; index < supplied.length; index += 1) mismatch |= supplied[index] ^ expected[index];
  return mismatch === 0;
}
