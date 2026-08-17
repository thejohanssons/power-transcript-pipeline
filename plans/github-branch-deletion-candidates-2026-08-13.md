# GitHub Branch Deletion Candidates

**Date:** 2026-08-13  
**Repository:** `thejohanssons/power-transcript-pipeline`  
**Default branch:** `main`  
**Purpose:** Owner-approval list for stale remote branches.  
**Mode:** Review-only. No branch was deleted, renamed, merged, or otherwise modified.

## Evidence basis

The review checked:

- Remote branch existence and tip commit.
- Latest commit date and subject.
- Comparison with `main`.
- Open and historical pull requests using each branch as the head.
- Whether the branch is protected.

There are currently no open pull requests for the reviewed branches. The repository’s branches are not protected, including `main`; this list therefore requires explicit owner approval before any deletion action.

## Recommended deletion candidates

These branches have **zero commits ahead of `main`**. Their tips are ancestors of `main`, so their branch-specific work is already reachable from the default branch. No open or historical PR was found for any of them.

| Branch | Tip commit | Last activity | Relation to `main` | PR evidence | Recommendation |
|---|---|---:|---|---|---|
| `debug_branch` | `48bbe58172e7ba4b87002b7e58d47fa8fecb83c0` | 2026-07-18 13:53 UTC | 0 ahead / 114 behind | No open or historical PR found | Delete after owner approval |
| `dev` | `9aac32feb151f0e0cf9cdbf9f314547366c0030c` | 2026-07-11 13:37 UTC | 0 ahead / 119 behind | No open or historical PR found | Delete after owner approval |
| `feature/eip-v1.1-cr-002-taxonomy` | `9aac32feb151f0e0cf9cdbf9f314547366c0030c` | 2026-07-11 13:37 UTC | 0 ahead / 119 behind | No open or historical PR found | Delete after owner approval |
| `fix/topic-records-confluence` | `c3a2313535ac2a714be309900ed8cfd924a02a2a` | 2026-07-16 13:52 UTC | 0 ahead / 116 behind | No open or historical PR found | Delete after owner approval |
| `develop` | `d75fedd0c619dcd53885f41d2701c96371d927c8` | 2026-08-04 11:40 UTC | 0 ahead / 35 behind | No open or historical PR found | Delete after owner approval, unless intentionally retained as an integration-branch name |

### Special redundancy

`dev` and `feature/eip-v1.1-cr-002-taxonomy` point to the same commit and have no associated PR. Unless the name is reserved for a documented workflow, the feature branch is redundant with `dev` and is the strongest deletion candidate.

## Branch explicitly retained pending review

| Branch | Tip commit | Last activity | Relation to `main` | PR evidence | Recommendation |
|---|---|---:|---|---|---|
| `phase0-contract` | `e23eb685275f880e1cccf9f7c8f2a063e0146b03` | 2026-08-03 06:38 UTC | Diverged; 5 commits ahead / 42 behind | No open or historical PR found | **Do not delete** until its five unique commits are merged, explicitly superseded, or owner-approved for disposal |

The unique commits include Phase 0 contract decisions and a Phase 1 canonical topic-memory slice. The branch may be stale, but the commit graph does not support automatic deletion.

## Owner approval checklist

Before deletion, the owner should confirm for each candidate:

- The branch is no longer used by an active developer, automation job, deployment workflow, or local checkout.
- Any useful commits, tags, release references, or review context are already preserved elsewhere.
- No unmerged work is hidden behind the branch name.
- The owner accepts deletion as remote-branch cleanup rather than archival.
- A recovery reference is retained if required by team policy.

For `develop`, explicitly answer whether the branch name is reserved as an integration branch before deleting it.

For `phase0-contract`, explicitly choose merge, archive, or retain; do not include it in a deletion batch without a separate decision.

## Proposed owner decision

- [ ] Approve deletion of `debug_branch`
- [ ] Approve deletion of `dev`
- [ ] Approve deletion of `feature/eip-v1.1-cr-002-taxonomy`
- [ ] Approve deletion of `fix/topic-records-confluence`
- [ ] Approve deletion of `develop`
- [ ] Retain `phase0-contract` pending a separate disposition

## Explicit non-actions

This document does not authorize:

- `git push --delete` or any other branch deletion;
- merge, commit, force-push, or branch protection changes;
- migration execution;
- Cloudflare or Azure deployment;
- changes to repository files beyond this owner-approval document.
