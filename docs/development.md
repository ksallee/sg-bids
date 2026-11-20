# Working on sg-bids

## Run it

    pnpm install
    pnpm dev

Open http://localhost:5181, name the site and sign in through the App Session Launcher.

    pnpm check
    pnpm test
    pnpm build
    pnpm test:db

`.github/workflows/gates.yml` runs the first three on every pull request and on pushes to `dev`
and `main`. `pnpm test` needs no Docker. `pnpm test:db` does: see Database below.

## Port

`pnpm dev` takes 5181, set in `vite.config.ts` with `strictPort`: Vite stops when the port is taken.
The siblings use 5173, 5191 up, 5199 and 5211 up. Anything that runs beside sg-bids (a second
worktree, an agent's headless drive) takes its own port from 5182 to 5189, one each:

    pnpm dev --port 5182

## Env

Copy `.env.example` to `.env.local` (gitignored). Every line is optional.

| var | what it does |
|---|---|
| `PUBLIC_FPT_SITE_URL` | the site the sign-in form offers by default |
| `FPT_API_SITE_URL` | dev only: the site the script key opens |
| `FPT_API_SCRIPT_NAME` | dev only: the script name |
| `FPT_API_API_KEY` | dev only: the script key |
| `SUPABASE_URL` | the Supabase project, server only |
| `SUPABASE_SECRET_KEY` | its secret (service role) key, server only |
| `FPT_SITE_HOSTS` | the Flow PT hosts the server may call, comma separated. Unset: the host of `PUBLIC_FPT_SITE_URL` |

With the three `FPT_API_*` lines set, `POST /live/dev-token` mints a 600 s bearer from the script
key under `vite dev` only, and the page reads without a sign-in. Signing in through the launcher
over it reads and writes as yourself. A production build answers `/live/dev-token` 404 before it
reads them.

## Sign-in

The browser calls the site's `/api/v1` itself. The App Session Launcher answers no CORS headers, so
its two calls go through this app's `/live/session-request` and `/live/session-poll`, which hold
nothing. The approved session token stays in the browser's `localStorage`. The corpus entries are
`052_app_session_launcher`, `062_cors` and `130_launcher_answers` in `../sg-groundtruth/corpus`.

## Database

Supabase (Postgres) holds the bid requests and the bids. The schema is plain SQL in
`supabase/migrations/`, one timestamped file per change, applied in name order. Each file is
idempotent: it applies to an empty database and again on top of itself.

The browser never talks to Supabase. Every read and write goes through `src/lib/server/store.ts`
with `SUPABASE_SECRET_KEY`. Row level security is on for every table with no policy, and `anon`
and `authenticated` hold no grant, so the publishable and anon keys read and write nothing.

Who may touch what:

- **Production** sends its Flow PT session (the session token, or a bearer minted from it), the
  site and the project. `src/lib/server/production.ts` calls only a host in `FPT_SITE_HOSTS`,
  mints a bearer, checks it is a person's, and reads the Project row with it: a 404 is a refusal.
  The tenant is that site host plus that project id. Every row carries it, and every query
  filters on it (`src/lib/pure/access.ts`). A child row's tenant is held to its parent's by a
  composite foreign key.
- **A vendor** has a link token: 32 random bytes, base64url, shown once. Only its SHA-256 hash is
  stored, on the invitation, with an expiry and a revoked stamp. The token reaches its own
  invitation, the request once issued, and its own bids. A vendor's draft stays private until it
  submits.

Frozen in the database, by triggers: an issued request's items, code, round, currency and header
(a change is a new round), and a submitted bid with its lines (a change is a new version; it may
only be withdrawn). Writes that must land whole are SQL functions: `sg_save_request_items`,
`sg_save_bid_draft`, `sg_save_scenario`.

Never apply a migration to the hosted project from a branch. Migrations reach it from `main`
only, by hand, with the Supabase CLI or the SQL editor.

### Database tests

    pnpm test:db

`scripts/test-db.mjs` starts two throwaway containers, `sg-bids-test` (`postgres:17`) and
`sg-bids-test-rest` (`postgrest/postgrest:v12.2.12`), on free ports on 127.0.0.1, on the network
`sg-bids-test-net`. It creates the roles a Supabase project has (`tests/db/supabase-roles.sql`),
runs `vitest.db.config.ts`, and removes all three, pass or fail. It touches no other container.

`tests/db/setup.ts` applies every migration twice to the fresh database. The tests prove:

- `anon` and `authenticated` read, write and call nothing, through PostgREST and in SQL, and row
  level security alone stops them even with the grants given back (`rls.db.test.ts`);
- a tenant reaches none of another tenant's rows through any store function, and vendor A's token
  reaches none of vendor B's invitation or bids; expired, revoked, malformed and unknown tokens are
  refused; only token hashes are stored (`access.db.test.ts`);
- a submitted bid and an issued request's items cannot be updated or deleted (`freeze.db.test.ts`);
- the migrations apply again without a change (`migrations.db.test.ts`).

Arguments pass through to vitest: `pnpm test:db tests/db/freeze.db.test.ts`.

## Deploy

From `main` alone. `vercel.json` names SvelteKit as the framework, enables `main` under
`git.deploymentEnabled`, and skips every other ref in `ignoreCommand`, so a feature branch never
builds a preview. `src/lib/deploy.test.ts` holds it to that. The page is a client-rendered shell
(`ssr = false`) and the routes under `/live/` are serverless functions.

Set in the Vercel project, value never in the repo: `PUBLIC_FPT_SITE_URL`, `SUPABASE_URL`,
`SUPABASE_SECRET_KEY`, and `FPT_SITE_HOSTS` when the site list differs from the default. Never set
the `FPT_API_*` lines on Vercel.

Deploying your own copy: `docs/deploy.md`.
