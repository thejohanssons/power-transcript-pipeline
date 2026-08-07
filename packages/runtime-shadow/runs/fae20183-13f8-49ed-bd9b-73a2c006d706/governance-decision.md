# Runtime-Shadow Governance Decision Record

## Decision metadata

| Field | Value |
| --- | --- |
| Run ID | `fae20183-13f8-49ed-bd9b-73a2c006d706` |
| Fixture | `synthetic-fixture-0001` / `synthetic-revision-1` |
| Runtime version | `1.0.3` |
| Run state | `completed` |
| Comparison status | `blocked` |
| Decision date | 2026-08-04 |
| Decision authority | User-approved governance decision |
| Scope | Local governance record only; no remote artifact, fixture, Azure baseline, Worker policy, or deployment change |

## Governing policy

Completed decisions require explicit source evidence. Imperatives, proposals, requests, and agenda items must be represented as actions unless the transcript explicitly confirms their completion.

Approved synthetic fixtures do not fail solely because participants or action owners are absent. Topic extraction and meeting classification differences remain subject to governance review.

## Blocking assertion discrepancy

### Comparison path

`assertions`

### Azure baseline assertion

> The local validation budget was approved.

### Cloudflare assertion

> Approve the local validation budget.

### Decision

Record this as an **Azure-baseline legacy semantic discrepancy**. The supplied transcript uses imperative language and does not explicitly state that budget approval was completed. The Cloudflare output correctly preserves that distinction under the approved explicit-evidence policy.

The remote comparison remains **blocked**. This record does not approve an equivalent disposition, alter the immutable Azure baseline, or weaken the completed-decision evidence requirement.

## Material governance reviews

### Topic count

| Field | Value |
| --- | --- |
| Comparison path | `topics.length` |
| Azure baseline | `0` |
| Cloudflare output | `1` |
| Governance resolution | `0` |
| Status | Resolved locally |

The fixture does not contain an evidenced business matter that maps reliably to an existing registered topic. “Local validation budget” is insufficient to assign a Finance or People topic without inventing semantic scope. The approved local governance outcome is therefore no topic projection.

### Meeting classification

| Field | Value |
| --- | --- |
| Comparison path | `classification` |
| Azure baseline | `internal` with `high` confidence |
| Cloudflare output | `meeting` with `high` confidence |
| Governance resolution | `internal` with `high` confidence |
| Status | Resolved locally |

The fixture is an internal synthetic exercise and supplies no organiser, meeting type, audience, or executive-role metadata. The approved local governance outcome is `internal` with `high` confidence; `meeting` is unsupported by the supplied evidence.

### Effect of the material resolutions

The two material differences are resolved for local governance purposes only. This record does not alter the remote comparison artifact, add remote reviewer dispositions, change the Worker, modify the fixture or Azure baseline, or trigger a rerun. The blocking `assertions` discrepancy remains unresolved and the remote comparison remains blocked.

## Boundaries retained

- The immutable fixture and frozen Azure baseline remain unchanged.
- The remote run remains blocked with one blocking and two material differences.
- No publication occurred; observed Cloudflare publication state remains all false.
- No production, Graph, SharePoint, Confluence, Teams, Topic Memory, or real-data operation is authorized by this record.

## Closure criteria

The material topic and classification reviews are resolved locally by this record. This record may be superseded only by an authorized decision on the remaining assertion discrepancy and—if desired—by a separately approved baseline correction process. Any change to assertion severity, baseline data, or the explicit-evidence policy requires separate review and approval.
