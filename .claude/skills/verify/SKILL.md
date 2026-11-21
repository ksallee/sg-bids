---
name: verify
description: Run sg-bids' live end-to-end drive (scripts/e2e-live.mjs) once at the end of a feature PR, against a throwaway database and the Flow PT sandbox project, and report what it read back.
---

# Verify sg-bids end to end

Done means the change ran. Run this once per feature PR, at the end, not per edit.

1. Point the drive at a throwaway database, never one a running app reads: `SUPABASE_URL`,
   `SUPABASE_SECRET_KEY` and `POSTGRES_URL_NON_POOLING` in the environment win over `.env.local`. A
   local Postgres and PostgREST with every migration applied, PostgREST served under `/rest/v1`, is
   enough. The `FPT_API_*` dev key lines come from `.env.local`.
2. Name the sandbox and two Groups the vendors link to:
   `E2E_SANDBOX_PROJECT="<sandbox project name>" E2E_GROUP_A=<id> E2E_GROUP_B=<id>`. The sandbox name
   is sg-groundtruth's `FPT_PROBE_SANDBOX_PROJECT`. Never print it, a key, or the site's address.
3. Run `pnpm e2e:live`. It takes port 5182 or uses the app already there. `E2E_SCREENS=1` also shoots
   the main screens at 1280, 1440, 1920 (light and dark) and 2560 into `shots/one-page/`.
4. It cleans up what it made in Flow PT and in the database, also on a failure. Report the evidence
   lines it prints: they say what was read back from Flow PT and the database.

A PR that breaks the drive fixes it in the same PR. A failure is never retried away: find the cause.
