# Microsoft Teams Transcript Pipeline

An automated PowerShell-based pipeline that fetches Microsoft Teams meeting transcripts via Microsoft Graph and uploads them to SharePoint. This project is specifically designed to run as an **Azure Function** (PowerShell 7.4) using a daily timer trigger.

## Architecture Positioning

The Azure Function and PowerShell pipeline are the primary production system. They retrieve transcripts through the supported intake paths, process them, and create the established structured artefacts, logs, and records in SharePoint.

Cloudflare D1/R2 processing is an independent, asynchronous extension for validating a possible future migration target. After the Azure pipeline completes its existing processing and SharePoint work, it may submit raw transcript content and meeting metadata to Cloudflare for separate processing. Cloudflare must not block, replace, or become the system of record for the Azure-to-SharePoint workflow until an explicit migration decision is made.

For the current repository-wide project scope, package status, architecture boundaries, and continuation gates, see the canonical [Project Status](plans/STATUS.md). For detailed Cloudflare runtime handover and migration-validation work, see [Cloudflare Runtime Handover](plans/cloudflare-real-runtime-handover.md).

## 🏗 Architecture

```mermaid
graph TD
    A[Azure Function Timer] -->|Daily 2:00 AM| B(TranscriptJob / run.ps1)
    B --> C{power-transcript-pipeline.ps1}
    C -->|OAuth2 Client Credentials| D[Microsoft Graph REST API]
    D -->|Get Events| E[Target User Calendar]
    E -->|Filter Completed| F{Meeting List}
    F -->|Fetch Transcript| G[Teams Online Meetings]
    G -->|Upload TXT| H[SharePoint: Petersplace]
    C -->|Upload Logs| I[SharePoint: Run logs]
```

## 🚀 Key Features

- **SDK-Free Graph Integration**: Uses standard REST API calls (`Invoke-RestMethod`) to avoid common "Assembly already loaded" SDK conflicts in Azure Functions.
- **Azure Function Native**: Includes a pre-configured `TranscriptJob` with a daily timer trigger (Default: 2:00 AM).
- **7-Day Retry Window**: Automated runs look back 7 days by default. This ensures that any transcripts that failed or were delayed in previous runs are retried, while built-in deduplication (SKIP logic) prevents duplicate processing.
- **SharePoint Integration**: Automatically organizes transcripts into month-based folders (`YYYY-MM`) and maintains execution logs.
- **Resilient Execution**: Configured with a 10-minute timeout to handle large batches of meetings.

## 🔎 Local Runtime D1 Report

The localhost-only Cockpit package includes a read-only runtime D1 reporting script:

```text
packages/local-cockpit-server/scripts/test-runtime-topic-lists.mjs
```

Run it from the repository root with:

```bash
npm --prefix packages/local-cockpit-server run test:runtime-topic-lists
```

The report reads runtime topics, topic memories, actions, decisions, and risks, and presents them as:

1. **Topic memory cards** — branched cards with domain, type, status, match status, meeting count, dates, outcome, disposition, and last meeting.
2. **Actions by owner** — every action listed beneath its owner with ID, status, due date, meeting, topic, and memory context.
3. **Decisions** — decision text with owner, meeting, topic, and memory context.
4. **Risks** — risk text with severity, status, meeting, topic, and memory context.

Optional filters are available for focused checks:

```bash
npm --prefix packages/local-cockpit-server run test:runtime-topic-lists -- \
  --meeting-id "2026-08-11_1130_npi_stage_3___biweekly" \
  --owner "Theo Davies" \
  --status open
```

Supported filters are `--owner`, `--status`, `--meeting-id`, and `--topic-memory-id`. Use `--json` for machine-readable output. The script is read-only: it queries runtime D1 and does not access R2, write D1 records, or persist feedback.

## 🔑 Permissions (Microsoft Graph)

The Azure AD App Registration (Service Principal) used for this pipeline requires the following **Application Permissions**:

| Scope | Purpose |
| :--- | :--- |
| `Calendars.Read` | To scan the target user's calendar for Team meetings. |
| `OnlineMeetingTranscript.Read.All` | To download the meeting transcripts. |
| `Sites.ReadWrite.All` | To create folders and upload transcript files to SharePoint. |
| `User.Read.All` | To resolve organizer IDs and UPNs. |

> **Note**: These must be "Application" permissions, and "Admin Consent" must be granted in the Azure Portal.

## ⚙️ Configuration (Azure App Settings)

| Setting | Description |
| :--- | :--- |
| `GRAPH_CLIENT_SECRET` | The client secret from your Azure AD App Registration. |
| `WEBSITE_TIME_ZONE` | Set to `GMT Standard Time` for accurate CRON scheduling. |
| `AzureWebJobsStorage` | Connection string for the internal storage account. |

## 🔄 Backfilling Historical Data

The pipeline supports manual backfilling by passing custom date ranges. Since the Azure Function is a wrapper for the pipeline script, you can run it manually via the terminal:

1. **Navigate to the root directory.**
2. **Run the script with parameters**:
   ```powershell
   .\power-transcript-pipeline.ps1 -FromDate "2026-05-01" -ToDate "2026-05-31"
   ```
   *Note: Ensure your `GRAPH_CLIENT_SECRET` is set in your local session environment before running.*

## 🛠 Troubleshooting

### 1. "Assembly with same name is already loaded"
This is a known issue when using the Microsoft Graph SDK in Azure Functions. This project resolves this by using standard REST calls instead of the SDK DLLs. **Do not re-add the Graph SDK to `requirements.psd1`**.

### 2. SharePoint "Access Denied" (403)
Ensure the App Registration has `Sites.ReadWrite.All` and that the SharePoint Site URL in `power-transcript-pipeline.ps1` (`$spSiteServerRelPath`) is correct.

## 🚢 Deployment

```bash
az login
func azure functionapp publish peter-consolidate-meeting-transcripts --powershell
```

---
*Generated by Rovo Dev*



---
*Copyright © 2026 Virrata AB. All rights reserved. Proprietary and confidential.*
