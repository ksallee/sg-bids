# Deploy your own

The hosted copy is a demo. Bids hold shot lists and prices, so a studio runs its own copy.

1. Fork `ksallee/sg-bids` on GitHub.
2. Import the fork in Vercel. It builds from `main` only.
3. Set `PUBLIC_FPT_SITE_URL` in the Vercel project to your Flow PT site. It is the site the sign-in
   form offers. Production is a person in the Admin or Manager permission group. When yours has
   other codes, list them in `FPT_PRODUCTION_ROLES`, comma separated. Everyone else is refused.
4. The server calls only the Flow PT hosts in `FPT_SITE_HOSTS`, comma separated. Unset, it is the
   host of `PUBLIC_FPT_SITE_URL`; neither set, no site at all. List your site's exact host. A suffix
   such as `*.shotgrid.autodesk.com` lets any site under it sign in: one label, https, the default
   port. It is for a public demo only. Both hosted domains (`shotgrid.autodesk.com`,
   `shotgunstudio.com`) resolve any name, so a suffix lets anyone make the server call a host under
   them that no site serves. The server never follows a redirect from Flow PT.
5. Open the deployment and sign in as yourself.

Supabase: the requests and bids live in your own Supabase project. The schema is in
`supabase/migrations/`; `docs/development.md` describes it. The steps to wire it to your deployment
land with the first page that uses it.
