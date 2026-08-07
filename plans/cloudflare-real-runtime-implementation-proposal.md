# Cloudflare Real Runtime Implementation Proposal

## Objective

Build a production Cloudflare runtime that consumes raw transcripts and meeting metadata from the Azure pipeline, processes them with the v0.2 taxonomy, and persists canonical Topic Memory and People Memory in D1/R2.

This proposal preserves the current runtime-shadow staging lane until the new runtime is validated and ready for a safe cutover.

## What this implementation is

- A real Cloudflare Worker runtime, not a shadow-only comparison lane.
- An independent processing path that receives raw transcript + metadata only.
- A D1/R2-backed persistence layer for meetings, topics, topic memory, people, actions, decisions, and full normalized meeting output.
- A topic-memory matching engine with reviewer intervention via Teams cards.
- A minimal pipeline contract that replaces the existing Azure-export shadow submission with a transcript-only submission.

## What this does not do yet

- It does not take over Azure publishing.
- It does not delete or disable the existing runtime-shadow package until after validation.
- It does not try to compare with Azure outcomes during the first real-runtime phase.
- It does not perform SharePoint, Confluence, or Teams publishing from Cloudflare until a later, explicitly approved stage.

## Proposed package boundary

The new runtime should live as a separate Cloudflare worker package, not as a modification of the current `packages/runtime-shadow` parity worker.

Possible package layout:

- `packages/cloudflare-runtime/`
- `src/index.ts` for HTTP routes
- `src/contracts.ts` for transcript/meeting output/topic memory types
- `src/meeting-processing.ts` for transcript processing and taxonomy prompt generation
- `src/topic-memory.ts` for matching and metadata persistence
- `src/index.ts` routes for `/v1/meetings`, `/v1/topic-memory`, and `/v1/topic-memory/:id/match`

Use `packages/cloudflare-runtime/` as the durable package name. "Real" is a temporary comparison to the existing shadow package and should not be baked into the source path.

This keeps the current shadow implementation intact while the real runtime is built.

## Phase 1: Safe foundation work (non-breaking)

These are the first tasks and the ones I recommend we start with now.

1. Define the D1 schema:
   - `meetings`
   - `topics`
   - `topic_memory`
   - `people`
   - `actions`
   - `decisions`
2. Define the new runtime contracts in `contracts.ts`:
   - `TranscriptSubmission`
   - `MeetingOutput`
   - `TopicMemoryRecord`
3. Create the new worker package scaffolding and API route plan.
4. Keep the existing pipeline unchanged while the new runtime schema and contract are finalized.
5. Add documentation of the planned pipeline switch from `Submit-RuntimeShadowAzureExport` to `Submit-TranscriptToCloudflare`.

## Phase 2: Core implementation

1. Build `meeting-processing.ts`:
   - Use v0.2 taxonomy vocabulary in prompts
   - Normalize transcript into topics, people, actions, decisions
2. Build `topic-memory.ts`:
   - Persist topic memory
   - Implement matching and reviewer state
   - Emit Teams notification payloads and accept/reject endpoints
   - Implement matching using:
     - Primary signal: same `entity` + same `entityType`
     - Secondary signal: normalized topic statement similarity using keyword overlap
     - Match threshold: if primary signal matches AND the topic statements share at least 2 significant words, propose a candidate match
     - No auto-merge: all proposed matches require explicit human confirmation via Teams/API
3. Implement simplified `index.ts` with:
   - `POST /v1/meetings`
   - `GET/POST /v1/topic-memory`
   - `POST /v1/topic-memory/:id/match`
   - Ensure the Teams card can POST back to `/v1/topic-memory/:id/match` with an auth token, so review actions can occur directly from the Adaptive Card without a separate UI.
4. Add unit and integration tests for the new routes and contracts.

## Phase 3: Pipeline handoff and cutover

1. Update Azure pipeline to use `Submit-TranscriptToCloudflare` with transcript + metadata only.
2. Ensure the new submission is non-blocking and does not alter existing Azure publication.
3. Validate end-to-end flow from Azure to Cloudflare via the new endpoint.
4. Keep the old runtime-shadow lane running in parallel for rollback safety.

## Phase 4: Shadow cleanup and final transition

1. Only after the new runtime is validated, remove shadow-only artifacts:
   - `comparison.ts`
   - `azure-export-processing.ts`
   - `azure-export-handoff.ts`
   - `reviewer-disposition.ts`
   - `shadow-policy.ts`
   - fixture/comparison files and staging-only metadata
2. Remove pipeline calls to `Submit-RuntimeShadowAzureExport`.
3. Document the cutover and rollback procedure.

## Risks and governance

- Keep the current runtime-shadow worker intact until the real runtime is working.
- Do not merge or deploy any publishing changes before the new runtime has a reviewable artifact set.
- Preserve versioned contract definitions and D1 schema migrations for traceability.
- Maintain a clear separation between Azure v4.2 taxonomy and Cloudflare v0.2 taxonomy.

## Recommended next step

Start with the safe, non-breaking foundation work in Phase 1:

- finalize the D1 schema
- define the runtime contracts
- establish a separate package boundary for the new runtime

Once those are agreed, I can begin implementation in the next session.
