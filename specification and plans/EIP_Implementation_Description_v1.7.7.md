# Executive Intelligence Pipeline (EIP) — Complete Implementation Description
**Version:** 1.7.9 | **Date:** 2026-07-20  
**Purpose:** Full system specification to enable recreation on a new platform.

---

## 1. SYSTEM OVERVIEW

The **Executive Intelligence Pipeline (EIP)** is a PowerShell-based automated system that converts raw Microsoft Teams meeting transcripts into structured executive intelligence. It runs as an Azure Function (daily timer) and can also be triggered manually or via a VTT file inbox.

**Inputs:**
- Microsoft Teams calendar (via Microsoft Graph API)
- `.vtt` transcript files dropped into a OneDrive inbox folder
- Local `.vtt` files (manual/direct mode)

**Outputs per meeting:**
- `[id].txt` — Raw plain-text transcript
- `[id]-Summary.txt` — 9-section structured leadership summary
- `[id]-People.txt` — Per-person intelligence report
- `[id]-[TopicId]-[TopicName].md` — One topic record per extracted topic (EIP 1.1 format)
- Confluence pages (Summary + per-topic) mirrored from SharePoint
- Entry in `master_log.json` / `master_log.txt` (all-time deduplication index)
- Entry in `master_people_log.json` / `master_people_log.txt`
- Teams webhook notification (warnings only, or clean-run message)

---

## 2. INFRASTRUCTURE

### 2.1 Azure Resources

| Resource | Name | Purpose |
|:---|:---|:---|
| Azure Function App | `peter-consolidate-meeting-transcripts` | Hosts the daily timer trigger |
| Azure AD App Registration | (internal) | OAuth2 client credentials for Microsoft Graph |
| Azure Storage Account | (via `AzureWebJobsStorage`) | Internal Azure Functions state |

### 2.2 Azure Function Timer Trigger

**File:** `TranscriptJob/function.json`
```json
{
  "bindings": [{
    "name": "Timer",
    "type": "timerTrigger",
    "direction": "in",
    "schedule": "0 0 2 * * *"
  }]
}
```
Fires daily at **02:00 AM UTC**.

**File:** `TranscriptJob/run.ps1`  
Dot-sources `../power-transcript-pipeline.ps1` in current scope. Checks for Managed Identity availability. Propagates errors via `throw`.

**File:** `host.json`
- Function timeout: **30 minutes**
- Extension Bundle: `Microsoft.Azure.Functions.ExtensionBundle` v4.x
- Managed Dependencies: Enabled
- Application Insights: Enabled with sampling (Request type excluded)

**File:** `requirements.psd1` — **Empty.** No external PowerShell modules. All Graph integration uses native `Invoke-RestMethod`.

### 2.3 CI/CD Pipeline

**File:** `.github/workflows/deploy.yml`  
**Trigger:** Push to `main` branch, or manual dispatch.

**Steps:**
1. Checkout code (`actions/checkout@v4`)
2. Azure CLI login via OIDC (`azure/login@v2`, uses `AZURE_CREDENTIALS` secret)
3. Deploy to Azure Functions (`Azure/functions-action@v1`, no Oryx build)
4. Create GitHub Release with auto-generated notes tagged `v{run_number}`

**Secrets required:** `AZURE_CREDENTIALS`, `GITHUB_TOKEN`  
**Permissions:** `contents: write`, `id-token: write`

### 2.4 Microsoft Graph Permissions

All permissions are **Application-level** and require Admin Consent:

| Permission | Purpose |
|:---|:---|
| `Calendars.Read` | Scan target user calendar for Teams meetings |
| `OnlineMeetingTranscript.Read.All` | Download meeting transcripts |
| `Sites.ReadWrite.All` | Create folders and upload to SharePoint |
| `User.Read.All` | Resolve organizer IDs and UPNs |

### 2.5 Environment Variables / App Settings

| Variable | Purpose | Default fallback in code |
|:---|:---|:---|
| `GRAPH_CLIENT_SECRET` | **Mandatory.** Azure AD client secret | None (throws if missing) |
| `GRAPH_TENANT_ID` | Azure AD tenant ID | `f9e144a5-228f-4e5a-86c4-2cc253376402` |
| `GRAPH_CLIENT_ID` | Azure AD app client ID | `9cfcadb2-27c0-41e5-8c6e-c1305c4827e2` |
| `GRAPH_USER_UPN` | Calendar user to scan | `peter@empoweringtech.com` |
| `WEBSITE_TIME_ZONE` | `GMT Standard Time` | None |
| `AzureWebJobsStorage` | Azure Functions storage | None |
| `TEAMS_WEBHOOK_URL` | Teams channel webhook | `pipeline_config.json` |
| `CONFLUENCE_USER` | Confluence username | `pipeline_config.json` |
| `CONFLUENCE_TOKEN` | Confluence API token | `pipeline_config.json` |
| `CONFLUENCE_BASE_URL` | Confluence instance URL | `pipeline_config.json` |

