# Working on sg-bids

## Run it

    pnpm install
    pnpm dev

Open http://localhost:5181, name the site and sign in through the App Session Launcher.

    pnpm check
    pnpm test
    pnpm build
    pnpm test:db

`.github/workflows/gates.yml` runs all four on every pull request and on pushes to `dev` and
`main`, the database tests in a job of their own. `pnpm test` needs no Docker. `pnpm test:db`
does: see Database below.

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
| `FPT_PRODUCTION_ROLES` | the permission group codes that may act as production, comma separated. Unset: `admin,manager` |

With the three `FPT_API_*` lines set, `POST /live/dev-token` mints a 600 s bearer from the script
key under `vite dev` only, and the page reads without a sign-in. Signing in through the launcher
over it reads and writes as yourself. A production build answers `/live/dev-token` 404 before it
reads them.

## Sign-in

The browser calls the site's `/api/v1` itself. The App Session Launcher answers no CORS headers, so
its two calls go through this app's `/live/session-request` and `/live/session-poll`, which hold
nothing. They take no sign-in, so they call only a host on `FPT_SITE_HOSTS` (the list the
production check uses, `docs/deploy.md`) and follow no redirect; any other site is 403 and nothing
is called. The approved session token stays in the browser's `localStorage`. The corpus entries are
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
  Seeing the project is not enough, since a Vendor person sees a project they are assigned to. The
  person's permission group code must be in `FPT_PRODUCTION_ROLES`. It is read with their own
  bearer: `GET /schema/permission_groups` lists only their own group unless they are an Admin,
  and their HumanUser row names their group, which picks it out of an Admin's list. When the two
  answers do not settle the group, the person is refused. The dev key skips this check.
  The tenant is that site host plus that project id. Every row carries it, and every query
  filters on it (`src/lib/pure/access.ts`). A child row's tenant is held to its parent's by a
  composite foreign key.
- **A vendor** has a link token: 32 random bytes, base64url, shown once. Only its SHA-256 hash is
  stored, on the invitation, with an expiry and a revoked stamp. The token reaches its own
  invitation, the request once issued, and its own bids. A vendor's draft stays private until it
  submits. The vendor gives no exchange rate: the store drops one and checks the amounts in the
  bid's own currency. Production locks a rate.

Frozen in the database, by triggers: an issued request's items, code, round, currency and header
(a change is a new round), and a submitted bid with its lines (a change is a new version; it may
only be withdrawn). Writes that must land whole are SQL functions: `sg_save_request_items`,
`sg_save_bid_draft`, `sg_save_scenario`, `sg_save_award_scenario`, `sg_set_bid_rate`,
`sg_choose_scenario`, `sg_record_award`, `sg_clear_award`. Production's rate per bid lives in
`bid_rates`; a trigger refuses it on a draft or a base currency bid and locks it once the request
has an award or is closed.

The award (`20261122100000_award.sql`). The browser writes the chosen scenario to Flow PT from
production's own session and reads it back (`src/lib/io/fpt-award.ts`). Then `sg_record_award`
writes, in one transaction: the `awards` rows (built on the server from the stored chosen scenario,
never from the body, with the Flow PT Bid and Bid Line ids), the `award_publications` row (what
was written to Flow PT, merged over every run, enough to undo it, who published, and the choice to
publish while the Vendor role could read Bid or Bid Line), and the request goes from issued to
awarded. An award row locks the rates. A run that stopped part way is recorded as `partial` and
changes no award row. Published again, the rows are replaced. `sg_clear_award` runs after the undo:
nothing left in Flow PT, the rows go, the request is issued again and the rates unlock; something
left, the record keeps it as `undo_partial`. A trigger allows awarded only with award rows, and
issued again only without them. A vendor is told bidding is closed once the request is awarded.

Never apply a migration to the hosted project from a branch. Migrations reach it from `main`
only, by hand, with the Supabase CLI or the SQL editor.

### Production endpoints

The browser reaches the data layer through `src/routes/api/production/<action>`: `list`, `get`,
`save`, `issue`, `new-round`, `invite`, `revoke`, `reissue`. Each is a POST whose body carries
`claim` (site, project, session token or, in `vite dev`, the dev key's bearer) and is verified with
`production.ts` before anything else. `src/lib/pure/wire.ts` checks the rest of the body and lets
through only the model's header and item fields. The comparison has its own: `compare` (the
request, every submitted and withdrawn bid, the latest submitted version per vendor shown unless
`bids` names others, the rates, the scenarios), `rate`, `scenarios`, `scenario-save`,
`scenario-rename`, `scenario-delete`, `scenario-choose`, over `src/lib/server/comparison.ts` with
bodies checked by `src/lib/pure/compare-wire.ts`. The award has `award-record` and `award-undo`,
over `src/lib/server/awards.ts`, bodies checked by `src/lib/pure/award-wire.ts`. The publish page
is `/bids/[id]/publish`; what blocks it is `src/lib/pure/award-gate.ts`. Long reads page past PostgREST's 1000 row cap.
The page is `/bids/[id]/compare`. The builder's drafts go through
`src/lib/drafts.ts`, the one storage seam. A link token is answered once, by `invite` or
`reissue`; the vendor pages live under `/v/`.

