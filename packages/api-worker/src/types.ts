// ============================================================
// Copyright (c) 2026 Virrata AB. All rights reserved.
// EIP Platform — Shared Types
// ============================================================

export interface Topic {
  topic_id: string;
  topic_name: string;
  domain: string;
  category: string;
  current_status: string;
  current_priority: string;
  owner: string | null;
  first_seen: string;
  last_seen: string;
  occurrence_count: number;
  trend: string;
  confluence_url: string | null;
  sp_list_item_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TopicOccurrence {
  occurrence_id: string;
  topic_id: string;
  meeting_ref: string | null;
  meeting_date: string | null;
  context: string | null;
  priority: string | null;
  summary: string | null;
  source: string;
  user_notes: string | null;
  status: string;
  session_id: string | null;
  confluence_url: string | null;
  sp_item_id: string | null;
  created_at: string;
  processed_at: string | null;
}

export interface Transcript {
  transcript_id: string;
  meeting_ref: string;
  r2_key: string | null;
  meeting_date: string;
  source_system: string;
  segment_count: number;
  processed: number;
  created_at: string;
}

export interface Session {
  session_id: string;
  session_date: string;
  session_type: string | null;
  user_intent: string | null;
  topics_reviewed: number;
  topics_added: number;
  topics_rejected: number;
  agent_summary: string | null;
  follow_up_flags: string | null;
  created_at: string;
}

export interface MergeCandidate {
  candidate_id: string;
  topic_id_a: string;
  topic_id_b: string;
  similarity: number;
  method: string;
  status: string;
  suggested_canonical: string | null;
  created_at: string;
  resolved_at: string | null;
}

// --- Request body types ---

export interface PostTopicBody {
  topic_id: string;
  topic_name: string;
  domain: string;
  category: string;
  priority?: string;
  owner?: string;
  summary?: string;
  meeting_ref?: string;
  meeting_date?: string;
  context?: string;
  source?: string;
  confluence_url?: string;
}

export interface PostTranscriptBody {
  transcript_id: string;
  meeting_ref: string;
  meeting_date: string;
  source_system?: string;
  segment_count?: number;
  r2_key?: string;
}

export interface PatchQueueBody {
  status: 'Approved' | 'Rejected';
  user_notes?: string;
  priority?: string;
  session_id?: string;
}

export interface PostSessionBody {
  session_id: string;
  session_type?: string;
  user_intent?: string;
  topics_reviewed?: number;
  topics_added?: number;
  topics_rejected?: number;
  agent_summary?: string;
  follow_up_flags?: string[];
}
