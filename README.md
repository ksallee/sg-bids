# sg-bids

sg-bids is a free, open source web app that runs VFX bid rounds for Flow Production Tracking
(formerly ShotGrid). Production makes a request on one page: its bids from its Shots and Assets,
or from a breakdown before they exist in Flow PT, its vendors and its details. Vendors answer
through a link with no Flow PT account, production compares the answers in one currency, and the
award is written back to Flow PT. MIT. Demo: https://sg-bids.vercel.app

1. New request: a name and a project. On its one page, add Shots and Assets from Flow PT, or paste
   a breakdown when they are not in Flow PT yet, into one or several bids. Rows show their live
   values, and editing a column fed by Flow PT changes Flow PT, one row or many at once, with Undo.
2. Type the vendors in, each with its Flow PT Group and the bids it answers, and set the details
   (due day, currency, turnover, delivery, material). Issue: what is missing is listed, each line
   taking you to its field. Each vendor's link shows once, with Copy and Email. Duplicate a request
   to start the next one.
3. Vendors answer through the link, in their own currency, bid by bid: row by row (filled from
   their rate card, any row overridden), one figure, or not at all. They need no Flow PT account.
4. Compare the answers shot by shot in one currency. Set the rates, build award scenarios, mark
   one as chosen.
5. Publish the award to Flow PT from your own session: a Bid per bid each awarded vendor answered,
   a Bid Line per awarded Shot or Asset, and the vendor's Group on what it wins. Rows from a
   breakdown can be created as Shots and Assets first. A preview shows every write first. Undo
   takes back exactly what was written.

Requests and answers live in the app's own Supabase database. Vendors never see another
vendor, or a Flow PT id. The page `/how` in the app says what lands where, what vendors can see,
and the site setup an admin does once.

The hosted copy is a demo. A studio deploys its own: `docs/deploy.md`.

## Development

    pnpm install
    pnpm dev      # http://localhost:5181
    pnpm check
    pnpm test
    pnpm test:db  # needs Docker
    pnpm build

More in `docs/development.md`. The data model: `docs/data-model.md`.