## The vendor link

A vendor opens `/v/<token>`, the link `vendorLink` writes. That route does no lookup: it moves
the token to a ten minute cookie, `sg_bids_vendor_open`, and redirects to `/v/open`. `/v/open`
finds the token's invitation and puts `<invitation id>.<token>` in the vendor cookie,
`sg_bids_vendor`: HttpOnly, Secure (SvelteKit drops Secure on http://localhost only), SameSite=Lax,
path `/v`. Then it redirects to `/v`, so the token does not stay in the address bar, the history or
a referrer. A link no invitation holds clears the cookie and lands on `/v?link=invalid`.

When the browser already holds another vendor's live link, `/v/open` does not replace it. It asks:
"This link is for B. You have A's bid open.", and only a post from this site's own page switches
(the Origin is checked, as SvelteKit does). So a link one vendor sends another cannot take over the
bid on screen. The form names the vendor at the top at all times, so a switch is plain to see.

When production gives a vendor a new link, the old token stops working and the vendor keeps its
bids. A trigger keeps the hashes of an invitation's last ten tokens
(`20261121120000_replaced_tokens.sql`). A vendor still holding an old cookie gets 410 and a page
saying the link was replaced; the new link opens its draft or submitted bid as it was. Any other
cookie that fails gets 401, whatever invitation id it names, so the answer never tells an outsider
whether an invitation exists.

The page at `/v` calls these, each authorised by the cookie (`src/lib/server/vendor-api.ts`). Every
write also names the invitation and the bid the page loaded, `{invitationId, bidId}`. When the
cookie now holds another invitation, or the bid moved on in another tab, the write is refused with
409 and `reason` `session` or `bid`, and nothing is written:

| call | what |
|---|---|
| `GET /v/api/request` | the request as frozen, the vendor's own name and invitation id, no vendors list, no Flow PT ids |
| `GET /v/api/bid` | the vendor's latest bid, draft or submitted, and its versions |
| `PUT /v/api/bid` | `{invitationId, bidId, draft}`: save the draft; `bidId` null before the first save |
| `POST /v/api/bid/submit` | `{invitationId, bidId}`: submit the draft |
| `POST /v/api/bid/withdraw` | `{invitationId, bidId}`: withdraw the submitted bid |
| `POST /v/api/bid/revise` | `{invitationId, bidId}`: open the next version as a copy of the latest |

Every answer under `/v` says `Referrer-Policy: no-referrer`, `Cache-Control: no-store` and
`X-Robots-Tag: noindex, nofollow` (`src/hooks.server.ts`). No answer carries another vendor:
`src/lib/pure/vendor-view.ts` shapes each one, and `tests/db/vendor-endpoints.db.test.ts` walks
every endpoint as one vendor of two and finds nothing of the other.

A stored item key holds the Flow PT id (`shot-<id>`, `src/lib/pure/freeze.ts`), so a vendor never
sees it. Each shot and asset goes out by its row id, and each line a vendor sends is read back to
the stored key (`src/lib/pure/vendor-keys.ts`). Bids, scenarios and awards keep the stored keys
and the Flow PT refs stay server side, for production and the award. The test seeds distinctive
Flow PT ids and finds none in any vendor answer.

Only failed lookups count, per client address and per token: twenty in ten minutes, then 429 for
the rest of the window, before any database call (`src/lib/pure/rate-limit.ts`). A token that
worked on the instance passes even when its address is held back, so one bad client behind a
shared address does not lock out the vendors beside it. The count lives in one server instance. On
Vercel each instance keeps its own, so it slows a guesser and caps one instance's database calls;
it is not a global limit. The token's 32 random bytes are the real guard.

### A dev request to bid on

    pnpm seed:dev
    pnpm seed:dev --clean

`scripts/seed-dev.mjs` writes one issued request, 40 shots and 6 assets, and two invitations,
through `src/lib/server/store.ts`, to the Supabase project in `.env.local`, and prints the two
vendor links. Its tenant is `dev-seed.sg-bids.local`, project 1, a host no Flow PT site has. A
run removes the last seed first. `--clean` only removes. Frozen rows cannot be deleted through the
data layer, so removal uses `POSTGRES_URL_NON_POOLING` with triggers off for one transaction, and
deletes rows of the dev tenant only. `--port 5182` writes links for another dev port, `--shots 400`
seeds a bigger request.

### Database tests

    pnpm test:db

`scripts/test-db.mjs` starts two throwaway containers, `sg-bids-test-<run>` (`postgres:17`) and
`sg-bids-test-<run>-rest` (`postgrest/postgrest:v12.2.12`), on free ports on 127.0.0.1, on the
network `sg-bids-test-<run>-net`. `<run>` is `SG_BIDS_TEST_RUN` when set, else random, so two runs
on one machine never meet. It creates the roles a Supabase project has (`tests/db/supabase-roles.sql`),
runs `vitest.db.config.ts`, and removes all three, pass or fail. It touches no other container.

`tests/db/setup.ts` applies every migration twice to the fresh database. The tests prove:

- `anon` and `authenticated` read, write and call nothing, through PostgREST and in SQL, and row
  level security alone stops them even with the grants given back (`rls.db.test.ts`);
- every table in `public` has row level security and nothing in `public` is granted to `anon` or
  `authenticated`, read from the catalog, so a table a later migration adds without it fails; a
  table or function created later gets no grant to them by default
  (`20261121110000_default_privileges.sql`, `rls.db.test.ts`);
- a tenant reaches none of another tenant's rows through any store function, and vendor A's token
  reaches none of vendor B's invitation or bids; expired, revoked, malformed and unknown tokens are
  refused; only token hashes are stored (`access.db.test.ts`);
- a submitted bid and an issued request's items cannot be updated or deleted (`freeze.db.test.ts`);
- a vendor bids in its own currency with no rate, withdraws, and lists its own versions
  (`vendor.db.test.ts`);
- every vendor endpoint answers one vendor nothing of the other, refuses a missing or bad link,
  and holds back a guesser (`vendor-endpoints.db.test.ts`);
- production reads submitted bids only, the latest version by default; its rate applies until the
  award and is locked by the database after; scenarios save, rename, delete and one is chosen; a
  tenant reaches none of another's (`comparison.db.test.ts`);
- a vendor link opened where another vendor's bid is open asks first, switches only on a
  same-origin post, and a tab left on the other bid writes nothing (`vendor-session.db.test.ts`);
- the award records its rows from the stored chosen scenario, marks the request awarded and locks
  the rates; published again it replaces the rows; a partial run changes no row; the undo clears
  it or keeps what is left; a vendor is told bidding is closed (`award.db.test.ts`);
- the migrations apply again without a change (`migrations.db.test.ts`).

Arguments pass through to vitest: `pnpm test:db tests/db/freeze.db.test.ts`.

## The live drive

    E2E_SANDBOX_PROJECT="<project name>" E2E_GROUP_A=<id> E2E_GROUP_B=<id> pnpm e2e:live

`scripts/e2e-live.mjs` drives the whole product in headless Chromium against the real Flow PT site
of the dev key and the Supabase database in `.env.local`. Opt-in, never in CI. It writes only to
the one project named, by exact name: it builds a request from 12 of its Shots and 2 Assets (making
`zzsgbids_*` fixtures when it has fewer), issues it, invites two vendors linked to the two Groups,
bids as each in its own browser context (one in GBP), sets the rate, builds a scenario with one
split row, publishes, reads Flow PT back, undoes from the request page, and reads Flow PT back
again. Then it deletes the fixtures and the request's rows, also on a failure part way. It takes
port 5182, or uses the app already there. Screenshots go to `shots/e2e-live/` (gitignored); it
prints ids and counts, never a key or the site's address. The award migration must be in that
database. `E2E_STOP_AFTER=build|invite|bids|scenario` stops early, then cleans up.

## Security headers

`src/hooks.server.ts` sends on every answer: `X-Content-Type-Options: nosniff`,
`Referrer-Policy: same-origin` (`no-referrer` under `/v`, `same-origin` on `/v/open` so its form
posts carry an Origin), `X-Frame-Options: DENY`, and HSTS over https. Pages get a
Content-Security-Policy that SvelteKit writes from `src/lib/pure/security-headers.ts`
(`vite.config.ts`, `csp`), with a nonce on each inline script, `app.html`'s included. The hook
adds the hosts of `FPT_SITE_HOSTS` to `connect-src` and `img-src` (in `vite dev` the script key's
site too), and the S3 media hosts to `img-src`. `style-src` keeps `'unsafe-inline'`: Svelte
transitions and the widgets' floating parts write inline styles. An answer that is not a page gets
`default-src 'none'; frame-ancestors 'none'`.

## Deploy

From `main` alone. `vercel.json` names SvelteKit as the framework, enables `main` under
`git.deploymentEnabled`, and skips every other ref in `ignoreCommand`, so a feature branch never
builds a preview. `src/lib/deploy.test.ts` holds it to that. The page is a client-rendered shell
(`ssr = false`) and the routes under `/live/` are serverless functions.

Set in the Vercel project, value never in the repo: `PUBLIC_FPT_SITE_URL`, `SUPABASE_URL`,
`SUPABASE_SECRET_KEY`, `FPT_SITE_HOSTS` when the site list differs from the default (the public
demo, open to any hosted site, sets `*.shotgrid.autodesk.com,*.shotgunstudio.com`; see
`docs/deploy.md`), and
`FPT_PRODUCTION_ROLES` when production is not `admin,manager`. Never set
the `FPT_API_*` lines on Vercel.

Deploying your own copy: `docs/deploy.md`.
