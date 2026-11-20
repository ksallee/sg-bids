# Deploy your own

The hosted copy is a demo. Bids hold shot lists and prices, so a studio runs its own copy.

1. Fork `ksallee/sg-bids` on GitHub.
2. Import the fork in Vercel. It builds from `main` only.
3. Set `PUBLIC_FPT_SITE_URL` in the Vercel project to your Flow PT site. It is the site the sign-in
   form offers. Nothing else is needed today.
4. Open the deployment and sign in as yourself.

Supabase comes later: vendors will answer through a link, and the requests and bids will live in
your own Supabase project. This page will say how to set it up then.
