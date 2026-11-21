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
| `PUBLIC_SITE_URL` | the deployment's own address, for the public pages' canonical URLs, share image, sitemap and `llms.txt`. Read at build. Unset: `https://sg-bids.vercel.app` |
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

Supabase (Postgres) holds production's bids, the requests and the vendors' answers. The schema is plain SQL in
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
`sg_choose_scenario`, `sg_record_award`, `sg_clear_award`, `sg_delete_request`. Production's rate per bid lives in
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

Breakdowns (`20261123100000_breakdown.sql`). A request item records where it came from in
`source`: `fpt` for a row picked from Flow PT, `breakdown` for one pasted, imported or typed, with no
Flow PT row. `sg_link_request_items` gives breakdown rows their Flow PT row, all or none, on a draft
or an issued request. On an issued request it is the one change the freeze trigger allows: a
breakdown row with no Flow PT row gets one, once, and nothing else on the row changes with it;
`fpt_linked_at` says when. Vendors never read `source` or the Flow PT row. At the award, the rows a
publish creates in Flow PT are in the publication record's `written.items`, so the undo deletes
exactly those.

Deleting (`20261124100000_delete.sql`). `sg_delete_request` deletes a request and every row under
it for the caller's tenant, in one transaction, and answers what went, counted. It locks the
request and refuses while an award is in Flow PT: an `award_publications` row, published, partial or
part undone, or an award row. The freezes are not loosened. The function sets a transaction local
setting, `sg.delete_request`, to the request's id, and each freeze trigger lets a DELETE of that
request's rows through, and nothing else: an update or an insert is refused as before, and so is a
row of another request. The server reaches the database only through PostgREST, which sets no
setting a client names, and each call is its own transaction. The hashes of the request's link
tokens, live and former, go to `withdrawn_links`, alone, so a dead link can say the request was
withdrawn. Deleting never writes to Flow PT.

Packages (`20261125100000_packages.sql`). `request_packages` holds a request's packages in order;
`request_items.package_key` names each row's package by a foreign key, and a request with packages
has every row in one. `invitations.package_keys` lists the packages a vendor is invited to, null for
every one, keys of the request's own packages only. `bids.packages` holds the figures of packages
priced as one figure and `bid_lines.in_package` marks the rows they cover; the packages a vendor
declines are in the bid's header. `sg_save_request_items` takes the packages with the items in one
write; the call without them clears a request's packages, so no request is half packaged. Packages
freeze with the request (`sg_request_packages_guard`). A vendor's packages change only while it has
no submitted or withdrawn bid (`sg_invitations_packages_guard`). A line for a row outside the
vendor's packages, or a figure for a package outside them, is refused (`sg_bid_lines_guard`,
`sg_bids_guard`). `sg_delete_request` deletes the packages with the rest. The migration is additive:
no existing row changes, and code from before it runs on it unchanged.