### 2.6 Gitignored Files (must be provisioned separately per environment)

| File | Reason |
|:---|:---|
| `classification_rules.json` | Contains Azure OpenAI API key and LLM config |
| `pipeline_config.json` | Contains Confluence API token, Teams webhook URL, feature flags |
| `config/people_config.json` | Contains PII (names, emails, role data) |
| `config/people_recommendations.json` | Contains PII |

---

## 3. SHAREPOINT STRUCTURE

**Site:** `scanningpens.sharepoint.com/sites/Petersplace`

```
/Exec Intel Insights/
├── master_log.json                      ← All-time dedup index (JSON)
├── master_log.txt                       ← Human-readable archive
├── master_people_log.json               ← People intelligence index
├── master_people_log.txt
├── _DO_NOT_PRIORITISE_Run logs/
│   └── transcript_log_YYYYMMDD_HHmmss.csv
├── Meeting transcripts/
│   └── YYYY-MM/
│       ├── [meeting-id].txt             ← Raw transcript
│       └── [meeting-id]-Summary.txt     ← Structured leadership summary
└── Topic Records/
    └── YYYY-MM/
        └── [meeting-id]/
            └── [meeting-id]-[TopicId]-[TopicSlug].md  ← One per topic
```

**VTT Inbox (source, consumed on processing):**
```
/Documents/Transcripts/*.vtt             ← OneDrive for Business (same drive)
```

---

## 4. PIPELINE ENTRY POINT & PROCESSING MODES

**Script:** `power-transcript-pipeline.ps1`

**Parameters:**
| Parameter | Type | Default | Purpose |
|:---|:---|:---|:---|
| `FromDate` | datetime/string | 5 days ago | Start of calendar scan window |
| `ToDate` | datetime/string | Today | End of calendar scan window |
| `VttFile` | string | None | Local VTT path — bypasses calendar |
| `Participant` | string | None | Optional participant filter |

### Mode 1: Calendar Mode (default)
Scans MS Graph for Teams meetings between `FromDate`/`ToDate` for the configured user. Filters by online meeting join URL. Deduplicates by meeting URL. Uses a tiered organizer lookup (organizer ID → calendar user ID fallback → skip with `[POLICY]` warning). Processes transcript for each meeting.

### Mode 2: VTT Inbox Mode (automatic)
Runs at the end of every pipeline execution. Scans `/Documents/Transcripts` in OneDrive for `*.vtt` files. Each file is processed through the full pipeline. Source file deleted from inbox on success. Deduplicates against `master_log.json`.

### Mode 3: VTT Direct Mode (`-VttFile`)
Processes a single local `.vtt` file directly. Bypasses calendar and Graph transcript lookup. Useful for backfill or testing.

---

## 5. PIPELINE PROCESSING STEPS (per meeting)

### Step 0: Deduplication
Check `master_log.json` for existing entry with matching `MeetingId` and `Status: success`. If found, skip entirely.

### Step 1: Transcript Acquisition
- **Calendar:** `GET /users/{upn}/calendarView` → filter Teams meetings → `GET /users/{id}/onlineMeetings/{id}/transcripts`
- **VTT:** Parse filename via `ConvertFrom-VttFilename`; strip WebVTT headers via `ConvertFrom-Vtt`

**Ongoing Meeting Guard (Calendar mode only):**  
Before fetching transcript content, the pipeline compares the current time against the meeting's scheduled end time (from `calendarEvent.end.dateTime`). If fewer than 2 hours have elapsed since the scheduled end, the meeting is skipped with a `[SKIP]` diagnostic and **no log entry is written**. This means:
- The meeting will be retried automatically on the next pipeline run.
- Partial transcripts from in-progress or recently-ended meetings are never analysed.
- The Master Log is never poisoned with a `Status: success` entry based on incomplete data.

If the calendar event carries no end time, the pipeline assumes a 1-hour duration as a fallback before applying the 2-hour cooldown.

| Condition | Result |
|:---|:---|
| `now < scheduledEnd + 2h` | Skip silently; no log entry; retried next run |
| `now >= scheduledEnd + 2h` and transcript exists | Process normally |
| `now >= scheduledEnd + 2h` and no transcript found | Log `Status: no_transcript`; retried next run |

