# Data model

There is no standard for a VFX bid. The model follows what the existing bid tools carry. The types
are in `src/lib/pure/model.ts`. The sums are in `totals.ts`, `rebate.ts` and `compare.ts` beside it.

## Sources

Seven tools were read: the OpenBID client and vendor sheets, the NIM docs, and the repos
`russelling/vfx_bidding_assist`, `vrivas777/bidreel` (BidReel), `richardcoley/VFX-Bid`,
`mvierendeel/BidCraft` and `coreybnyc/vfxBidder`. Ideas only. No code was taken.

The "Seen in" column says:

- **2+**: in two or more of the seven. The notes taken did not record which.
- **A tool's name**: in that tool only.
- **sg-bids**: in none of them. The app adds it.

## Rules

- Money is whole minor units with an ISO 4217 code. Never a float.
- A percent is a decimal string as typed: `39`, `12.5`.
- A day is `YYYY-MM-DD`.
- Ids are opaque strings.
- A shot, an asset, a project or a vendor may carry its Flow PT entity: `{ type, id }`.
- A shot or an asset from a breakdown has no Flow PT entity until it is matched, or created at
  the award. Its `source` says so. A vendor sees neither.
- Each vendor bids in its own currency. Production compares in the request's base currency.
- A draft's shots and assets picked from Flow PT are live. Each value a mapped field feeds is read
  from Flow PT when the draft opens and after every write, and an edit to it writes the field. The
  stored draft holds the values last read, so a reload is safe. The note to vendors, omit, a
  concept with no mapped field, and every value of a breakdown row are the request's own. Issuing
  freezes the items as they are; from then on Flow PT edits do not reach them.

## Bid request

What production sends: its rows in packages, to the vendors it invites.

### Header

| field | what | seen in |
|---|---|---|
| code | production's reference for the request | sg-bids |
| title | the request's title | sg-bids |
| project | the show | 2+ |
| projectRef | the Flow PT Project | sg-bids |
| studio | the studio | 2+ |
| director | the director | 2+ |
| clientSupervisor | client VFX supervisor | 2+ |
| clientProducer | client VFX producer | 2+ |
| cutVersion | script or cut version | 2+ |
| round | bid round, 1 first | 2+ |
| dueDate | when bids are due | 2+ |
| baseCurrency | the currency of the comparison | 2+ |
| turnoverWeek | turnover week | 2+ |
| turnoverDate | turnover date | sg-bids |
| deliveryDate | delivery date | 2+ |
| deliveryFormat | delivery format | 2+ |
| materialLink | link to the bid material | 2+ |
| assumptions | global assumptions | 2+ |

### Shot

| field | what | seen in |
|---|---|---|
| id | | sg-bids |
| code | shot code | 2+ |
| fpt | the Flow PT Shot. Absent for a breakdown row until matched | sg-bids |
| source | absent when picked from Flow PT; `breakdown` when pasted, imported or typed | sg-bids |
| description | what happens | 2+ |
| episode, sequence, scene, page | where it sits | 2+ |
| type, difficulty | kind of work and how hard | 2+ |
| cutCount | cut count | 2+ |
| frames | frame count | 2+ |
| omitted | the shot is out | 2+ |
| assetIds | linked assets | 2+ |
| thumbnail | thumbnail | 2+ |
| directorNotes | director's notes | 2+ |
| notes | production's note to the vendors | sg-bids |
| techRequirements | tech requirements per department | OpenBID |

### Asset

| field | what | seen in |
|---|---|---|
| id | | sg-bids |
| name | asset name | 2+ |
| fpt | the Flow PT Asset. Absent for a breakdown row until matched | sg-bids |
| source | absent when picked from Flow PT; `breakdown` when pasted, imported or typed | sg-bids |
| description | what it is | 2+ |
| type, difficulty | kind of asset and how hard | 2+ |
| timesUsed | how many shots use it | 2+ |
| omitted | the asset is out | sg-bids |
| notes | production's note to the vendors | sg-bids |

### Rows from a breakdown

Early rounds bid from a script or previs breakdown, before the Shots exist in Flow PT. Such a row
is a shot or asset like any other, with `source: breakdown` and no `fpt`. In storage, the item's
`source` column says where it came from, and `fpt_type`, `fpt_id` hold the Flow PT row once it has
one.

