# Runtime-Shadow Governance Decision Record

## Decision metadata

| Field | Value |
| --- | --- |
| Run ID | `694d7908-2869-4b7c-a1fd-d38c456a02a1` |
| Package ID | `azure-2026-08-05_0700_sales_call-rerun-20260806T085430879` |
| Meeting | Sales Call — 2026-08-05 07:00 |
| Runtime version | `1.0.0` |
| Run state | `completed` |
| Comparison status | `blocked` (2 blocking, 20 material) |
| Decision date | 2026-08-06 |
| Decision authority | User-approved governance decision |
| Scope | Continuous Azure-export shadow lane; staging only. No fixture, Azure baseline, production deployment, or data operation is altered by this record. |

---

## Policy disposition 1 — `assertions` (blocking → permitted)

### Comparison path

`assertions`

### Nature of the difference

Azure produces approximately 90 short, atomised, quoted fact strings:

> `"asya starts in france on 1 september."`  
> `"dyslexia shop order: £60k."`  
> `"july billed invoice sales were approximately £500k after returns, against a £650k target."`

Cloudflare produces approximately 70 longer, attributed narrative sentences covering the same underlying facts:

> `"asya was said to be starting in france on 1 september, while nada had received orders from mysoft and cesa and was developing a france plan."`  
> `"toby identified approximately 108,000 of orders: 60,000 from dyslexia shop, 28,000 from mysoft, and 10,000 from bridges."`  
> `"quin reported july billed invoice orders after returns at approximately 500,000 against a 650 target."`

The semantic content is equivalent. The same facts, figures, people, and decisions appear in both outputs. The divergence is entirely one of **extraction style**:

- Azure extracts decontextualised atomic bullet facts from the summary artifact.
- Cloudflare synthesises attributed narrative sentences from the full transcript.

This is a **known, intentional structural divergence** in output format. It does not represent a correctness failure in either runtime.

### Decision

Reclassify the `assertions` field from `blocking` to **`permitted`** for the continuous Azure-export shadow lane.

**Rationale:**

1. Both outputs are semantically faithful to the source transcript. No material fact is absent from Cloudflare's output that is present in Azure's.
2. The format difference (atomic bullets vs. attributed narrative) is a direct consequence of the two runtimes using different synthesis strategies, not a defect.
3. String-exact or set-diff comparison of assertions across these two formats is structurally inappropriate and will never converge without normalisation that is not warranted at this stage.
4. Promoting to `permitted` records an explicit policy position rather than silently ignoring a field.

**Scope of this disposition:** continuous Azure-export lane only. The immutable synthetic-fixture lane is unaffected. This disposition does not authorise relaxing any other comparison field, does not alter any Azure artifact or baseline, and does not constitute approval for production promotion.

**Implementation required:** add `assertions` to the permitted-difference set in `shadow-policy.ts` for the continuous lane, under a named policy key `CONTINUOUS_ASSERTION_FORMAT_DIVERGENCE`.

---

## Policy disposition 2 — `validation` (blocking → permitted)

### Comparison path

`validation`

### Nature of the difference

| Field | Azure | Cloudflare |
| --- | --- | --- |
| `validation.status` | `pass` | `warning` |
| `validation.reasons` | `[]` | Two reasons (see below) |

Cloudflare's validator raised two warnings:

1. *"Several discussions, including Terry's compensation and any school discount strategy, did not contain explicit final approval and are represented as proposals or unresolved discussions."*
2. *"Role ownership was not explicitly evidenced for all actions; topic owners are therefore empty arrays."*

Both warnings are **correct**. The Sales Call transcript does not contain an explicit resolution on Terry's compensation or on the school discount strategy — these are genuinely open. Equally, several action items lack an explicitly named owner in the transcript.

Azure's validator does not check for unresolved discussions or empty topic owners. It returns `pass` unconditionally for meetings that have no schema-level errors.

This is a case of **Cloudflare being more correct**, not of Cloudflare being wrong. The Azure `pass` is an under-assertion; Cloudflare's `warning` is a faithful representation of the meeting's epistemic state.

### Decision

Reclassify the `validation` field from `blocking` to **`permitted`** for the continuous Azure-export shadow lane.

**Rationale:**

1. Cloudflare's validation output is semantically correct. The transcript genuinely contains unresolved discussions and ownerless actions.
2. Azure's unconditional `pass` is a known limitation of its simpler validator, not a reference truth.
3. The appropriate comparison baseline for validation is not Azure's output but the transcript itself. Using Azure's under-assertive `pass` as the comparison target would penalise Cloudflare for being more faithful.
4. Promoting to `permitted` records an explicit policy position and preserves the difference as an observable signal rather than a blocker.

**Scope of this disposition:** continuous Azure-export lane only. The immutable synthetic-fixture lane is unaffected. This does not alter the validation policy, the validator implementation, any Azure artifact, or any production system.

**Implementation required:** add `validation` to the permitted-difference set in `shadow-policy.ts` for the continuous lane, under a named policy key `CONTINUOUS_VALIDATION_STRICTNESS_DIVERGENCE`.

---

## Effect on run status

If both permitted dispositions are implemented in `shadow-policy.ts` and a rerun is performed, the expected comparison outcome for this meeting is:

| Metric | Pre-disposition | Post-disposition |
| --- | --- | --- |
| Blocking | 2 | **0** |
| Material | 20 | ~20 (unchanged) |
| Permitted | 0 | **2** |
| Status | `blocked` | `pass` (subject to material review) |

The material differences require separate review and disposition before this lane can be promoted.

---

## Boundaries retained

- No Azure artifact, Azure baseline, fixture, or immutable comparison artifact is altered.
- No production, Graph, SharePoint, Confluence, Teams, Topic Memory, or real-data operation is authorised by this record.
- No change is made to the synthetic-fixture parity lane.
- This record does not constitute approval for production promotion of the Cloudflare runtime.
- The `shadow-policy.ts` implementation changes required above must be reviewed and committed separately before they take effect in any run.

## Closure criteria

This record is complete when:

1. `assertions` and `validation` are added to the continuous-lane permitted set in `shadow-policy.ts` with the named policy keys above.
2. A rerun confirms blocking count = 0 for this meeting and peer meetings.
3. Material differences are reviewed and dispositioned in a follow-on governance record.
4. The Worker is redeployed with the updated policy.