**VTT Filename Parsing (`ConvertFrom-VttFilename`):**
| Pattern | Example | Result |
|:---|:---|:---|
| `HoD_YYYYMMDD_HHMMSS[_suffix]` | `HoD_20260714_141158` | Meeting date from filename; Subject = "Head of Department Meeting" |
| `Sales_Call_[Desc]_DD_Mon_YY` | `Sales_Call_US_Country_Manager_25_Mar_26` | Meeting date = 2026-03-25; Subject = "Sales Call - US Country Manager" |
| `YYYY-MM-DD_HHMM-Title` | `2026-07-15_0400-Weekly_Sync` | Standard date + subject |
| `YYYY-MM-DD-Title` | `2026-07-15-Weekly_Sync` | Date-only + subject |
| Fallback | `anything_else` | Today's date + filename as subject |

### Step 2: Mode Assignment (`Assign-Mode`)
Determines meeting classification (CEO/CPO/COO/CMO/CSO/CFO/CTO):
1. Check organizer email against `roles_config.json` Mappings
2. Check meeting type against TypeMappings
3. Smart rule: Work meetings with Product topics → CPO
4. Default: CEO

### Step 3: LLM Classification (`Get-MeetingClassification`)
**Map-Reduce approach:**
1. Split transcript into 32,000-char chunks with 500-char overlap
2. **Pass 1 (Map):** Summarize each chunk individually
3. **Pass 2 (Reduce):** Synthesize chunk summaries into final structured JSON

**LLM Output Schema (JSON):**
```json
{
  "classification": "CEO|CPO|COO|...",
  "confidence": "High|Medium|Low",
  "summary": "<full 9-section leadership summary as string>",
  "records": [
    {
      "TopicId": "T01",
      "Domain": "Product",
      "TopicFamily": "Product",
      "Topic": "Product Performance",
      "Title": "<meeting-specific context sentence>",
      "Category": "Progress|Risk|Action|...",
      "ContextType": "Update|Decision|...",
      "Tags": ["CriticalPath"],
      "Status": "Positive|Negative|Neutral|Unknown",
      "Trajectory": "Improving|Stable|Declining|Unclear|Unknown",
      "Capability": "Product Management",
      "CapabilityPhase": "Capability Operation",
      "ProcessGovernor": "Product Board",
      "Summary": "<2-3 sentence topic overview>",
      "KeyFacts": ["fact1", "fact2"],
      "Decisions": [{"Decision": "...", "Rationale": "..."}],
      "Actions": [{"Action": "...", "Owner": "...", "Deadline": "..."}],
      "Risks": ["risk1"],
      "NextSteps": ["step1"],
      "RetrievalAnchors": {
        "People": [], "Projects": [], "Products": [], "Systems": [], "Dependencies": []
      }
    }
  ]
}
```

**LLM Configuration (`classification_rules.json` — gitignored):**
- Endpoint: Azure OpenAI (`openai.azure.com`) or Azure AI Foundry
- Auth header: `api-key: {key}` (not Bearer)
- Model: configurable (e.g., `gpt-4o`)
- DeploymentName: separate field from model name
- ChunkSize: 32000 (default)
- ChunkOverlap: 500 (default)
- MaxTokens: 16000

### Step 4: Enrichment (`Enrich-Summary`)
Post-processes raw LLM output:
- Parses 9 summary sections
- Extracts topic records from section 1 content
- Adds history context (`Get-StalledWork` — detects topic persistence, trajectory shifts)
- Validates all records (`Validate-TopicRecord` — 13 checks)
- Rebuilds structured summary with `## TOPIC TRENDS & PERSISTENCE` and `## STALLED WORK DETECTED` sections

### Step 5: People Intelligence (`Get-PeopleIntelligence`)
**Pass 3 LLM call** — structured extraction of per-person attribution:
- **ATTENDANCE:** Present / Discussed / Expected
- **CONTRIBUTIONS:** What each person said or decided
- **ACTIONS:** Assigned to / assigned by
- **DECISIONS OWNED**
- **RISKS RAISED**
- **TOPICS REFERENCED** (by Topic ID)
- **STANCE**
- **SUMMARY**

Resolves speaker names against `people_config.json` (case-insensitive alias matching). Unresolved names flagged to `config/people_recommendations.json`.

### Step 6: Topic Record Generation (`Format-TopicRecord`)
For each extracted topic record:
1. Reverse-map TopicId → Topic name (if LLM omitted)
2. Fuzzy-normalize topic name against `taxonomy.json` keys
3. Recover Domain/Family from taxonomy defaults
4. **Ownership Deep Recovery:** If ownership blank, look up `taxonomy.json` default Capability/Phase/Governor → call `Resolve-Ownership`
5. **Context Override:** If `MeetingMode == COO`, apply COO override from taxonomy `ContextOverride` block
6. Format markdown with: metadata block, Summary, Key Facts, Decisions, Actions, Risks, Next Steps, Retrieval Anchors, Ownership block, Validation status

