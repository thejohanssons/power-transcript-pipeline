# Read-only live platform audit runbook

**Purpose:** Verify whether the repository is clean, committed, pushed, merged, successfully validated, and deployed across GitHub, Cloudflare, and Azure.

**Safety:** Every command below is read-only except `git fetch --prune`, which updates **local remote-tracking references only**. It does not change the checked-out branch, working-tree files, commits, remote repository, Cloudflare resources, Azure resources, or secrets.

**Do not run:** `git push`, `git merge`, `wrangler deploy`, `wrangler d1 migrations apply`, `az functionapp restart`, Azure deployment commands, or commands that print secret values.

## Prerequisites

Run from the repository root. The developer workstation must have authenticated, non-expired sessions for:

- GitHub CLI (`gh auth status`)
- Cloudflare Wrangler (`npx wrangler whoami` or `wrangler whoami`)
- Azure CLI (`az account show`)

Required tools:

- Git
- GitHub CLI (`gh`)
- Node.js and package dependencies for each Worker package
- Azure CLI (`az`)

If `npx wrangler` requires package download, stop and report that instead of installing packages during this audit.

## 1. Repository state and upstream parity

```zsh
# Local-only update of remote-tracking refs; no merge/rebase/push.
git fetch --prune origin

echo '\n=== Branch, upstream, and working tree ==='
git status --short --branch

echo '\n=== Current commit ==='
git log -1 --format='%H%n%h %s%n%ad%n%D' --date=iso-strict

echo '\n=== Upstream commit ==='
git log -1 origin/main --format='%H%n%h %s%n%ad%n%D' --date=iso-strict

echo '\n=== Commits ahead of origin/main ==='
git log --oneline origin/main..HEAD

echo '\n=== Commits behind origin/main ==='
git log --oneline HEAD..origin/main

echo '\n=== Tracked ignored files, if any ==='
git ls-files -ci --exclude-standard

echo '\n=== Local branches without an upstream ==='
git for-each-ref --format='%(refname:short) %(upstream:short)' refs/heads | awk '$2 == "" { print }'
```

**Pass criteria**

- `git status --short --branch` shows `## main...origin/main` with no ahead/behind count and no file entries.
- Both ahead/behind logs are empty.
- No secrets or local configuration appear in the tracked-ignored report.

## 2. GitHub branch protection, open pull requests, and CI/CD execution

```zsh
REPO='thejohanssons/power-transcript-pipeline'

printf '\n=== GitHub authentication ===\n'
gh auth status

printf '\n=== Repository default branch and visibility ===\n'
gh repo view "$REPO" --json nameWithOwner,isPrivate,defaultBranchRef,url

printf '\n=== Main branch protection ===\n'
gh api "repos/$REPO/branches/main/protection" 2>&1 || true

printf '\n=== Open pull requests ===\n'
gh pr list --repo "$REPO" --state open \
  --json number,title,headRefName,baseRefName,mergeStateStatus,isDraft,updatedAt,url

printf '\n=== Recently merged pull requests ===\n'
gh pr list --repo "$REPO" --state merged --limit 20 \
  --json number,title,headRefName,baseRefName,mergedAt,mergeCommit,url

printf '\n=== Recent workflow runs ===\n'
gh run list --repo "$REPO" --limit 30 \
  --json databaseId,name,displayTitle,event,status,conclusion,headBranch,headSha,createdAt,updatedAt,url

printf '\n=== Workflow runs for current main SHA ===\n'
SHA="$(git rev-parse origin/main)"
gh run list --repo "$REPO" --commit "$SHA" --limit 30 \
  --json databaseId,name,event,status,conclusion,headSha,createdAt,updatedAt,url

printf '\n=== Defined GitHub Actions workflows ===\n'
gh workflow list --repo "$REPO"
```

**Pass criteria**

- No open PR is unintentionally awaiting merge.
- The current `origin/main` SHA has successful CI and any deployment workflows that its changed paths should trigger.
- Failed, cancelled, or in-progress runs are understood and either retried by the developer later or explicitly accepted as non-blocking.
- Branch protection is present if that is the repository governance policy. Record `404`/permission errors as unverified, not as disabled.

## 3. Cloudflare account and deployed Worker versions

