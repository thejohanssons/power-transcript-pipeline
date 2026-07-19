# Changelog

All notable changes to the Power Transcript Pipeline are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [1.7.7] — 2026-07-19

### Fixed
- **Smart date parsing for `Sales_Call_*` VTT filenames**: `ConvertFrom-VttFilename` now parses the human-readable meeting date from filenames like `Sales_Call_US_Country_Manager_25_Mar_26` (→ 2026-03-25), placing Topic Records in the correct meeting-date month folder instead of the pipeline run date.
- **`HoD_*` filename match relaxed**: Pattern now allows optional suffixes (e.g. `HoD_20260709_153911_2026-07-09`) without breaking date extraction.

## [1.7.6] — 2026-07-19

### Changed
- **Topic Records folder structure aligned with Meeting Transcripts**: Topic Records are now stored at `Topic Records/YYYY-MM/[meeting-id]/` (previously flat at `Topic Records/[meeting-id]/`). Matches the existing monthly folder structure used by Meeting Transcripts. Applied to all three pipeline call sites (VTT inbox, VTT direct, calendar loop).

### Fixed
- **SharePoint migration**: Migrated 82 existing meeting-level folders from flat `Topic Records/[meeting-id]/` into correct `Topic Records/YYYY-MM/[meeting-id]/` month subfolders.
- **Test folder cleanup**: Removed 19 `source_snapshot` test folders from SharePoint left over from validation runs.

## [1.7.5] — 2026-07-19

### Fixed
- **Context-aware ownership resolution (CPO vs COO)**: Ambiguous topics (Organisation, Resource Allocation, Operational Effectiveness, Delivery Progress, Delivery Risk) were incorrectly assigned to COO even in R&D/product meetings (e.g., Peter–Mandar). The pipeline now defaults these topics to CPO (`Engineering Operations` / `Product Delivery` capabilities) and only overrides to COO when the meeting mode is explicitly COO.

### Added
- **`Product Delivery` capability** (CPO): Covers sprint delivery, feature progress, and dev blockers. Now the default for T05 (Delivery Progress) and T06 (Delivery Risk) instead of COO-owned `Commercial Execution`.
- **`Engineering Operations` capability** (CPO): Covers R&D team structure, dev resource allocation, and engineering process efficiency. Now the default for T12 (Organisation), T13 (Resource Allocation), and T14 (Operational Effectiveness).
- **`ContextOverride` in `taxonomy.json`**: Five topics now carry a `COO` context override block. When a meeting is classified as COO mode (e.g., Nick, Alison), the pipeline automatically switches to `People Operations`, `Supply Operations`, or `Commercial Execution` as appropriate.
- **`MeetingMode` parameter on `Format-TopicRecord`**: All three call sites (VTT inbox, VTT direct, calendar pipeline) now pass the resolved meeting mode into the ownership recovery layer.

## [1.7.4] — 2026-07-19

### Added
- **Ownership Deep Recovery**: `Format-TopicRecord` now automatically resolves blank ownership fields via `taxonomy.json` defaults when the LLM omits Capability/Phase/Governor. Eliminates blank `### OWNERSHIP` blocks in Topic Records.
- **Capability/Phase/Governor defaults in `taxonomy.json`**: All 20 canonical topics now carry default `Capability`, `Phase`, and `Governor` values, enabling deterministic ownership recovery without LLM input.
- **EIP 1.2 axes in LLM prompt**: `classification_rules.json` now explicitly mandates `CAPABILITY`, `CAPABILITY_PHASE`, and `PROCESS_GOVERNOR` in the Topic Record output schema.
- **Environment variable support for `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_USER_UPN`**: Pipeline credentials can now be fully overridden via environment variables, improving portability and security.

### Fixed
- **Topic name sync**: All 20 topic names in `taxonomy.json` now exactly match `mapping_rules.json` (e.g., "Product Quality & Compliance", "Revenue & Commercial Performance", "Strategic Direction & Alignment"). This was causing ownership recovery to fail silently.
- **Missing `-Taxonomy` parameter**: `Format-TopicRecord` in VTT direct mode (`-VttFile`) was called without the `$Taxonomy` argument, preventing ownership recovery. Fixed.
- **Dynamic Topic ID map**: Replaced hardcoded 18-entry `$idMap` in `Format-TopicRecord` with a live lookup against `mapping_rules.json`. New topics added to config are automatically recognized.
- **Mutual linking regex hardened**: Topic Summary → Topic Record linking now handles `##` and `###` header variants and is null-safe.
- **EIP diagnostic log clarified**: `[EIP 1.2 DIAG]` log line now states `[recovery may apply]` to avoid confusion between pre-recovery LLM output and final rendered ownership.