**Ownership Resolution chain:**
```
MeetingMode → taxonomy.json [Capability, Phase, Governor]
           ↓                        ↓ (if COO override exists)
process_governors.json       ContextOverride.COO
           ↓
ownership_rules.json → PRIMARY_OWNER, GOVERNANCE_OWNER, etc.
```

### Step 7: Mutual Linking
- Summary → Topic Record: inserts `> [View Dedicated Topic Record](url)` under each `## Topic:` heading
- Topic Record → Summary: includes back-link to master log summary URL

### Step 8: Upload to SharePoint
- Raw transcript → `Meeting transcripts/YYYY-MM/[id].txt`
- Summary → `Meeting transcripts/YYYY-MM/[id]-Summary.txt`
- People file → `Meeting transcripts/YYYY-MM/[id]-People.txt`
- Topic records → `Topic Records/YYYY-MM/[meeting-id]/[id]-[TopicId]-[slug].md` (one per topic)
- Run log → `_DO_NOT_PRIORITISE_Run logs/transcript_log_{runId}.csv`
- `master_log.json`, `master_log.txt`, `master_people_log.json`, `master_people_log.txt` → root

### Step 9: Confluence Mirror
Enabled via `pipeline_config.json.enable_confluence_mirror`.
- Meeting summary → Confluence page (space/parent from `confluence_mappings.json` domain_mappings or defaults)
- Each topic record → Confluence page (space/parent per Topic Domain)
- Auth: HTTP Basic (Confluence user + API token)
- Handles version conflicts (400 → update existing page)

### Step 10: Master Log Update
- Merges run entry into `master_log.json` (sticky logic — preserves existing URLs)
- Fields: MeetingId, Subject, EventDate, Status, TranscriptUrl, SummaryUrl, TopicRecords[], ConfluenceUrl, PeopleFileUrl, Mode, ProcessingTimestamp, PipelineVersion

### Step 11: Teams Notification
Single end-of-run webhook message. Content: warnings only (brand conflicts, unresolved people, pipeline errors). Clean runs: "✅ Pipeline ran without warnings" + run summary line. Target: `TEAMS_WEBHOOK_URL` env var or `pipeline_config.json`.

---

## 6. FUNCTION REFERENCE (all 38 functions)

