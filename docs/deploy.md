# Deploy your own

The hosted copy is a demo. Bids hold shot lists and prices, so a studio runs its own copy: a fork
on GitHub, a Vercel project, a Supabase database, and the setup of its Flow PT site.

## 1. Fork

Fork `ksallee/sg-bids` on GitHub. Keep your fork private if you change anything you would not
publish.

## 2. Vercel project

In Vercel, add a new project and import the fork. Leave the framework as SvelteKit and the
commands as `vercel.json` sets them.

Vercel builds `main` only. `vercel.json` enables `main` in `git.deploymentEnabled` and skips every
other branch in `ignoreCommand`, so a feature branch never builds a preview. Merge to `main` to
deploy.

Vercel Hobby is for personal or non commercial use (Vercel's terms). A studio uses Pro.

## 3. Supabase through the Vercel marketplace

In the Vercel project, open Storage, pick Supabase, create a database and connect it to the
project for production, preview and development. The integration sets `SUPABASE_URL`, the keys,
and the Postgres URLs as environment variables. It also sets copies with a `NEXT_PUBLIC_` prefix.
SvelteKit reads neither those nor the publishable key.

The app reads two of them, on the server only:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`: the secret key, also called the service role key. If the integration
  set only `SUPABASE_SERVICE_ROLE_KEY`, add `SUPABASE_SECRET_KEY` with the same value.

The browser never talks to Supabase. Row level security is on for every table with no policy, so
the publishable and anon keys read and write nothing.

## 4. Apply the migrations

Apply every file in `supabase/migrations/`, in name order, oldest first. Each file is idempotent:
it applies to an empty database, and again on top of itself. Pick one way:

- the Supabase dashboard: SQL Editor, paste a file, Run, then the next file;
- `psql`, one file at a time, with the non pooling URL the integration set:

      for f in supabase/migrations/*.sql; do psql "$POSTGRES_URL_NON_POOLING" -v ON_ERROR_STOP=1 -f "$f"; done

- the Supabase CLI, linked to your project.

When a later release adds a migration, apply the new file the same way before or with the deploy
that needs it.

## 5. Environment variables

Set these in the Vercel project, Settings, Environment Variables. Values never go in the repo.

| var | what it does |
|---|---|
| `PUBLIC_FPT_SITE_URL` | your Flow PT site, for example `https://yourstudio.shotgrid.autodesk.com`. The sign in form offers it. |
| `PUBLIC_SITE_URL` | your deployment's address, for example `https://bids.yourstudio.com`. The public pages' canonical URLs, share image, sitemap and `llms.txt` use it. Read at build. Unset: the hosted demo's. |
| `FPT_SITE_HOSTS` | the Flow PT hosts the server may call, comma separated. Unset: the host of `PUBLIC_FPT_SITE_URL`. Neither set: no site at all. |
| `FPT_PRODUCTION_ROLES` | the permission group codes that may act as production, comma separated. Unset: `admin,manager`. Everyone else is refused. |
| `SUPABASE_URL` | the Supabase project. Server only. |
| `SUPABASE_SECRET_KEY` | its secret key. Server only. |

`FPT_SITE_HOSTS`: list your site's exact host. A suffix such as `*.shotgrid.autodesk.com` lets
any site under it sign in: one label, https, the default port. It is for a public demo only. Both
hosted domains (`shotgrid.autodesk.com`, `shotgunstudio.com`) resolve any name, so a suffix lets
anyone make the server call a host under them that no site serves. The server never follows a
redirect from Flow PT.

Never set the `FPT_API_*` lines on Vercel. They are for `vite dev` only. A production build answers
`/live/dev-token` 404 before it reads them.

Redeploy after a change to these.

## 6. Set up the Flow PT site

An admin does this once, in the Flow PT web interface. The app's page `/how` says it in full:

1. Enable two custom entities, displayed exactly `Bid` and `Bid Line`, with no Tasks and no
   Versions.
2. In the Vendor permission role, set See entities to Not allowed for Bid and Bid Line. While the
   Vendor role can read them, a vendor with a Flow PT login reads every bid in the project.
3. Check that the Vendor role sees a Shot and an Asset through the vendor groups field.
4. Open a request's publish page as an Admin and create the missing fields. The app creates them.

The publish page checks all of this before it writes anything, and says what is missing.

## 7. Sign in

Open the deployment and sign in as yourself. Production is a person in a permission group listed
in `FPT_PRODUCTION_ROLES`.

## Backups

The free Supabase tier has no automatic backups, and it pauses a project after a week without
use. A paused project answers nothing until you restore it from the dashboard. Take your own
dumps, for example once a day:

    pg_dump "$POSTGRES_URL_NON_POOLING" --format=custom --file=sg-bids-$(date +%F).dump

Or move to a paid Supabase plan. Read its terms for backups and pausing.

## Vendor links

A link is `/v/<token>`, so the token is in the path of the first request and in your host's
request logs (Vercel's included) for as long as they are kept. That is inherent to a link. The
first request does no lookup and renders nothing: it moves the token to a cookie and redirects at
once, so the token stays out of the address bar, the history and any referrer. Keep the logs
private, and give a vendor a new link (it replaces the old one) if a log leaks.
