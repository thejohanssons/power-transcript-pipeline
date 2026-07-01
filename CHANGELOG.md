# Changelog

All notable changes to the Power Transcript Pipeline are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
Versioning follows [Semantic Versioning](https://semver.org/).

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
