# sg-bids

VFX bidding for Flow Production Tracking. Production signs in to FPT as a person, makes a request
on one page (its bids of Shots and Assets, its vendors, its details), vendors answer through a
hosted link with no FPT account, production compares and awards, and the award is written to FPT.

The plan lives in a local `BRIEF.md`: the research, the decisions, what is still open. It is
gitignored and never committed. Nothing from it that names a site goes in the repo.

## Rules

- Pure functions in their own modules, no I/O in them: money, and later the bid request, the bid,
  the comparison and the award. Components only when needed. Pages and views as thin as possible,
  with as little logic as possible.
- Unit tests for every pure module, written first (TDD), fixtures shaped like the corpus
  responses. Integration or E2E tests where a flow needs them.
- API behaviour comes from `~/dev/sg-groundtruth/corpus` (read `INDEX.md` first). Never guess. A
  gap is a probe in sg-groundtruth first: one issue, a PR to `dev`.
- Live only, no mock. `src/lib/live.ts` and the `src/routes/live/` endpoints are
  sg-task-templates' App Session Launcher sign-in, adapted.
- Writes to FPT happen from production's own session, never from a vendor's.
- Money is whole minor units with an ISO 4217 code (`src/lib/pure/money.ts`). No floating point on
  an amount. A conversion uses a locked rate with its date.
- Widgets are registry copies from `../sg-widgets`, only those the app uses. What the client lacks
  grows there, issue and PR there, never a private extension here.
- Default theme only (`src/app.css`, sg-widgets' default). Light and dark switch in the navbar,
  following the system preference at first.
- Supabase holds requests, their bids and the answers. Only server code touches it, with the secret key; row level
  security is on with no policy. Every query carries the filter `src/lib/pure/access.ts` gives
  the verified principal: production's site host and project id, or a vendor's invitation.
  Freezes live in the database too. `docs/development.md` says how.
- No LLM in the app. Deterministic.
- Never commit `BRIEF.md`, `.env*` files other than `.env.example`, tokens, or a site URL.

## Copy

Kevin's voice, in the app and in the docs: short sentences, plain words, terse. No dashes, no
metaphors, no "not X, Y", no filler.

## Layout

- Pure modules in `src/lib/pure/`, each with its test beside it as `<module>.test.ts`.
- `src/lib/app/`: the app's own components (shell, page header and body on one measure rule in
  `measure.ts`, page state, the shared form label with its required mark, the site setup notice),
  a draft request's one page under `builder/` (the page, the bids bar, the one table grouped by bid,
  the add dialogs, the details and vendors panels, the Issue bar, the fields setting) with its page
  state in `builder.svelte.ts`, an issued request's page, its vendor links, the new request,
  duplicate and delete dialogs under `request/`, the comparison's grid, scenario rail and page state
  under `compare/`, the vendor form's pieces (the rate card among them) under `vendor/`. A draft's
  bids and rows are `pure/request-draft.ts`, its vendor rows `pure/vendor-rows.ts`, what blocks the
  issue `pure/readiness.ts`, the vendor's rates `pure/rate-card.ts`, creating a vendor's Group from its row `pure/group-create.ts`
  with its calls in `io/fpt-group.ts`.
- `src/lib/io/`: reads from Flow PT, thin, paging and request shapes only.
- `src/lib/drafts.ts`: the one place a draft request is stored. Storage plugs in there.
- `src/lib/components/`: registry copies from sg-widgets and shadcn-svelte.
- `docs/data-model.md`: the request and its bids, the vendor's answer and rate card, award and
  change order, field by field.
- `src/lib/server/`: the data layer and the production check. Server only.
- `supabase/migrations/`: the schema, timestamped plain SQL, idempotent.
- `tests/db/`: database tests, run by `pnpm test:db` against a throwaway Postgres in Docker.
- `docs/development.md`: running the app, the port, the env, the database, the deploy.
- `docs/deploy.md`: deploying your own copy.

## Process

- Issue: one paragraph, edited in place when scope changes. No issue comments.
- Branch from `dev` (`feat/<issue>-slug` or `fix/slug`). PR onto `dev`, squash-merged.
- `main` is promoted by a PR from `dev`, merge commit, after Kevin QAs `dev`.
- Merging to `dev` or `main` needs Kevin's say in the session.

## Commands

    pnpm install / pnpm dev / pnpm check / pnpm test / pnpm build / pnpm test:db / pnpm seed:dev / pnpm e2e:live

The live drive (`scripts/e2e-live.mjs`, `.claude/skills/verify`) runs once per feature PR, at the
end, and the report says what it read back.
