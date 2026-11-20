# sg-bids

VFX bidding for Flow Production Tracking. MIT.

1. Build a bid request from your Shots and Assets in Flow PT. The request keeps a frozen copy.
2. Invite vendors. Each gets a link, and may be tied to its Flow PT Group.
3. Vendors bid through the link, in their own currency. They need no Flow PT account.
4. Compare the bids shot by shot in one currency. Set the rates, build award scenarios, mark one
   as chosen.
5. Publish the award to Flow PT from your own session: a Bid per awarded vendor, a Bid Line per
   awarded Shot or Asset, and the vendor's Group on what it wins. A preview shows every write
   first. Undo takes back exactly what was written.

Requests and bids live in the app's own Supabase database. Vendors never see another vendor, or a
Flow PT id. The page `/how` in the app says what lands where, what vendors can see, and the site
setup an admin does once.

The hosted copy is a demo. A studio deploys its own: `docs/deploy.md`.

## Development

    pnpm install
    pnpm dev      # http://localhost:5181
    pnpm check
    pnpm test
    pnpm test:db  # needs Docker
    pnpm build

More in `docs/development.md`. The data model: `docs/data-model.md`.