| Function | Key Parameters | Purpose |
|:---|:---|:---|
| `ConvertFrom-Vtt` | `$VttContent` | Strips WebVTT timestamps; deduplicates consecutive speaker lines |
| `ConvertFrom-MeetingIntelTxt` | `$Content` | Parses MeetingIntelligence `.txt` format: extracts header, date, transcript body |
| `ConvertFrom-VttFilename` | `$BaseName` | Derives meeting date + subject from VTT filename (4 patterns + fallback) |
| `Assign-Mode` | `$type, $organiser, $topicRecords` | Classifies meeting mode: CEO/CPO/COO/CMO/CSO/CFO/CTO |
| `Get-BrandConflicts` | `$Text, $SpeakerOrgId` | Evaluates SemanticIntegrityRules; returns typed conflict objects |
| `Test-NegatedInContext` | `$Text, $MatchIndex, $WindowWords=3` | Checks if keyword is negation-qualified within word window |
| `Resolve-Ownership` | `$Capability, $Phase, $Governor` | Builds full ownership struct from `process_governors.json` + `ownership_rules.json` |
| `Get-TopicSentiment` | `$topicText` | Returns Signal (Positive/Negative/Neutral/Mixed), Trajectory, Severity |
| `Classify-Topic` | `$topicText` | Keyword density match → TopicId, suppress_keywords respected; fallback T15 |
| `Select-Category` | `$CandidateCategories, $SectionName, $Signal, $Trajectory, $Label, $Content` | 3D category selection scoring: section location + signal + content keywords |
| `Enrich-Summary` | `$summaryText, $meetingId, $historyRecords, $InitialRecords` | Post-processes LLM output; adds history; rebuilds structured summary |
| `Get-StalledWork` | `$currentRecords, $historyRecords` | Detects stalled/persistent topics by comparing TopicId content across meetings |
| `Split-TranscriptIntoChunks` | `$Text, $ChunkSize=32000, $Overlap=500` | Splits transcript for map-reduce LLM processing |
| `Invoke-LLM` | `$SystemPrompt, $UserContent, $FullUri, $Headers, $Model, $MaxTokens, $ResponseFormat` | REST call to LLM; supports json_object format; retry on failure |
| `ConvertFrom-LLMJson` | `$RawContent` | Strips markdown fences; extracts outermost JSON object |
| `Recover-LLMResult` | `$RawContent` | Salvages truncated LLM JSON via regex extraction |
| `Resolve-People` | `$Names, $PeopleConfig` | Alias matching against `people_config.json`; logs unresolved |
| `Get-TranscriptSpeakers` | `$TranscriptText` | Extracts unique speaker names from VTT (`<v Name>`) or plain (`Name: dialogue`) |
| `Get-PeopleIntelligence` | `$TranscriptText, $ChunkSummaries, $ResolvedPeople, ...` | LLM Pass 3: per-person attribution extraction |
| `Format-PeopleFile` | `$LLMOutput, $MeetingId, $Subject, $EventDate, $PipelineVersion` | Renders People Intelligence as `*-People.txt` with standard header |
| `Get-TopicEntities` | `$Text, $ResolvedPeople` | Extracts Retrieval Anchors: People, Projects, Products, Systems, Dependencies |
| `Validate-TopicRecord` | `$TopicData, $Anchors` | 13-check validation: Domain, Topic, Category, Ownership, Summary completeness |
| `Format-TopicRecord` | `$TopicData, $MeetingMetadata, $Taxonomy, $SummaryLink, $ResolvedPeople, $MeetingMode` | Full topic record markdown generator with deep recovery and context-aware ownership |
| `Update-MasterPeopleLog` | `$MasterPeopleLogData, $MeetingId, $Subject, $EventDate, $PeopleFileUrl, $ResolvedPeople` | Updates master people index |
| `Get-MeetingClassification` | `$type, $organiser, $transcriptContent` | Main LLM orchestration: chunk → Pass 1 (map) → Pass 2 (reduce) |
| `Convert-SummaryToConfluenceHtml` | `$SummaryText, $Subject, $MeetingId, $EventDate, $Organiser` | Converts markdown summary to Confluence storage HTML |
| `Publish-SummaryToConfluence` | `$HtmlContent, $Title, $SpaceKey, $ParentPageId` | Creates/updates Confluence page via REST; handles version conflicts |
| `Publish-TopicRecordToConfluence` | `$TopicRecordText, $TopicId, $TopicLabel, $Domain, ...` | Maps Domain → Confluence space/parent; publishes topic record |
| `Send-TeamsNotification` | `$MessageBlock` | POST markdown block to Teams webhook |
| `Get-GraphToken` | (none) | OAuth2 client credentials token acquisition with 5-min safety margin |
| `Ensure-GraphToken` | (none) | Auto-refreshes token if expired before each API call |
| `Test-IsExternalTenant` | `$JoinUrl, $InternalTenantId` | Detects if meeting is hosted by an external tenant |
| `Get-OrganiserIdFromJoinUrl` | `$JoinUrl` | Extracts organizer Oid from Teams join URL |
| `Ensure-DriveFolder` | `$DriveId, $FolderPath` | Creates nested folder path on SharePoint via Graph API |
| `Upload-FileToSharePoint` | `$DriveId, $FolderId, $FilePath` | PUT file to SharePoint; retries up to 3x with 2s backoff |
| `Get-MeetingLogId` | `$EventDate, $Subject` | Generates stable Meeting ID: `yyyy-MM-dd_HHmm_slugified-subject` (UTC) |
| `Get-StickyMasterLogValue` | `$NewValue, $ExistingEntry, $PropertyName` | Preserves existing master log field values across re-runs |
| `Process-VttFile` | `$FileItem, $SourceDriveId, $SkipDeletion` | Full VTT inbox/direct pipeline orchestrator |
| `Get-VttInboxFiles` | `$DriveId, $FolderPath` | Lists `*.vtt` files from OneDrive inbox |
| `Remove-VttInboxFile` | `$DriveId, $ItemId` | Deletes consumed VTT from OneDrive via Graph DELETE |

---

## 7. CONFIGURATION FILES

All config files live in `/config/` and are version-controlled except those containing PII/secrets.

### 7.1 `taxonomy.json` (v4.2)
**Purpose:** Canonical metadata schema for all intelligence extraction.

**Key structures:**
- `MetadataAxes`: 13-axis ordered schema
- `Domains`: 10 values — Product, Sales, Marketing, Technology, IT, Operations, SupplyChain, Finance, People, Governance
- `TopicFamilies`: 9 values — Product, Delivery, Commercial, Customer, People, Process, Technology, Operations, Strategy
- `Topics`: 20 canonical topics (T01–T18 + AI + Data), each with:
  - `Domain`, `TopicFamily`, `Capability`, `Phase`, `Governor` (ownership defaults)
  - `ContextOverride.COO` — alternative Capability/Governor for COO-mode meetings
  - `Description`, `Version`