Bids first (`20261126100000_bids_first.sql`). `production_bids` holds production's bids per tenant,
with the counts the Bids list shows, and `production_bid_items` their rows, the columns of a request
item without the package. No freeze: a bid is always editable. `request_packages.bid_id` names the
bid a request's package comes from, by a composite foreign key in the tenant. A draft request holds
its bids by reference, one package each, keyed `bid:<id>`, and no rows of its own; the server reads
it as its bids are now (`request-bids.composeDraft`). `invitations.link_pending` marks a vendor added
to a draft: it has a placeholder hash and no token until the issue. Writes that land whole:
`sg_save_production_bid` (a bid and its rows), `sg_clone_production_bid` (`<name> copy`, made free),
`sg_move_bid_rows` (copy or move rows to another bid), `sg_delete_production_bid` (out of its drafts,
with each vendor's choice of it; refused while a vendor of a draft is invited to it alone; its id
cleared from the requests it went out in, which the packages guard allows and nothing else),
`sg_set_request_bids` (a draft's bids in order; a vendor is never left with none) and
`sg_issue_request` (each bid's rows copied under its package, named as the bid and made unique, a
row in two bids refused, the pending links set from the hashes the server made, the request issued,
all in one transaction; the server answers each token once). The migration turns every draft
request stored before it into its bids (`sg_bids_first_convert`, run by the migration, idempotent):
one bid per package with its rows, or one bid of every row for a draft from before packages, a row
in no package to an Other rows bid; the draft keeps its packages, now pointing at the bids, so each
vendor's choice stands, and its own rows move to the bids. An issued request is not touched. Code
from before it reads a converted draft as empty: apply the migration with the deploy of this code.

Never apply a migration to the hosted project from a branch. Migrations reach it from `main`
only, by hand, with the Supabase CLI or the SQL editor.

### Production endpoints

The browser reaches the data layer through `src/routes/api/production/<action>`. Bids: `bid-list`,
`bid-get`, `bid-save` (a name and rows), `bid-clone`, `bid-move-rows`, `bid-delete-check` (the drafts
it leaves, the requests that keep what was issued) and `bid-delete`, over
`src/lib/server/production-bids.ts`. Requests: `list`, `get` (a draft as its bids make it now, with
the rows in two of them), `save` (a draft's header, and its bids when given; no id makes one),
`request-bids` (a draft's bids in order), `issue` (answers the links of the vendors added to the
draft, once), `new-round` (a draft of the same bids), `invite` (`pending`: added to a draft, its
link made at the issue), `uninvite` (a vendor added to a draft goes), `invite-packages` (a vendor's
bids, refused once it has submitted an answer), `revoke`, `reissue`, `delete-check` (what deleting
the request would take with it, or the award that stops it) and `delete` (`{id, code}`, the
request's code as typed). Each is a POST whose body carries
`claim` (site, project, session token or, in `vite dev`, the dev key's bearer) and is verified with
`production.ts` before anything else. `src/lib/pure/wire.ts` checks the rest of the body and lets
through only the model's header and item fields.

The requests list reads across projects through `requests`, and the Bids list through `bids`. Its `claim` names the site and the
credential, no project. `verifyProductionSite` checks the person and the role as a project's check
does, then lists the projects the person's own bearer may read on that site (`GET
/entity/projects`, paged to the first empty page; a person reads only their projects, corpus 006,
027). The tenant filter is that site host and those project ids (`siteScope` in
`src/lib/pure/access.ts`); a project or a project list in the body is never read.
`src/lib/server/site-route.test.ts` and `tests/db/across.db.test.ts` hold it. The comparison has its own: `compare` (the
request, every submitted and withdrawn bid, the latest submitted version per vendor shown unless
`bids` names others, the rates, the scenarios), `rate`, `scenarios`, `scenario-save`,
`scenario-rename`, `scenario-delete`, `scenario-choose`, over `src/lib/server/comparison.ts` with
bodies checked by `src/lib/pure/compare-wire.ts`. The award has `award-record` and `award-undo`,
over `src/lib/server/awards.ts`, bodies checked by `src/lib/pure/award-wire.ts`. The publish page
is `/requests/[id]/publish`; what blocks it is `src/lib/pure/award-gate.ts`. Long reads page past PostgREST's 1000 row cap.
The page is `/requests/[id]/compare`. Bids and draft requests go through `src/lib/drafts.ts`, the
one storage seam. A link token is answered once, by `invite`, `reissue` or `issue`; the vendor pages
live under `/v/`.

## Pages

`/bids` lists the bids across the person's projects, ticks bids of one project and starts a request
from them; `/bids/new` and `/bids/[id]` are the bid editor. `/requests` lists the requests;
`/requests/new` is the send flow (`?project=&bids=` makes the draft, `?id=` opens it, `&step=` says
the step); `/requests/[id]`, `/requests/[id]/compare` and `/requests/[id]/publish` are a request's
pages. The addresses from before bids came first go to them: `/bids/[id]/compare` and
`/bids/[id]/publish` redirect, `/bids/new?id=` opens the send flow, and `/bids/[id]` naming a request
opens its page (`routes.movedRequestPath`).

## A bid's rows, live to Flow PT

A bid shows its Shots and Assets in the registry's EntityTable over a list source of the bid's own
rows (`src/lib/app/builder/request-table.svelte`). Which column a Flow PT field feeds,
where each cell's edit lands and why a cell is locked: `src/lib/pure/live-columns.ts`. The value a
field takes, the edit plan, the read back and the undo: `src/lib/pure/row-edit.ts`. The calls:
`src/lib/io/fpt-write.ts`.

- Opening a bid reads every picked row again, one batched read per kind paged at 5000 (082), and
  takes each live value. A row Flow PT does not answer for, deleted or out of reach, keeps its last
  values and is flagged. A breakdown row, linked or not, keeps what it was typed with.
- An edit to a live cell writes the field as the signed in person: `_batch` in chunks of 100,
  inside the 200 the response window holds; a refused batch wrote nothing, so its writes go one
  `PUT` at a time to name each refusal (recipe 002, 028). Then the rows are read back and each write
  is landed, refused, silent (a 200 that left another value) or gone. Only the value read back is
  shown. Reads and writes here go through the bare client (`liveWriter`): the context's client keeps
  reads, and a read back must see Flow PT as it is now.
- Selected rows change together: an edit in one applies to that column in every selected row, after
  a confirm that counts the Shots changed in Flow PT and the rows changed in the bid.
- Undo reads each field first and writes the old value only where Flow PT still holds the edit; a
  value changed since is left and named (024: there is no conditional write).
- A field the schema marks not editable for the person is locked, and so is one the preflight
  refused: a rolled back `_batch` of the update at its current value and a sentinel update of Task
  999999999, once per kind (094, recipe 017).
- A field just created from the mapping takes what the bid showed for its column before its first
  live read, so nothing typed is lost; it is empty, so nothing in Flow PT is overwritten.
- Description reads the stock `description` by default only when the site has no `sg_bid_description`.
  When it does, the mapping and the column header suggest a field of the bid's own.
- A bid is stored, and kept in the tab, once it has a name or a row.

The table's bulk edit, list source and per-cell lock are sg-widgets PR #382 (with #380's width
fix). Until sg-widgets-core ships them, `src/lib/components/core-next.ts` carries core's part.

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

When production deletes the request, its links die with it. A cookie or a link whose token hash is
in `withdrawn_links` gets 410 with `reason` `withdrawn`, or lands on `/v?link=withdrawn`: "This
request was withdrawn by the production.", and nothing of the request. Only the token itself finds
its hash, so a guess still gets 401.

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
| `POST /v/api/bid/discard` | `{invitationId, bidId}`: discard the open draft, back to empty or to the last submitted version |

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
- a request is deleted whole by `sg_delete_request`, in its own tenant only (another host, another
  project and a missing id answer the same 404), never while an award is in Flow PT; every table
  under it is empty after; the freezes still stop every direct delete and update; the public roles
  cannot call it; the endpoints take the tenant from the verified claim (`delete.db.test.ts`);
- a vendor whose request was deleted is told it was withdrawn and nothing more, and a vendor
  discards its draft back to empty or to the last submitted version (`vendor-endpoints.db.test.ts`,
  `vendor.db.test.ts`);
- packages save with the rows, freeze at issue and go with the request; a vendor invited to some
  packages reads their rows alone and cannot write a line or a figure outside them, through the
  store and in SQL; its packages change until it submits and are refused after; a figure covers its
  rows; a declined package takes no price and one package is bid on at least; a request from before
  packages works as one; a scenario giving part of a package priced as one figure is refused
  (`packages.db.test.ts`);
- a bid saves, clones, moves rows and is deleted in its tenant only; a draft request made from bids
  reads them as they are; the issue copies their rows, makes the pending links and a vendor reads its
  bids alone; a bid edited after the issue changes nothing issued and goes out again; a row in two
  bids refuses the issue; deleting a bid leaves its drafts and keeps what was issued; the drafts from
  before bids turn into their bids with every row as it was, and applied again nothing turns
  (`bids.db.test.ts`);
- the migrations apply again without a change (`migrations.db.test.ts`).

Arguments pass through to vitest: `pnpm test:db tests/db/freeze.db.test.ts`.

## The live drive

    E2E_SANDBOX_PROJECT="<project name>" E2E_GROUP_A=<id> E2E_GROUP_B=<id> pnpm e2e:live

`scripts/e2e-live.mjs` drives the whole product in headless Chromium against the real Flow PT site
of the dev key and the Supabase database in `.env.local`. Opt-in, never in CI. Point `.env.local` at
a throwaway database, not one a running app reads. It writes only to the one project named, by exact
name: it builds a bid from 4 of its Shots and one from a pasted breakdown, clones the first, makes a
request from the two for two vendors linked to the two Groups (B invited to the breakdown bid
alone), issues it, edits the first bid and checks the issued request did not change, answers as
each vendor in its own browser context (A declines a bid and prices the other row by row, B prices
its bid as one figure in GBP), sets the rate, chooses a scenario, publishes, reads Flow PT back (the
Bids, the Bid Lines, their sums), undoes from the request page and reads Flow PT back again, then
sends the breakdown bid again in a second request. Then it deletes what the drive made in Flow PT
and in the database, also on a failure part way. It takes port 5182, or uses the app already
there. Screenshots go to `shots/e2e-live/` (gitignored); it prints ids and counts, never a key or
the site's address.

## Security headers

`src/hooks.server.ts` sends on every answer: `X-Content-Type-Options: nosniff`,
`Referrer-Policy: same-origin` (`no-referrer` under `/v`, `same-origin` on `/v/open` so its form
posts carry an Origin), `X-Frame-Options: DENY`, and HSTS over https. Pages get a
Content-Security-Policy that SvelteKit writes from `src/lib/pure/security-headers.ts`
(`vite.config.ts`, `csp`), with a nonce on each inline script. The scheme script is a file,
`static/theme.js`, so `app.html` holds no inline script. The hook
adds the hosts of `FPT_SITE_HOSTS` to `connect-src` and `img-src` (in `vite dev` the script key's
site too), and the S3 media hosts to `img-src`. `style-src` keeps `'unsafe-inline'`: Svelte
transitions and the widgets' floating parts write inline styles. An answer that is not a page gets
`default-src 'none'; frame-ancestors 'none'`.

## Deploy

From `main` alone. `vercel.json` names SvelteKit as the framework, enables `main` under
`git.deploymentEnabled`, and skips every other ref in `ignoreCommand`, so a feature branch never
builds a preview. `src/lib/deploy.test.ts` holds it to that. The app is a client-rendered shell
(`ssr = false`) and the routes under `/live/` are serverless functions.

## Public pages

Home and `/how` live under `src/routes/(public)/`, rendered at build into static HTML with their
full text (`prerender`), for search engines, link previews and AI readers. Their words are data in
`src/lib/pure/public-content.ts`; their title, description, canonical URL and Open Graph tags come
from `src/lib/pure/seo.ts` (`PUBLIC_PAGES`), their JSON-LD from `src/lib/pure/structured-data.ts`.
`/robots.txt`, `/sitemap.xml`, `/llms.txt` and `/llms-full.txt` are prerendered from the same
modules, the last with the docs as they are in the repo, so none can drift from the pages. A test
renders each page and checks every word of its content is in it and in `llms-full.txt`.

A prerendered page carries its CSP as a meta tag with script hashes, since it cannot have a
per-request nonce. On Vercel it is a static file the hook never sees, so `vercel.json` sends its
headers: the ones the hook sends, and `frame-ancestors 'none'`, which a meta tag cannot carry
(`src/lib/deploy.test.ts` holds them equal). The meta policy has no Flow PT site, so every link on
a public page loads the next page whole, under that page's own policy (`+layout.svelte`). Every
other path answers `X-Robots-Tag: noindex, nofollow`.

The share image, `static/og.png`, is the page `/dev/og` (dev only): the real comparison grid on demo
data, in the default theme. `pnpm og` starts `vite dev` on 5188, shoots it, and writes the icons
from `static/favicon.svg` (`apple-touch-icon.png`, `favicon.ico`). Rerun it when the grid changes.

Set in the Vercel project, value never in the repo: `PUBLIC_FPT_SITE_URL`, `SUPABASE_URL`,
`SUPABASE_SECRET_KEY`, `FPT_SITE_HOSTS` when the site list differs from the default (the public
demo, open to any hosted site, sets `*.shotgrid.autodesk.com,*.shotgunstudio.com`; see
`docs/deploy.md`), and
`FPT_PRODUCTION_ROLES` when production is not `admin,manager`. Never set
the `FPT_API_*` lines on Vercel.

Deploying your own copy: `docs/deploy.md`.