## [1.7.3] — 2026-07-18

### Added
- **7-Day Retry Window**: Automated runs now look back 7 days by default (previously 1 day). This allows for multiple retries of transcripts that fail or are delayed by Microsoft Graph, while built-in deduplication ensures no duplicate processing.

### Fixed
- **EIP 1.1 Topic Record Summary Hardening**: 
  - Updated LLM prompts in `classification_rules.json` to explicitly mandate a 2-3 sentence summary for every extracted topic record.
  - Added a code-level fallback in `Format-TopicRecord` to use the record's title or content if the LLM fails to provide a summary, preventing empty Markdown blocks.
  - Hardened `Validate-TopicRecord` to ensure missing summaries trigger a validation failure for easier auditing.
- **Artifact Isolation**: Discovery logic updated to ignore `artifacts/` and `tmp_` folders, preventing local verification data from "bleeding" into production logs.

## [1.7.2] — 2026-07-08

### Fixed
- **Timezone-Invariant Meeting IDs**: Updated `Get-MeetingLogId` to force UTC parsing of Graph API timestamps. This prevents duplicate log entries caused by caused by running the pipeline from different timezones (e.g., Local vs. Azure Function).
- **Master Log Deduplication**: Rebuilt `master_log.json` using the new invariant ID format, resolving multiple duplicate entries and ensuring reliable meeting skipping.
- **Internal Versioning**: Synchronised the `$PIPELINE_VERSION` variable with the release version.

## [1.7.1] — 2026-07-07

