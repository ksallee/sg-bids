# Working on sg-bids

## Run it

    pnpm install
    pnpm dev

Open http://localhost:5181, name the site and sign in through the App Session Launcher.

    pnpm check
    pnpm test
    pnpm build

`.github/workflows/gates.yml` runs those three on every pull request and on pushes to `dev` and
`main`.

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

With the three `FPT_API_*` lines set, `POST /live/dev-token` mints a 600 s bearer from the script
key under `vite dev` only, and the page reads without a sign-in. Signing in through the launcher
over it reads and writes as yourself. A production build answers `/live/dev-token` 404 before it
reads them.

## Sign-in

The browser calls the site's `/api/v1` itself. The App Session Launcher answers no CORS headers, so
its two calls go through this app's `/live/session-request` and `/live/session-poll`, which hold
nothing. The approved session token stays in the browser's `localStorage`. The corpus entries are
`052_app_session_launcher`, `062_cors` and `130_launcher_answers` in `../sg-groundtruth/corpus`.

## Deploy

From `main` alone. `vercel.json` names SvelteKit as the framework, enables `main` under
`git.deploymentEnabled`, and skips every other ref in `ignoreCommand`, so a feature branch never
builds a preview. `src/lib/deploy.test.ts` holds it to that. The page is a client-rendered shell
(`ssr = false`) and the routes under `/live/` are serverless functions.

Set in the Vercel project, value never in the repo: `PUBLIC_FPT_SITE_URL`. Never set the
`FPT_API_*` lines on Vercel.

Deploying your own copy: `docs/deploy.md`.