- `Categories`: Risk, Issue, Action, Decision, Progress, Opportunity, Dependency, Strategy, Insight
- `ContextTypes`: Discussion, Update, Decision, Agreement, Proposal, Concern, Commitment, Observation, Assumption
- `Tags`: 13 values (CriticalPath, BOM_Risk, Revenue_Impacting, etc.)
- `StrategicImpactScales`, `ExecutivePriorityLevels`, `AlignmentLevels`

### 7.2 `mapping_rules.json` (v2.1)
**Purpose:** Keyword-to-topic mapping for transcript classification.

- `Rules`: One entry per topic, each with keyword list, `suppress_keywords`, `context_boost`, `CategoryHints`
- `SemanticIntegrityRules`: Brand conflict detection (e.g. `e-pens` conflicts)
- `StrategicSignals`: High-impact trigger phrases

### 7.3 `sentiment_rules.json` (v1.1)
**Purpose:** Sentiment vocabulary for signal detection.

- `NegationPrefixes`: 21 terms, 3-word window
- `Positive`: 24 terms
- `Negative.Critical`: 8 terms (blocker, failed, breach, recall)
- `Negative.Warning`: 22 terms (issue, delay, risk, defect)
- `Neutral`: 15 in-progress terms
- `ResolutionPriority`: Closure terms (fixed, resolved, shipped)
- `NpiVocabulary`: 27 NPI-phase terms
- `ComplianceVocabulary`: 18 regulatory terms
- `SupplierVocabulary`: 25 supply chain terms

### 7.4 `roles_config.json` (v1.1)
**Purpose:** Maps speaker email → meeting mode.

- `FallbackMode`: "CPO"
- `Mappings`: 12 email entries → CEO/CPO/COO/CMO/CSO
- `TypeMappings`: Function type → mode (ExCo→CEO, Sales→CSO, Engineering→CPO, etc.)

### 7.5 `ownership_rules.json`
**Purpose:** Maps business capabilities to executive owners.

- ~40 capability entries with `default_owner` and optional `phase_owners`
- CPO owns: Product Management, Product Development, Product Delivery, Engineering Operations, R&D, Product Quality
- COO owns: Sales, Commercial Execution, People Operations, Supply Operations, Manufacturing Operations
- CFO owns: Financial Management, Cash Flow Management, Financial Planning
- CEO owns: Corporate Strategy, Executive Governance

### 7.6 `capabilities.json`
35 enumerated capabilities — lookup reference used by `taxonomy.json` and `ownership_rules.json`.

### 7.7 `functions.json`
19 enumerated organizational functions — supports `roles_config.json` TypeMappings.

### 7.8 `process_governors.json`
10 process governor entries with `governance_owner`:
- ExCo → CEO
- Product Board → ExCo (represented by CPO)
- NPI → CPO
- Commercial Planning, Business Operations, Education Governance → COO
- Finance Management → CFO
- IT Governance → CTO

### 7.9 `lifecycle_phases.json`
7 lifecycle phases: Establishment, Validation, Transfer, Operation, Improvement, Retirement, Unknown.

### 7.10 `execution_contexts.json`
12 execution context types: NPI-managed, Product Development, R&D Project, Operational BAU, Commercial BAU, Finance BAU, IT BAU, Executive Governance, Programme, Project, Ad Hoc, Unknown.

### 7.11 `confluence_mappings.json`
Maps Topic Domain → Confluence space + parent page ID:
- Product → WPM
- Technology → RnD
- Operations → Manufacturing
- SupplyChain → SCM
- IT → DevOps
- All others → PWMN (parent: 2102919177)
- `default_space`: "PWMN", `default_parent_id`: "2102919177"

### 7.12 `classification_rules.json` *(gitignored — must provision per environment)*
Contains:
- LLM system prompt (full EIP 1.1 instruction set including Part A summary structure and Part B topic record schema)
- Azure OpenAI endpoint URL
- API key (`api-key` header, not `Bearer`)
- `DeploymentName` (Azure OpenAI deployment identifier)
- Model name
- `ChunkSize` (default: 32000)
- `ChunkOverlap` (default: 500)
- `MaxTokens` (default: 16000)

### 7.13 `pipeline_config.json` *(gitignored — must provision per environment)*
Contains:
- `enable_stable_topic_classification`: boolean
- `enable_confluence_mirror`: boolean
- `confluence_space_key`, `confluence_parent_id`
- `confluence_user`, `confluence_token`, `confluence_base_url`
- `teams_webhook_url`

### 7.14 `config/people_config.json` *(gitignored — contains PII)*
~30 person entries, each with:
- `id`, `canonical_name`, `aliases[]`, `email`, `role`, `org_id`
- `seniority_level`, `decision_authority`
- `brand_affinity[]`, `brand_exclusions[]`
- `identity_quality`