### Fixed
- **Meeting fetch resilience (403 fallback)**: The `onlineMeetings` endpoint now uses a tiered lookup strategy. If the organiser's ID (parsed from the Teams Join URL) returns a 403, the script falls back to the calendar user's (Peter's) ID. If both fail, the meeting is gracefully skipped with a `[POLICY]` warning instead of crashing the entire pipeline run.
- **Auth header sync**: `$authHeader` is now explicitly synchronised with `$global:authHeader` inside the meeting processing loop, preventing stale token usage during long-running batch jobs.
- **Variable bleed fix**: `$organiserId` is now resolved at the top of each loop iteration, preventing the previous meeting's ID from "bleeding" into the current one.

---

## [1.7.0] — 2026-07-01

### Added
- **VTT Inbox Mode**: At every pipeline run, the pipeline checks `/Documents/Transcripts` in Peter's OneDrive for Business for `*.vtt` files. Each file is processed through the full EIP (LLM classification, enrichment, people intelligence) and outputs transcript `.txt`, `-Summary.txt`, and `-People.txt` files uploaded to SharePoint and mirrored to Confluence. The source VTT file is deleted from the inbox on successful processing. Deduplication uses `master_log.json` — already-processed files are skipped and removed from the inbox.
- **`Get-VttInboxFiles`**: Lists `*.vtt` files from the OneDrive inbox folder via Microsoft Graph API (`/users/{upn}/drive/root:/{path}:/children`).
- **`Remove-VttInboxFile`**: Deletes a consumed VTT file from OneDrive via Graph API DELETE.
- **`ConvertFrom-VttFilename`**: Derives meeting date and subject from VTT filename. Supports `YYYY-MM-DD_HHMM-Title.vtt`, `YYYY-MM-DD-Title.vtt`, and plain `Title.vtt` formats.
- **Meeting ID scheme for inbox files**: `[sanitised_filename]_[file_creation_date_YYYY-MM-DD]` — stable across re-runs, used for deduplication.

---

## [1.6.0] — 2026-07-01

### Added
- **Warning-focused Teams webhook notification**: End-of-run Teams message now reports warnings only — brand integrity conflicts, unresolved people, and pipeline errors. Clean runs receive a single "✅ Pipeline ran without warnings" message with a run summary line. Replaces the previous per-meeting metadata dump.
- **`$global:PipelineWarnings` collector**: Centralised warning accumulator populated during the run by `Get-BrandConflicts` and `Resolve-People`, consumed at notification time.
- **EIP brand/semantic model (CR implementation)**:
  - `people_config.json` v1.7: `brand_affinity` and `brand_exclusions` on all 30 people and all 10 organisations; org `relationship` metadata; Abhijeet → Abhijeet Borah (full name resolved); Charlotte Bassat → `org_squid`; `brand` and `brand_conflict_severity` schema enums added
  - `roles_config.json` v1.1: Stale `theo@wizcomtech.com` email corrected; Peter → CPO; Nick → COO; 7 new email mappings (Alison, Toby, Jack, Quin, Julia, Bhavesh, Ed); `FallbackMode`; extended `TypeMappings`
  - `sentiment_rules.json` v1.1: Negation prefix list (21 terms); tiered `Negative` (Critical / Warning); `Neutral` in-progress state; NPI, compliance, and supplier domain vocabulary
  - `taxonomy.json` v3.1: 4 new context types (Decision, Action, Commitment, Escalation); `ContextTypeDescriptions`; `TopicGroups` with 5 groups; topic descriptions for all 18 topics
  - `mapping_rules.json` v2.1: Comprehensive keyword expansion across all T01–T18 topics; `suppress_keywords` per rule; 4 `SemanticIntegrityRules` (ProductBrandResolution, SupplierBrandConflict, PersonBrandConflict, BrandCastConflict); e-pens / NPI / supplier vocabulary
- **`Get-BrandConflicts` function**: Evaluates topic text against `SemanticIntegrityRules`; emits typed conflict objects with severity (warning / info)
- **`Test-NegatedInContext` helper**: Negation window check — detects if a matched sentiment keyword is preceded by a negation prefix within a configurable word window
- **Suppress keyword support in `Classify-Topic`**: Rules with `suppress_keywords` are skipped when a suppress term matches, reducing false-positive topic classification
- **Negation-aware `Get-TopicSentiment`**: All keyword matches now checked for negation context; tiered severity (Critical / Warning) returned; backward compatible with flat schema

### Fixed
- `organisations` list: `org_squid` (Squid, subsidiary_marketing) and `org_virrata` (Virrata AB, internal_partner) added — previously referenced by people entries but missing from the list
- `people_config.json`: Canonical full name added to `aliases` for all 24 pre-v1.5 people entries (consistency fix); `identity_quality` corrected from `partial_name` → `complete` for Jackie Kaur, Penny Taylor, Johannes Blüml
- `classification` enum: Missing comma after `"affiliate"` in `schema_enums` corrected

---

## [1.5.0] — 2026-06-29

### Added
- **People Intelligence Layer (Phase 1)**: Per-meeting `*-People.txt` files generated alongside transcript and summary. Covers attendance status, contributions, actions assigned to/by, decisions owned, risks raised, topic IDs referenced, stance, and focus summary per resolved person.
- **`Get-TranscriptSpeakers`**: Extracts speaker names from both VTT `<v Name>` voice tags and plain `Name: dialogue` formats. Strips org suffixes (e.g. `(Empowering Tech)`) before matching.
- **`Resolve-People`**: Case-insensitive alias matching against `people_config.json`. Unresolved names flagged to `config/people_recommendations.json` for review.
- **`Get-PeopleIntelligence`**: LLM Pass 3 — structured per-person attribution extraction from transcript and chunk summaries.
- **`Format-PeopleFile`**: Renders LLM output as `*-People.txt` with standard pipeline header.
- **`Update-MasterPeopleLog`**: Maintains `master_people_log.json` and `master_people_log.txt` at SharePoint root.
- **`master_people_log.json` + `master_people_log.txt`**: Dual-format running index of all people files, uploaded to SharePoint root alongside `master_log.*`. CoPilot-indexable.
- **`PeopleFile` field**: Added to master log entries and run log entries.
- People intelligence wired into both calendar pipeline and `-VttFile` direct mode.
- `config/people_config.json` (active, based on v1.4) and `config/people_recommendations.json` added to `.gitignore` (PII).

### Fixed
- `config/people_config_v1_4.json` promoted to `config/people_config.json` as the active config.

---

## [1.4.0] — 2026-06-29

### Added
- **`-VttFile` direct processing mode**: Process a local `.vtt` file directly without calendar lookup or transcript fetch. Accepts `-VttFile "path/to/file.vtt"` and `-Participant "Name"`. Parses date and subject from filename (`YYYY-MM-DD_HHMM-Title.vtt`), runs full LLM classification, saves `.txt` and `-Summary.txt`, uploads to SharePoint, mirrors to Confluence, and adds to Master Log.
- **`ConvertFrom-Vtt` function**: Strips WebVTT timestamps and cue markers, deduplicates consecutive same-speaker lines, returns clean plain text identical in format to calendar-sourced transcripts.

---

## [1.3.0] — 2026-06-29

### Fixed
- **LLM authentication**: Switched from `Bearer` to `api-key` header for Azure OpenAI (`openai.azure.com`) endpoints
- **LLM URL construction**: Fixed URL priority — `openai.azure.com` check now takes precedence over `/v1` path detection, preventing malformed deployment URLs
- **JSON sanitisation**: Strip markdown code fences (` ```json ``` `) before parsing LLM responses, eliminating spurious "malformed JSON" warnings
- **Confluence credentials**: Resolved 401 auth errors by identifying and applying the correct API token for `etpd.atlassian.net`

### Added
- **Map-reduce chunked transcript processing**: Transcripts are now split into configurable chunks (default 32,000 chars with 500-char overlap), summarised per-chunk (Pass 1), then synthesised into the full structured JSON output (Pass 2). Handles arbitrarily long transcripts including full-day meetings.
- **`DeploymentName` config field**: Separates Azure OpenAI deployment name from model name in `classification_rules.json` to handle naming mismatches
- **`ChunkSize` and `ChunkOverlap` config fields**: Chunking parameters now configurable via `classification_rules.json`
- **`finish_reason` diagnostic**: Logs a warning when the LLM response is truncated (`finish_reason != stop`)
- **Reusable LLM helpers**: Extracted `Invoke-LLM`, `Split-TranscriptIntoChunks`, and `ConvertFrom-LLMJson` functions for cleaner, more maintainable code

### Security
- `classification_rules.json` added to `.gitignore` (contains Azure OpenAI API key)
- `pipeline_config.json` added to `.gitignore` (contains Confluence API token)

---

## [1.2.0] — 2026-06 (approx)

### Added
- **3D Classification model**: High-fidelity provenance model with topic, category, and context type dimensions (`[3D DIAG]` output)
- **Stable Topic Classification (EIP v2.1)**: Canonical T01–T18 topic taxonomy with consolidation and smart mode assignment
- **Batch Teams notifications**: Single end-of-run notification replacing per-meeting messages
- **Confluence mirroring**: Meeting summaries mirrored to Confluence with structured formatting matching summary files 1:1
- **Self-refreshing Microsoft Graph tokens**: Prevents auth failures in long-running batch jobs
- **SharePoint retry loop**: Transient `UnknownError` upload failures now retried automatically

### Fixed
- Confluence mirror URL corruption and formatting issues
- Teams notification formatting aligned with `master_log.txt`
- Azure environment variable priority for Confluence and Teams credentials
- SharePoint `Classification` field removed (unrecognised by API)
- Master Log success-sticky and file-sticky logic to prevent history degradation
- Meeting deduplication using `JoinUrl + StartTime` to support recurring series

---

## [1.1.0] — 2026-06 (approx)

### Added
- **Universal LLM summaries**: All meetings with transcripts processed through GPT for structured summaries
- **Dual-file storage**: Both raw transcript and `-Summary.txt` files stored to SharePoint
- **EIP v2.0 enrichment layer**: Config-driven mode and taxonomy enrichment pipeline
- **Sentiment and signal tracking**: Keyword-driven sentiment rules with trajectory (Improving/Declining) detection
- **Stalled work detection**: Identifies and flags stalled topics in enrichment pipeline
- **T01–T18 topic taxonomy**: Authoritative topic mapping and classification rules externalised to `config/taxonomy.json` and `config/mapping_rules.json`
- **Mixed signal logic**: Handles conflicting sentiment signals within a meeting

### Fixed
- LLM URL construction for Azure OpenAI deployment path
- Master Log resilience improvements
- SharePoint column mapping (`Category` replaces reserved `Type` field)

---

## [1.0.0] — 2026-05 (approx)

### Added
- **Initial pipeline**: PowerShell-based transcript pipeline with Microsoft Graph REST integration
- **Microsoft Teams calendar integration**: Fetches meetings within a date range
- **SharePoint integration**: Upload transcripts and update metadata columns
- **Master Log**: JSON + human-readable `.txt` log of all processed meetings persisted in SharePoint
- **LLM classification**: GPT-based meeting classification (CEO / CPO) with confidence scoring
- **Cascading classification logic**: Rule-based fallback when LLM is unavailable
- **Run logs**: Per-run diagnostic logs uploaded to SharePoint
- **CI/CD**: GitHub Actions workflow for automated Azure Function deployment
- **README**: Architecture diagram and backfill guide

---

*Local configuration files (`classification_rules.json`, `pipeline_config.json`) are gitignored and must be provisioned separately per environment. See README for setup instructions.*