- Matched: production finds the Flow PT Shot or Asset with the same code, exact then in another
  case, never a near code. On a draft it is an ordinary edit. On an issued request it is the one
  change the freeze allows (`sg_link_request_items`): the row gets its Flow PT row once, nothing
  else changes, and `fpt_linked_at` says when. A vendor sees no change.
- Created at the award: production chooses, per kind, to create the missing Shots and Assets from
  the awarded rows, or to publish their Bid Lines with no item. What a publish creates is in the
  award record (`written.items`), and Undo award deletes exactly that, unless a created row has
  since gained links.

### Packages

Named groups of a request's rows. Every row sits in exactly one. The rules are in
`src/lib/pure/packages.ts`.

| field | what | seen in |
|---|---|---|
| packages | the request's packages, in order: `id` and `name` | sg-bids |
| shot or asset, package | the package the row sits in | sg-bids |

- Defaults come from sequences: a shot goes to its sequence's package (`seq:<sequence>`), a shot
  with none to Other shots (`shots`), an asset to Assets (`assets`). A package production adds is
  `pkg:<random>`. Names are unique in the request, in any case, 120 characters at most.
- Production renames, adds, duplicates (a copy named `<name> copy`, with no rows) and deletes
  packages, and moves rows with the Package column of the builder's table, one row or in bulk.
  Deleting a package sends each of its rows back to its sequence's package when there is one, else
  to Other shots or Assets, made when missing. A row with nowhere to go keeps the package.
- Packages freeze with the request at issue, as its rows do.
- A request stored before packages has none. It reads as one package, All shots and assets (`all`),
  holding every row. Nothing is backfilled. A draft from before packages takes its defaults when the
  builder opens it.
- In storage, `request_packages` holds a request's packages and `request_items.package_key` each
  row's package, held by a foreign key. A request with packages has every row in one.

### Invited vendor

| field | what | seen in |
|---|---|---|
| id | | sg-bids |
| name | the vendor | 2+ |
| fpt | the vendor's Flow PT Group | sg-bids |
| email | contact email | 2+ |
| ndaFile, ndaExecuted | NDA file and whether it is signed | 2+ |
| tpn | Trusted Partner Network status | 2+ |
| capacity | the vendor's capacity | OpenBID |
| packages | the packages it is invited to. Absent: every package | sg-bids |