Run each block from its package directory. These commands inspect active versions and resource/migration state only.

### 3.1 Live Cloudflare runtime

```zsh
cd packages/cloudflare-runtime || exit 1

printf '\n=== Cloudflare identity ===\n'
npx wrangler whoami

printf '\n=== Production Worker versions ===\n'
npx wrangler versions list

printf '\n=== Staging Worker versions ===\n'
npx wrangler versions list --env staging

printf '\n=== Production D1 migration status ===\n'
npx wrangler d1 migrations list eip-cloudflare-runtime --remote

printf '\n=== Staging D1 migration status ===\n'
npx wrangler d1 migrations list eip-cloudflare-runtime-staging --remote

printf '\n=== Production queues ===\n'
npx wrangler queues list
```

### 3.2 API Worker and its D1 database

```zsh
cd packages/api-worker || exit 1

printf '\n=== Production Worker versions ===\n'
npx wrangler versions list

printf '\n=== Staging Worker versions ===\n'
npx wrangler versions list --env staging

printf '\n=== Production D1 migration status ===\n'
npx wrangler d1 migrations list eip-platform --remote

printf '\n=== Staging D1 migration status ===\n'
npx wrangler d1 migrations list eip-platform-staging --remote
```

### 3.3 Synthetic ExCo cockpit

```zsh
cd packages/exco-cockpit || exit 1

printf '\n=== Production Worker versions ===\n'
npx wrangler versions list

printf '\n=== Staging Worker versions ===\n'
npx wrangler versions list --env staging
```

**Interpretation notes**

- The documented production Worker is `eip-cloudflare-runtime`; its active version should correspond to the current intended runtime code.
- The documented staging runtime environment exists but the repository status says it has not been deployed. An empty/stale staging version result is therefore expected unless a newer approved change says otherwise.
- The synthetic cockpit is explicitly recorded as not deployed. No deployed version is therefore expected unless separately approved.
- The repository contains a GitHub deployment workflow for `eip-api-worker`, but no equivalent GitHub workflow for `eip-cloudflare-runtime` or `eip-exco-cockpit`. Record their deployment provenance from version metadata and developer release history.
- Migration output must show no pending migration that should be applied for the deployed code. Do **not** apply any migration during this audit.

## 4. Azure Function App deployment metadata

The Azure resource group is not declared in the repository. First locate it without changing anything:

```zsh
printf '\n=== Azure authenticated identity ===\n'
az account show --query '{subscription:name,subscriptionId:id,tenantId:tenantId,user:user.name}' -o json

printf '\n=== Candidate Function Apps ===\n'
az functionapp list \
  --query "[?name=='peter-consolidate-meeting-transcripts'].{resourceGroup:resourceGroup,name:name,state:state,defaultHostName:defaultHostName,lastModifiedTimeUtc:lastModifiedTimeUtc}" \
  -o table
```

Set the returned resource group locally, replacing the example only in the terminal:

```zsh
RESOURCE_GROUP='REPLACE_WITH_DISCOVERED_RESOURCE_GROUP'
FUNCTION_APP='peter-consolidate-meeting-transcripts'

printf '\n=== Function App deployment state ===\n'
az functionapp show --resource-group "$RESOURCE_GROUP" --name "$FUNCTION_APP" \
  --query '{resourceGroup:resourceGroup,name:name,state:state,defaultHostName:defaultHostName,lastModifiedTimeUtc:lastModifiedTimeUtc,httpsOnly:httpsOnly,kind:kind}' -o json

printf '\n=== Function App runtime and deployment settings metadata ===\n'
az functionapp config appsettings list --resource-group "$RESOURCE_GROUP" --name "$FUNCTION_APP" \
  --query "[?name=='FUNCTIONS_EXTENSION_VERSION' || name=='FUNCTIONS_WORKER_RUNTIME' || name=='WEBSITE_RUN_FROM_PACKAGE' || name=='WEBSITE_NODE_DEFAULT_VERSION' || name=='WEBSITE_SITE_NAME'].{name:name,value:value}" -o table

printf '\n=== Azure deployment history ===\n'
az deployment group list --resource-group "$RESOURCE_GROUP" \
  --query "sort_by([?contains(properties.outputs, '$FUNCTION_APP') || contains(name, '$FUNCTION_APP')], &properties.timestamp)[-20:].{name:name,state:properties.provisioningState,timestamp:properties.timestamp}" -o table
```

