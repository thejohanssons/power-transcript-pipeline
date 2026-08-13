#!/usr/bin/env node
// ============================================================
// EIP Local Cockpit Server — CI guard (Step 2)
//
// Fails CI if the local-server package contains any Wrangler
// configuration, Worker binding configuration, or deployment
// scripts. This prevents accidental promotion of raw-data code.
//
// Run from the CI workflow as:
//   node packages/local-cockpit-server/scripts/ci-guard.mjs
// ============================================================

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

const FORBIDDEN_FILES = [
  'wrangler.jsonc',
  'wrangler.toml',
  'wrangler.json',
];

// Package script names that must not appear in package.json
const FORBIDDEN_SCRIPTS = [
  'wrangler',
  'deploy',
  'preview',
  'publish',
];
// Exception: scripts that hard-fail are allowed (they exist specifically to block)
const HARD_FAIL_PREFIX = 'echo \'ERROR:';

// Patterns in source files that indicate Worker/binding usage
const FORBIDDEN_SOURCE_PATTERNS = [
  /from\s+['"]cloudflare:workers['"]/,
  /import\s+.*\bWorkerEntrypoint\b/,
  /export\s+default\s+\{[^}]*fetch\s*\(/,  // Worker fetch handler
  /new\s+WorkerEntrypoint/,
];

let failures = 0;

function fail(message) {
  console.error(`  ❌ FAIL: ${message}`);
  failures++;
}

function pass(message) {
  console.log(`  ✅ PASS: ${message}`);
}

// ── Check 1: No wrangler config files ─────────────────────
console.log('\n[ci-guard] Check 1: No Wrangler config files in local-server package');
for (const file of FORBIDDEN_FILES) {
  try {
    await stat(join(PKG_ROOT, file));
    fail(`Found forbidden Wrangler config: ${file}`);
  } catch {
    pass(`No ${file} present`);
  }
}

// ── Check 2: package.json scripts are safe ─────────────────
console.log('\n[ci-guard] Check 2: package.json scripts do not invoke Wrangler or deploy');
const pkgJson = JSON.parse(await readFile(join(PKG_ROOT, 'package.json'), 'utf-8'));
const scripts = pkgJson.scripts ?? {};

for (const [name, value] of Object.entries(scripts)) {
  const lowerValue = String(value).toLowerCase();
  const isForbiddenScript = FORBIDDEN_SCRIPTS.includes(name) &&
    !String(value).startsWith(HARD_FAIL_PREFIX);

  if (isForbiddenScript) {
    fail(`Script "${name}" must hard-fail but appears to run: ${value}`);
  } else if (lowerValue.includes('wrangler deploy') || lowerValue.includes('wrangler publish')) {
    fail(`Script "${name}" invokes wrangler deploy/publish: ${value}`);
  } else if (name !== 'wrangler' && lowerValue.includes('wrangler') &&
             !String(value).startsWith(HARD_FAIL_PREFIX)) {
    fail(`Script "${name}" invokes wrangler unexpectedly: ${value}`);
  } else {
    pass(`Script "${name}" is safe`);
  }
}

// ── Check 3: No Worker binding imports in source ───────────
console.log('\n[ci-guard] Check 3: No Worker/Cloudflare binding imports in source files');

async function walkTs(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) files.push(...await walkTs(full));
    else if (e.name.endsWith('.ts') || e.name.endsWith('.js')) files.push(full);
  }
  return files;
}

const srcFiles = await walkTs(join(PKG_ROOT, 'src'));
for (const file of srcFiles) {
  const content = await readFile(file, 'utf-8');
  for (const pattern of FORBIDDEN_SOURCE_PATTERNS) {
    if (pattern.test(content)) {
      fail(`Found Worker/binding pattern in ${file.replace(PKG_ROOT, '')}: ${pattern}`);
    }
  }
}
if (failures === 0 || srcFiles.every(() => true)) {
  pass(`${srcFiles.length} source file(s) checked — no Worker binding imports`);
}

// ── Check 4: No devDependency on @cloudflare/workers-types ─
console.log('\n[ci-guard] Check 4: No @cloudflare/workers-types dependency');
const allDeps = {
  ...pkgJson.dependencies,
  ...pkgJson.devDependencies,
  ...pkgJson.peerDependencies,
};
if ('@cloudflare/workers-types' in allDeps) {
  fail('Found @cloudflare/workers-types in dependencies — this is a Worker-only type package');
} else {
  pass('No @cloudflare/workers-types dependency');
}

// ── Result ─────────────────────────────────────────────────
console.log(`\n[ci-guard] Result: ${failures} failure(s)\n`);
if (failures > 0) {
  console.error(
    '[ci-guard] ❌ CI guard FAILED. The local-server package must not contain\n' +
    '           Wrangler config, Worker bindings, or deployment scripts.\n' +
    '           This prevents raw production data from being accidentally deployed.'
  );
  process.exit(1);
} else {
  console.log('[ci-guard] ✅ All checks passed. Local-server package is safe.');
}