A vendor invited to some packages sees and bids on their rows alone, in every vendor answer. The
server reads no other row for it (`src/lib/pure/access.ts`: the vendor's reads of rows and packages
carry the invitation's packages), refuses a line or a figure outside them, and the database refuses
them too (`sg_bid_lines_guard`, `sg_bids_guard`). A request from before packages takes no list.

Production changes a vendor's packages while the vendor has submitted no bid, withdrawn or not. After
that it is refused, with the reason: a bid answers the packages it was made for. A draft saved for
wider packages is stopped at submit and the vendor reloads.

## Vendor bid

What a vendor answers. One per vendor per round. Every amount in it is in its currency.

### Header

| field | what | seen in |
|---|---|---|
| vendorId | the vendor | 2+ |
| number | the vendor's bid number | 2+ |
| round | the round answered | 2+ |
| date | bid date | 2+ |
| status | draft, submitted, awarded, not awarded, withdrawn | 2+ |
| currency | bid currency | 2+ |
| rate | rate to the base currency, locked with its date | 2+ |
| validUntil | how long the bid holds | 2+ |
| assumptions | the vendor's assumptions | 2+ |
| exclusions | what the bid leaves out | 2+ |
| milestones | payment milestones: label, percent, when | 2+ |

The rate is null when the bid is in the base currency. The vendor gives none: production sets it
after submission, per bid, with its date, in its own table (`bid_rates`), because a submitted bid
is frozen. Per bid and not per currency: each bid has its own date, and a second version may come
weeks after the first. Production may change it until the award; the database locks it then. Until
a bid has a rate, its base figures are unknown and the comparison says "needs a rate", never zero.
NIM converts at the bid date. vfx_bidding_assist keeps amounts in both currencies.

### Line, per shot or asset

| field | what | seen in |
|---|---|---|
| target | the shot or asset | 2+ |
| total | the price, all in | 2+ |
| departments | days and cost per department, optional | 2+ |
| compute | render and cloud cost, inside the total | 2+ |
| markup | markup, inside the total | 2+ |
| notes | vendor notes | 2+ |
| methodology | how the vendor will do it | BidCraft |
| assumptions | what the price takes for granted for this line | sg-bids |
| elementsNeeded | elements the vendor needs | 2+ |
| startWeek | start week | 2+ |
| excluded | the vendor will not do it | 2+ |

An excluded line is a different thing from a zero price, and from a shot the vendor did not bid.
The comparison shows all three apart.

### Per package

| field | what | seen in |
|---|---|---|
| packages | packages priced as one figure: `package`, `total`, `notes` | sg-bids |
| line, inPackage | the row is covered by its package's figure. Its total is zero | sg-bids |
| declined | packages the vendor is not bidding on | sg-bids |

Per package the vendor bids row by row, gives one figure for the package, or does not bid. A figure
covers every row of the package not omitted: each carries a line marked `inPackage`, so a scenario,
an award row and a Flow PT Bid Line still name the row. A package not bid on has no line and no
figure. The vendor bids on one package at least. Switching a package's way of pricing, or not
bidding on it, clears what it held, after a confirm. The figures count once in the lines total, so
the discount, the tax and an `all` rebate base take them. A `labour` rebate base cannot know a
figure's labour: the estimate says so, as for a line without department detail.

### Non-shot costs

| field | what | seen in |
|---|---|---|
| costs | overhead, supervision, on-set, contingency, other: label and amount | 2+ |
| costs, labour | whether the cost counts as labour for a rebate | sg-bids |
| discount | an amount, or a percent of the subtotal | 2+ |
| tax | local sales tax: an amount, or a percent after the discount | 2+ |

On-set covers the supervisor, wrangler, lidar and element shoots.

### Totals

Lines (excluded ones skipped) plus costs make the subtotal. Take off the discount, add the tax:
that is the grand total. Each figure is kept in the bid currency and converted once to the base
currency at the bid's rate, rounded half away from zero. An amount in another currency is an error.

The server holds a bid to these (`src/lib/pure/bid-limits.ts`). At every save: the currency is on
the ISO 4217 list, a discount or tax percent is 0 to 100, a rebate rate and share 0 to 100 and the
shares 100 at most. At submit, as well: the discount is not more than the subtotal and the grand
total is above zero.

### Rebate splits

| field | what | seen in |
|---|---|---|
| jurisdiction | where the work is done, an ISO 3166 code | 2+ |
| workPercent | share of the work done there | 2+ |
| rate | rebate percent | 2+ |
| base | `all`, `labour`, or `contract` with a percent | sg-bids |
| estimated rebate | computed | 2+ |
| total after rebate | computed | 2+ |

Several splits per bid, at bid level. No tool models several locations per line, so neither does
this one. Splits cover 100% of the work at most. The rest earns no rebate.

The base:

- `all`: the bid before tax, discount taken off.
- `contract`: a percent of that. Quebec counts 65% of a service contract.
- `labour`: each line's total less its compute, plus the costs marked labour. A line's labour is
  known only when it has department detail. When a line has none, the result says so and gives no
  number.

The vendor quotes gross. The rebate is always an estimate.

Default rates are in `src/lib/pure/rebate-defaults.ts`: rate, base, who usually claims, source and
the date checked. Stacked rates are kept as parts. Whether they stack on the same base was not
checked. A user edits the rate per bid.

## Deleting

A request is deleted whole: its items, invitations, every bid and line, the rates and the
scenarios. A draft goes after one confirm. An issued, undone or closed request asks for its code.
While an award is in Flow PT the delete is refused: undo the award first, or its Bids and Groups
would stay in Flow PT with nothing here to take them back. Deleting writes nothing to Flow PT. The
hashes of the request's link tokens are kept alone, so a vendor who opens a dead link is told the
production withdrew the request.

A vendor discards its own open draft. A first draft goes and the form is empty again. A new
version goes and the last submitted or withdrawn one is the latest again. A submitted bid is never
deleted. The vendor withdraws it.

## Award

One per shot or asset per vendor. A split shot has two.

| field | what | seen in |
|---|---|---|
| target | the shot or asset | 2+ |
| vendorId | the vendor | 2+ |
| bidId, bidRound | the bid and round awarded | 2+ |
| amount | in the bid and the base currency | 2+ |
| rate | the rate used | sg-bids |
| date | award date | 2+ |
| poNumber | purchase order number | 2+ |

Some tools also keep the rebate percent and the net amount on the award. Here they come from the
bid's rebate splits.

## Award scenario

A named pick of vendors per shot, to compare splits before awarding. From vfx_bidding_assist.

| field | what | seen in |
|---|---|---|
| name | the scenario's name | vfx_bidding_assist |
| picks | per shot or asset, the bids picked | vfx_bidding_assist |
| picks, shares | a percent per bid, 100 in all | sg-bids |
| chosen | the one scenario production means to award, one per request at most | sg-bids |
| costs left out | the bids whose non-shot costs the scenario does not count | sg-bids |

The scenario's cost is the picked lines in the base currency, each times its share, plus the
non-shot costs of each vendor that has a row in it, unless the user leaves them out. By default
they count: a vendor brought in brings its overhead and supervision. Discount and tax are left out.
They stay in each bid's grand total. Omitted shots and assets are never picked.

### Packages in the comparison

- A row of a package a vendor priced as one figure shows "In package price" for it, never a zero or
  a gap; a package it declined shows "Not bidding". Row marks count row prices only.
- Each package also compares as a unit: a vendor's figure, or the sum of its row prices, complete
  when it priced every row not omitted. The lowest is marked among the figures and the complete
  sums. Grouped by package, the group's row is that comparison.
- A package priced as one figure is awarded whole or not at all. A click on one of its rows picks the
  whole package for that vendor, a second click takes it off, and a row price picked in its place
  takes the rest off that vendor, said on the rail. A split with that vendor is refused. A bulk pick
  over part of the package skips its rows for that vendor. "Give each row to its lowest" gives the
  package to its lowest figure when that beats its rows' lowest prices summed. The server refuses a
  scenario that gives part of such a package (`partialPackagePicks`), and the award refuses it too.
- A package priced row by row behaves as before, split awards included. A package a vendor declined
  never goes to it.

## In Flow PT

The award writes one Bid per vendor per package per round (`src/lib/pure/fpt-award.ts`). In the app
nothing changes: one request, one link per vendor, one submission, one comparison.

| Bid | key `sg_sgbids_key` | name | total | Bid Lines |
|---|---|---|---|---|
| a package priced row by row | `sgbids/<request>/<vendor>/r<round>/p:<package>` | `<code> <vendor> R<round> <package>` | the sum of its rows | one per row, with its amount |
| a package priced as one figure | the same | the same | the figure | one per row, no amount |
| the whole-bid figures | `sgbids/<request>/<vendor>/r<round>/general` | `<code> <vendor> R<round> General costs` | non-shot costs less discount plus tax | none |

- A package the vendor declined, or left unpriced, has no Bid.
- A vendor's Bids sum to its grand total exactly, in minor units of its currency. In the base
  currency each Bid is converted alone and the last takes the rounding, so they sum exactly there
  too. The rebate estimate and the total after rebate are whole-bid figures: they sit on the General
  costs Bid alone. The General costs Bid is written only when the vendor gave a non-shot cost, a
  discount, a tax or a rebate split. It may be negative: a discount with no non-shot cost.
- The package id is percent-encoded in the key, so any id finds its row again. A line key is its
  Bid's key and the row, as before.
- Award status is per Bid: a package priced as one figure is awarded whole; a package priced row by
  row is awarded when any of its rows is, and a split inside it stays per Bid Line as before. The
  General costs Bid is awarded when the vendor wins anything.
- Every package Bid of a published vendor is written, awarded or not, so its Bids carry its whole
  bid. Bid Lines are the awarded rows, or every row with the switch "every line of every bid" on.
- A request from before packages keeps one Bid per vendor, keyed `sgbids/<request>/<vendor>/r<round>`
  as before, with the grand total and the rebate on it. It gains the General costs Bid only when the
  vendor gave whole-bid figures; then its one Bid carries the lines' sum. With no whole-bid figure the
  plan is exactly what it was, so an award published before packages, and its undo, still match.
- The package's name is in the Bid's name. No field is added to the site.
- Undo award deletes every Bid and Bid Line the award created, General costs included, as before.

## Change order

A change order is a new round.

| field | what | seen in |
|---|---|---|
| number | change order number | 2+ |
| status | draft, submitted, approved, rejected | 2+ |
| reason | why | 2+ |
| round, bidId | the round it opens and the vendor's bid for it | sg-bids |
| delta | the change, in both currencies | 2+ |
| added, omitted | shots and assets added and taken out | 2+ |
| approval | who approved and when | 2+ |
