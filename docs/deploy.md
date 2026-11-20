# Deploy your own

The hosted copy is a demo. Bids hold shot lists and prices, so a studio runs its own copy.

1. Fork `ksallee/sg-bids` on GitHub.
2. Import the fork in Vercel. It builds from `main` only.
3. Set `PUBLIC_FPT_SITE_URL` in the Vercel project to your Flow PT site. It is the site the sign-in
   form offers. Nothing else is needed today.
4. Open the deployment and sign in as yourself.

Supabase: the requests and bids live in your own Supabase project. The schema is in
`supabase/migrations/`; `docs/development.md` describes it. The steps to wire it to your deployment
land with the first page that uses it.