**Important:** Do not use `az functionapp config appsettings list` without the limited query above in shared output, because application settings can contain credentials and endpoint details. Never print `CLOUDFLARE_SUBMISSION_TOKEN`, API keys, webhook URLs, or connection strings.

**Pass criteria**

- Function App state is `Running`.
- Its last modification/deployment evidence is consistent with the latest successful `Deploy Pipeline to Azure Functions` GitHub Actions run for the current expected main commit.
- The process remains functional only if externally configured secrets required by the pipeline are present; validate their **names** privately if needed, never their values.

## 5. Housekeeping and CI coverage review

The developer should report these from the repository without changing files:

```zsh
cd /path/to/power-transcript-pipeline || exit 1

printf '\n=== Ignore coverage for known local/secret files ===\n'
git check-ignore -v \
  packages/local-cockpit-server/.env.local \
  packages/local-cockpit-server/.dev.vars \
  packages/cloudflare-runtime/.dev.vars \
  packages/pipeline/pipeline_config.json \
  packages/pipeline/classification_rules.json || true

printf '\n=== Potentially sensitive tracked filenames ===\n'
git ls-files | grep -E -i '(^|/)(\.env|.*secret.*|.*credential.*|.*token.*|.*key.*|local\.settings\.json|pipeline_config\.json)$' || true

printf '\n=== Package lockfiles and package manifests ===\n'
find packages -maxdepth 2 \( -name package.json -o -name package-lock.json \) -print | sort

printf '\n=== Latest actions runs with non-success conclusions ===\n'
gh run list --repo 'thejohanssons/power-transcript-pipeline' --limit 100 \
  --json name,status,conclusion,headSha,createdAt,url \
  --jq '.[] | select(.status != "completed" or (.conclusion != "success" and .conclusion != "skipped"))'
```

Review results against these known repository concerns:

1. CI currently validates API Worker typechecking, local cockpit guard/typechecking/tests, and the pipeline lint. It does not visibly run Cloudflare runtime tests, runtime-shadow tests, ExCo cockpit tests, or deployment dry-runs.
2. The `deploy-sync-worker` workflow references `packages/sync-worker`, which is not present and intentionally contains only a placeholder. Treat it as stale workflow configuration until removed or implemented.
3. `CHANGELOG.md` is stale versus the 2026-08 runtime changes, while `plans/STATUS.md` and the runtime handover provide newer operational status. Update or formally supersede the changelog in a separate approved change.
4. The current `.gitignore` excludes common local secret locations, including local cockpit `.env.local`, Wrangler `.dev.vars`, and pipeline configuration paths. Verify the tracked-files output contains no exception.
5. The runtime handover identifies known unfinished work: topic-match `accept` returns 501, Confluence mirror 404, legacy runtime-shadow decommissioning, and undeployed Cloudflare staging runtime. These are known gaps, not audit failures, unless they contradict an approved release claim.

## 6. Evidence package to return

Return one text file or message containing:

1. The full output of sections 1–5, excluding all secret values.
2. The current `origin/main` full SHA.
3. Links to the latest CI run, API Worker deployment run, Azure pipeline deployment run, and relevant Cloudflare Worker versions.
4. A brief classification for every finding:
   - `PASS` — verified and current
   - `GAP` — incomplete, stale, failed, or unmerged
   - `UNVERIFIED` — permission/tooling limitation prevented confirmation
   - `EXPECTED-DEFERRED` — intentionally not deployed or intentionally deferred
5. A proposed, separate remediation sequence. Do not make remediation changes during the audit.

## Decision rule

Do not assert that everything is committed, pushed, merged, and deployed until all of the following are true:

- The working tree is clean and local `main` equals freshly fetched `origin/main`.
- No unexpected open PRs or unmerged release branches remain.
- Relevant checks for the current main SHA succeeded.
- Each intentionally live component has a verified live deployment consistent with that SHA or an explicitly recorded approved release SHA.
- All expected database migrations are applied.
- Azure Function App is running and deployment evidence is consistent with GitHub Actions.
- Deferred components and technical debt are recorded as deliberate exceptions, with their approval/owner/status source.