---

## 8. TOPIC TAXONOMY (T01–T18 + 2 extended)

| ID | Name | Domain | TopicFamily | Default Owner | Governor |
|:---|:---|:---|:---|:---|:---|
| T01 | Product Performance | Product | Product | CPO | Product Board |
| T02 | Product Quality & Compliance | Product | Product | CPO | Product Board |
| T03 | Product Value & Perception | Product | Product | CPO | Product Board |
| T04 | Product Scope & Prioritisation | Product | Product | CPO | Product Board |
| T05 | Delivery Progress & Readiness | Governance | Delivery | CPO | Product Board |
| T06 | Delivery Risk & Constraints | Governance | Delivery | CPO | Product Board |
| T07 | Development Execution | Product | Delivery | CPO | Product Board |
| T08 | Cash Flow & Liquidity | Finance | Commercial | CFO | Finance Management |
| T09 | Cost Structure & Margins | Finance | Commercial | CFO | Finance Management |
| T10 | Revenue & Commercial Performance | Finance | Commercial | COO | Commercial Planning |
| T11 | Financial Risk & Exposure | Finance | Commercial | CFO | Finance Management |
| T12 | Organisation & Capability | People | People | CPO* | Product Board |
| T13 | Resource Allocation | People | People | CPO* | Product Board |
| T14 | Operational Effectiveness | Operations | Operations | CPO* | Product Board |
| T15 | Strategic Direction & Alignment | Strategy | Strategy | CEO | ExCo |
| T16 | Product-Market Fit | Strategy | Strategy | CPO | Product Board |
| T17 | Growth & Opportunities | Strategy | Strategy | COO | Commercial Planning |
| T18 | Delivery Confidence | Governance | Delivery | CEO | ExCo |
| — | AI | Technology | Technology | CTO | IT Governance |
| — | Data | Technology | Technology | CTO | IT Governance |

> *T12, T13, T14 default to CPO/Product Board. In COO-mode meetings, ContextOverride switches to People Operations/Supply Operations + Business Operations governor.

---

## 9. OUTPUT FILE FORMATS

### 9.1 Meeting Summary (`[id]-Summary.txt`)
9-section structured markdown:
```
--- [Header: MODE, MEETING ID, PIPELINE_VERSION] ---
## Topic: [Label]
DOMAIN: | TOPIC_ID: | CANONICAL_TOPIC: | SIGNAL: | TRAJECTORY:
[Body text]
...
## TOPIC TRENDS & PERSISTENCE
## STALLED WORK DETECTED
[Footer: Topic Records]
```

### 9.2 Topic Record (`[id]-[TopicId]-[slug].md`)
```markdown
# [TopicId]: [Topic Name]
**Meeting:** [id] | **Date:** YYYY-MM-DD | **Mode:** CPO

### METADATA
- DOMAIN: | TOPIC_FAMILY: | TOPIC: | CATEGORY: | CONTEXT_TYPE:
- STATUS: | TRAJECTORY: | TAGS:
- TITLE: [meeting-specific sentence]

### SUMMARY
[2-3 sentence overview]

### KEY FACTS
- [fact]

### DECISIONS
- [Decision] (Rationale: ...)

### ACTIONS
- [Action] (Owner: ..., Deadline: ...)

### RISKS
- [risk]

### NEXT STEPS
- [step]

### RETRIEVAL ANCHORS
- People: | Projects: | Products: | Systems: | Dependencies:

### OWNERSHIP
- PRIMARY_OWNER: | PROCESS_GOVERNOR: | GOVERNANCE_OWNER:
- CAPABILITY: | CAPABILITY_PHASE:
- OWNERSHIP_CONFIDENCE: | OWNERSHIP_REASON:

### VALIDATION
Status: PASS (Recovered) | [check results]
```

### 9.3 People File (`[id]-People.txt`)
Standard header (MEETING ID, SUBJECT, DATE, PIPELINE_VERSION, TYPE: People Intelligence) followed by per-person structured blocks from LLM output.

### 9.4 Master Log Entry (`master_log.json`)
```json
{
  "MeetingId": "2026-07-15_0400_mandar_peter__channel_meeting",
  "Subject": "Mandar Peter Channel Meeting",
  "EventDate": "2026-07-15T04:00:00Z",
  "Status": "success",
  "TranscriptUrl": "https://...",
  "SummaryUrl": "https://...",
  "PeopleFileUrl": "https://...",
  "ConfluenceUrl": "https://...",
  "TopicRecords": [{"TopicId": "T07", "Label": "Development Execution", "Url": "https://..."}],
  "Mode": "CPO",
  "ProcessingTimestamp": "2026-07-19T14:00:00",
  "PipelineVersion": "1.7.7"
}
```

