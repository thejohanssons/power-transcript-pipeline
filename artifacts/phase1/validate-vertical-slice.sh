#!/bin/sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
FIXTURE="$ROOT/artifacts/phase1/vat-decision-vertical-slice-submission.json"
DB_FILE="$(mktemp "${TMPDIR:-/tmp}/eip-phase1.XXXXXX.db")"
trap 'rm -f "$DB_FILE"' EXIT

for migration in "$ROOT"/packages/d1/migrations/*.sql; do
  sqlite3 "$DB_FILE" ".read '$migration'"
done

python3 - "$FIXTURE" "$DB_FILE" <<'PY'
import json
import sqlite3
import sys

fixture_path, db_path = sys.argv[1:]
with open(fixture_path, encoding="utf-8") as source:
    payload = json.load(source)

assert payload["contract_version"] == "2.0.0"
assert payload["taxonomy_version"] == "2.0.0"
assert len(payload["claims"]) == 2
assert {claim["classification_status"] for claim in payload["claims"]} == {"Candidate"}
assert {claim["topic_id"] for claim in payload["claims"]} == {"T11"}
assert not any(claim["context_type"] == "Decision" and claim["category"] == "Decision" for claim in payload["claims"])
assert all(claim["provenance"]["review_required"] is True for claim in payload["claims"])

connection = sqlite3.connect(db_path)
try:
    found_topics = connection.execute(
        "SELECT topic_id FROM taxonomy_topics WHERE taxonomy_version = ? AND topic_id = ?",
        (payload["taxonomy_version"], "T11"),
    ).fetchall()
    assert found_topics == [("T11",)]

    evidence = payload["evidence"]
    connection.execute(
        """INSERT INTO evidence_items (
          evidence_id, source_system, source_native_id, source_locator, occurred_at,
          content_hash, ingested_at, source_version, confidence, access_classification,
          source_metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            evidence["evidence_id"], evidence["source_system"], evidence["source_native_id"],
            evidence["source_locator"], evidence["occurred_at"], evidence["content_hash"],
            evidence["occurred_at"], evidence["source_version"], evidence["confidence"],
            evidence["access_classification"], json.dumps(evidence["source_metadata"]),
        ),
    )
    for claim in payload["claims"]:
        connection.execute(
            """INSERT OR IGNORE INTO topic_cases (
              case_id, case_title, lifecycle_state, creation_evidence_id, created_at
            ) VALUES (?, ?, ?, ?, ?)""",
            (claim["case_id"], claim["case_title"], claim["lifecycle_state"], evidence["evidence_id"], evidence["occurred_at"]),
        )
        connection.execute(
            """INSERT OR IGNORE INTO case_topics (
              case_id, topic_id, taxonomy_version, rationale, provenance_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)""",
            (claim["case_id"], claim["topic_id"], payload["taxonomy_version"], "Fixture candidate classification", json.dumps(claim["provenance"]), evidence["occurred_at"]),
        )
        connection.execute(
            """INSERT INTO claims (
              claim_id, case_id, context_type, topic_id, taxonomy_version, category,
              classification_status, claim_text, confidence, provenance_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (claim["claim_id"], claim["case_id"], claim["context_type"], claim["topic_id"], payload["taxonomy_version"], claim["category"], claim["classification_status"], claim["claim_text"], claim["confidence"], json.dumps(claim["provenance"]), evidence["occurred_at"]),
        )
        connection.execute(
            "INSERT INTO claim_evidence (claim_id, evidence_id, support_role, created_at) VALUES (?, ?, 'Primary', ?)",
            (claim["claim_id"], evidence["evidence_id"], evidence["occurred_at"]),
        )
    connection.commit()

    claims, links = connection.execute("SELECT COUNT(*) FROM claims").fetchone()[0], connection.execute("SELECT COUNT(*) FROM claim_evidence").fetchone()[0]
    assert (claims, links) == (2, 2)

    # Evidence identity must be idempotent for exact replays. A different producer
    # identity for the same required idempotency tuple must be rejected.
    try:
        connection.execute(
            """INSERT INTO evidence_items (
              evidence_id, source_system, source_native_id, source_locator, occurred_at,
              content_hash, ingested_at, source_version, confidence, access_classification
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                "conflicting-evidence-id", evidence["source_system"], evidence["source_native_id"],
                evidence["source_locator"], evidence["occurred_at"], evidence["content_hash"],
                evidence["occurred_at"], evidence["source_version"], evidence["confidence"],
                evidence["access_classification"],
            ),
        )
        raise AssertionError("Evidence idempotency tuple accepted a conflicting producer identity")
    except sqlite3.IntegrityError:
        pass

    # Changed content at the same source locator is a new evidence item and must
    # explicitly name the previous immutable evidence as its superseded source.
    changed_hash = "a" * 64
    connection.execute(
        """INSERT INTO evidence_items (
          evidence_id, source_system, source_native_id, source_locator, occurred_at,
          content_hash, ingested_at, source_version, confidence, access_classification,
          supersedes_evidence_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            "evidence-exco-vat-2026-07-22-577-596-v2", evidence["source_system"], evidence["source_native_id"],
            evidence["source_locator"], evidence["occurred_at"], changed_hash, evidence["occurred_at"],
            "fixture-supersession-test", evidence["confidence"], evidence["access_classification"], evidence["evidence_id"],
        ),
    )
    supersession = connection.execute(
        "SELECT supersedes_evidence_id FROM evidence_items WHERE evidence_id = ?",
        ("evidence-exco-vat-2026-07-22-577-596-v2",),
    ).fetchone()
    assert supersession == (evidence["evidence_id"],)
finally:
    connection.close()

print("VAT vertical-slice fixture validated: review-required claims, evidence links, idempotency conflict rejection, and changed-content supersession verified.")
PY
