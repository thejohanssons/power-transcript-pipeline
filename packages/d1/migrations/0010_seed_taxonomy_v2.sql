-- ============================================================
-- Copyright (c) 2026 Virrata AB. All rights reserved.
-- EIP Platform — Canonical Topic Memory
-- Migration 0010: Seed the approved taxonomy contract v2.0.0
-- ============================================================
-- This registry is additive. It does not modify the legacy topics table.

INSERT OR IGNORE INTO taxonomy_topics (
  topic_id,
  taxonomy_version,
  topic_name,
  primary_domain,
  topic_family,
  aliases_json,
  created_at
) VALUES
  ('T01', '2.0.0', 'Product Performance', 'PRODUCT', 'Product', '[]', '2026-08-02T00:00:00.000Z'),
  ('T02', '2.0.0', 'Product Quality & Compliance', 'PRODUCT', 'Product', '[]', '2026-08-02T00:00:00.000Z'),
  ('T03', '2.0.0', 'Product Value & Perception', 'PRODUCT', 'Customer', '[]', '2026-08-02T00:00:00.000Z'),
  ('T04', '2.0.0', 'Product Scope & Prioritisation', 'PRODUCT', 'Product', '[]', '2026-08-02T00:00:00.000Z'),
  ('T05', '2.0.0', 'Delivery Progress & Readiness', 'DELIVERY', 'Delivery', '[]', '2026-08-02T00:00:00.000Z'),
  ('T06', '2.0.0', 'Delivery Risk & Constraints', 'DELIVERY', 'Delivery', '[]', '2026-08-02T00:00:00.000Z'),
  ('T07', '2.0.0', 'Development Execution', 'DELIVERY', 'Delivery', '[]', '2026-08-02T00:00:00.000Z'),
  ('T08', '2.0.0', 'Cash Flow & Liquidity', 'FINANCE', 'Finance', '[]', '2026-08-02T00:00:00.000Z'),
  ('T09', '2.0.0', 'Cost Structure & Margins', 'FINANCE', 'Finance', '[]', '2026-08-02T00:00:00.000Z'),
  ('T10', '2.0.0', 'Revenue & Commercial Performance', 'COMMERCIAL', 'Commercial', '[]', '2026-08-02T00:00:00.000Z'),
  ('T11', '2.0.0', 'Financial Risk & Exposure', 'FINANCE', 'Finance', '[]', '2026-08-02T00:00:00.000Z'),
  ('T12', '2.0.0', 'Organisation & Capability', 'PEOPLE', 'People', '[]', '2026-08-02T00:00:00.000Z'),
  ('T13', '2.0.0', 'Resource Allocation', 'PEOPLE', 'People', '[]', '2026-08-02T00:00:00.000Z'),
  ('T14', '2.0.0', 'Operational Effectiveness', 'OPERATIONS', 'Operations', '[]', '2026-08-02T00:00:00.000Z'),
  ('T15', '2.0.0', 'Strategic Direction & Alignment', 'STRATEGY', 'Strategy', '[]', '2026-08-02T00:00:00.000Z'),
  ('T16', '2.0.0', 'Product-Market Fit', 'STRATEGY', 'Strategy', '[]', '2026-08-02T00:00:00.000Z'),
  ('T17', '2.0.0', 'Growth & Opportunities', 'STRATEGY', 'Strategy', '[]', '2026-08-02T00:00:00.000Z'),
  ('T18', '2.0.0', 'Delivery Confidence', 'GOVERNANCE', 'Governance', '[]', '2026-08-02T00:00:00.000Z'),
  ('T19', '2.0.0', 'Artificial Intelligence', 'TECHNOLOGY', 'Technology', '["AI"]', '2026-08-02T00:00:00.000Z'),
  ('T20', '2.0.0', 'Data', 'TECHNOLOGY', 'Technology', '[]', '2026-08-02T00:00:00.000Z');