---

## 10. VERIFICATION FRAMEWORK

**Location:** `artifacts/verification/RUN_{YYYYMMDD_HHmmss}_{hash}/`

| File | Purpose |
|:---|:---|
| `run_manifest.json` | Run metadata: source file, timestamp, artifact paths, run ID |
| `source_snapshot.vtt` | Original VTT input for this run |
| `expected_output.json` | Expected LLM extraction for grounding validation |
| `acceptance_report.json` | Structured pass/fail results |
| `acceptance_report.md` | Human-readable: Hard checks / Grounding / Schema / Retrieval |
| `schema_validation.json` | JSON schema conformance results |
| `grounding_validation.json` | Fact-checking: expected vs. extracted key facts |
| `actual_output_summary.json` | Captured actual LLM output for comparison |

**Validation categories:**
- **Hard:** Mandatory field presence (all 9 metadata axes, Summary field)
- **Grounding:** Specific facts from transcript present in Topic Records (e.g., "Canada sales uptake", "100 new schools")
- **Schema:** JSON structure conformance
- **Retrieval:** Named entity anchor completeness

---

## 11. VERSION HISTORY SUMMARY

| Version | Date | Headline |
|:---|:---|:---|
| 1.0.0 | 2026-05 | Initial pipeline: Graph REST, Teams calendar, SharePoint, Master Log, LLM classification |
| 1.1.0 | 2026-06 | Universal LLM summaries, EIP v2.0 enrichment, T01–T18 taxonomy |
| 1.2.0 | 2026-06 | 3D classification, Confluence mirroring, batch Teams notifications |
| 1.3.0 | 2026-06 | Map-reduce chunking, LLM auth fix, JSON sanitisation |
| 1.4.0 | 2026-06-29 | `-VttFile` direct mode |
| 1.5.0 | 2026-06-29 | People Intelligence Layer (`*-People.txt`, `master_people_log.*`) |
| 1.6.0 | 2026-07-01 | Warning-focused Teams notifications, brand/semantic model, negation-aware sentiment |
| 1.7.0 | 2026-07-01 | VTT Inbox Mode (OneDrive scan) |
| 1.7.1 | 2026-07-07 | 403 fallback for meeting fetch, auth header sync |
| 1.7.2 | 2026-07-08 | Timezone-invariant Meeting IDs (UTC), Master Log dedup rebuild |
| 1.7.3 | 2026-07-18 | 7-Day Retry Window, Topic Record Summary hardening |
| 1.7.4 | 2026-07-19 | Ownership Deep Recovery, env var credentials, dynamic Topic ID map |
| 1.7.5 | 2026-07-19 | Context-aware CPO/COO ownership, ContextOverride system |
| 1.7.6 | 2026-07-19 | Topic Records → `YYYY-MM/[id]/` folder structure |
| 1.7.7 | 2026-07-19 | Smart date parsing for `Sales_Call_*` and `HoD_*` filenames |
| 1.7.8 | 2026-07-20 | Ongoing meeting guard: skip transcript processing until 2h after scheduled end time |
| 1.7.9 | 2026-07-20 | Default lookback window reduced from 7 days to 5 days |

---

## 12. KEY DESIGN DECISIONS (for platform migration)

1. **No SDK.** All Microsoft Graph calls use `Invoke-RestMethod`. Do not add Graph SDK — it causes "Assembly already loaded" conflicts in Azure Functions.
2. **`api-key` header**, not `Bearer`, for Azure OpenAI authentication.
3. **Master Log is the deduplication source of truth** — loaded at startup, merged at the end. Never overwrite a `success` entry.
4. **Topic Records default to CPO** for ambiguous topics (Organisation, Resource Allocation, Operational Effectiveness, Delivery Progress, Delivery Risk). COO override is explicit via `ContextOverride` in `taxonomy.json`.
5. **VTT files are consumed (deleted) from inbox on success.** MeetingIntelligence source is non-destructive (read only).
6. **`classification_rules.json` must never be committed** — it contains the LLM API key.
7. **Meeting IDs are UTC-normalized** to prevent duplicates from timezone-offset runs.
8. **Retry window is 5 days** by default — meetings from the past 5 days are always re-evaluated (dedup prevents reprocessing of successes).
9. **Chunking is mandatory** for long transcripts — the LLM's context window is insufficient for full-day meeting transcripts. Map-reduce at 32K chars is the solution.
10. **Confluence mirror is opt-in** via `pipeline_config.json.enable_confluence_mirror`. It can be disabled without affecting SharePoint output.

---

*End of EIP Implementation Description v1.7.7*
