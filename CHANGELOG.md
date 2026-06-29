# Changelog

All notable changes to the Power Transcript Pipeline are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
Versioning follows [Semantic Versioning](https://semver.org/).

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
