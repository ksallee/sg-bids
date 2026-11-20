# sg-bids

VFX bidding for Flow Production Tracking. A production sends a bid request to several vendors,
vendors answer through a link with no FPT account, production compares the bids shot by shot and
awards, and the result lands in Flow PT.

Early. Today it signs in to Flow PT as you and shows who is signed in. MIT.

## Development

    pnpm install
    pnpm dev      # http://localhost:5181
    pnpm check
    pnpm test
    pnpm build

More in `docs/development.md`. To run your own copy: `docs/deploy.md`.
