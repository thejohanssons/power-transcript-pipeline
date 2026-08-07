# Cloudflare Runtime Implementation Handover

## Purpose

This handover summarizes the approved Phase 1 proposal for the new Cloudflare runtime and records the starting position for the next implementation session.

## Approval summary

- Approved: `packages/cloudflare-runtime/` package will be created.
- Approval status: Phase 1 foundation work can begin.
- Runtime-shadow package (`packages/runtime-shadow/`) remains intact through Phase 1 and Phase 2.

## Key design decisions

1. Package name: `packages/cloudflare-runtime/`
2. New worker routes:
   - `POST /v1/meetings`
   - `GET /v1/topic-memory`
   - `POST /v1/topic-memory/:id/match`
3. Topic Memory matching algorithm (Phase 2):
   - Primary match signal: same `entity` + same `entityType`
   - Secondary signal: normalized topic statement similarity via keyword overlap
   - Threshold: propose a match when primary signal matches AND topic statements share at least 2 significant words
   - No auto-merge: every proposed match requires explicit human confirmation
4. Teams notification format:
   - Use an Adaptive Card with action buttons
   - Buttons POST back to `POST /v1/topic-memory/:id/match`
   - The action payload is authenticated by a shared token or worker-bound secret

## Phase 1 work scope

1. Define D1 schema for:
   - `meetings`
   - `topics`
   - `topic_memory`
   - `people`
   - `actions`
   - `decisions`
2. Define runtime contracts in `contracts.ts`:
   - `TranscriptSubmission`
   - `MeetingOutput`
   - `TopicMemoryRecord`
3. Create package scaffolding under `packages/cloudflare-runtime/`.
4. Document the new pipeline handoff plan:
   - replace `Submit-RuntimeShadowAzureExport` with `Submit-TranscriptToCloudflare`
   - submit transcript + metadata only

## Next session objectives

- Create `packages/cloudflare-runtime/` scaffolding
- Add `contracts.ts`, schema migration(s), and route skeletons
- Add Phase 1 tests for contract validation
- Confirm pipeline handoff details in `packages/pipeline/power-transcript-pipeline.ps1`
