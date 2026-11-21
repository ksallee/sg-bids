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
  from Flow PT when the page opens and after every write, and an edit to it writes the field. The
  stored draft holds the values last read, so a reload is safe. The note to vendors, omit, a concept
  with no mapped field, and every value of a breakdown row are the request's own. Issuing copies
  the rows as they are and freezes them; from then on no Flow PT edit reaches them.

## Words

In the app a **request** is what production makes and sends, on one page: its **bids** (named sets
of rows), its vendors and its details. A vendor's whole submission to a request is its **answer**.
In the code a bid of a request is a package (`RequestPackage`, table `request_packages`); while the
request is a draft, each bid's rows live in `production_bids` and `production_bid_items`, owned by
the request; an answer is a `VendorBid` (table `bids`). The table names from before stay, to keep
the risk of the change low.

## Bid request

What production sends: one or several bids, the details they share, to the vendors it invites.
The rules are in `src/lib/pure/request-draft.ts`, `vendor-rows.ts` and `readiness.ts`.

- Made from the Requests list: New request asks for a name and a project, then the request's one
  page opens with one empty bid, named after the request with 01. One name: the code is made from it (`header.suggestCode`),
  kept out of sight, and written to Flow PT's Request Code at the award.
- A draft owns its bids. Add bid makes the next one, the request's name and `02`, `03`: the first number no bid of
  the request holds. A bid's name is unique in the request, in any case, 120 characters at most. A
  request keeps one bid at least. Deleting a bid takes its rows with it or moves them to another bid.
- Every row sits in exactly one bid of the request (`production_bid_items_one_bid`). Rows move
  between bids from the table's selection. Add from Flow PT and Add from a breakdown add to the bid
  picked.
- The vendors are rows of the draft: a name and an email (both required to issue), the vendor's
  Flow PT Group, and the bids it answers, every bid by default, one at least. When the person's
  permission group may create a Group (read first, recipe 030), a Group can be created empty from
  the row; a live Group of the same name is offered instead (`pure/group-create.ts`). A row is saved as
  typed, a name or an email still missing; a blank row is not saved. Their links are made at the
  issue (`invitations.link_pending`).
- The page saves as it changes, in one write (`sg_save_draft`). Issue is always in sight: it needs
  the name, the base currency, the day answers are due, a row, a row in every bid, one row not
  omitted, and a vendor with a name and an email. Pressed with something missing, it lists each
  problem, and each takes the person to its field.
- Issuing copies each bid's rows into the request under its package and freezes the request as
  before (`sg_issue_request`); the draft's bids go. Each vendor's link is shown once, on the page,
  with Copy, Copy all and Email (a `mailto:`; the app sends nothing). A lost link is made again with
  New link.
- Duplicate copies a request, draft or issued, into a new draft: the name with ` copy`, the details,
  the vendors (their links made at its issue), the bids by name, and their rows when asked.
- A new round of an issued request is a new draft with the same name and code, the round after,
  its bids with the rows as issued, and its vendors.

### Header

| field | what | seen in |
|---|---|---|
| code | the request's reference, made from its name when it is made; never shown, never typed | sg-bids |
| title | the request's one name, as production types it, 200 characters at most | sg-bids |
| project | the show | 2+ |
| projectRef | the Flow PT Project | sg-bids |
| studio | the studio | 2+ |
| director | the director | 2+ |
| clientSupervisor | client VFX supervisor | 2+ |
| clientProducer | client VFX producer | 2+ |
| cutVersion | script or cut version | 2+ |
| round | bid round, 1 first | 2+ |
| dueDate | when answers are due. Required to issue | 2+ |
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
| frames | frame count, per unit on a counted row | 2+ |
| count | how many shots of its kind the row stands for, on a row with no Flow PT Shot. Absent: 1 | sg-bids |
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
| count | how many assets of its kind the row stands for, on a row with no Flow PT Asset. Absent: 1 | sg-bids |
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

### Rows by count

Early bids go by count: 120 simple comps, 40 medium, 10 hard. One row stands for many. The rules
are in `src/lib/pure/count.ts`, with property tests.

- Add row, in the request's table, puts an empty row last in the bid picked, with the cursor in its
  code. Tab writes a cell and opens the next. Enter on the last row of a bid adds another. It is a
  breakdown row: `source: breakdown`, no `fpt`, the same mark. A row with no code stops the issue,
  and the list takes the person to it. The database refuses it too (`sg_issue_request`).
- A row with no Flow PT row has a count: a whole number from 1 to 100,000, 1 by default, typed in
  its cell or in bulk. A row linked to a Flow PT Shot or Asset is one: its count is 1, and its cell
  says why. A counted row is never matched to a Flow PT row (`sg_link_request_items` refuses it).
- Frames are per unit. A counted row's frames in all are its frames times its count, and the page
  shows both. A bid's and the request's counts add up the counts: `170 shots in 3 rows` where the
  counts make more than the rows.
- In storage, `unit_count` on `production_bid_items` and `request_items`, 1 by default, so every
  row from before reads as 1. It is frozen with the request. A row linked to Flow PT holds 1
  (`*_unit_count_fpt`).
- A vendor prices a counted row per unit. The rate card fills the unit price. The line's total is
  the unit price times the count, in whole minor units, and the line keeps its unit price (`unit`,
  in its detail). The store refuses a total that is not exactly that. Every total, the comparison,
  the award and Flow PT read the line's total, as before. A row of count 1 is a row as before.
- A counted row is awarded whole to one vendor, or split by the shares as any row. At the award it
  creates no Shot or Asset, even with create on: it lands as one Bid Line with no item, its amount
  the line total, its count in its name and in the Bid Line's Count field when the site has it.

### The bids of a request

A request's bids, packages in the code: named groups of its rows. Every row sits in exactly one. The
rules are in `src/lib/pure/packages.ts` and `request-draft.ts`.

| field | what | seen in |
|---|---|---|
| packages | the request's bids, in order: `id`, `name`, and on a draft the bid that holds its rows | sg-bids |
| shot or asset, package | the bid the row sits in | sg-bids |

- A draft has one per bid it owns, keyed `bid:<id>`. Names are unique in the request, in any case,
  120 characters at most.
- They freeze with the request at issue, as its rows do.
- A request stored with rows of its own, before bids, took defaults from sequences: a shot to its
  sequence's package (`seq:<sequence>`), a shot with none to Other shots (`shots`), an asset to
  Assets (`assets`). An issued one reads as it was. A draft one became its bids (below).
- A request stored before packages has none. It reads as one, All shots and assets (`all`), holding
  every row.
- In storage, `request_packages` holds a request's bids. On a draft, `bid_id` names the bid that
  holds its rows (`production_bids.request_id` is the draft, and each row of
  `production_bid_items` carries the request too). Issued, the rows are `request_items` and
  `package_key` names each row's bid, held by a foreign key; `bid_id` is cleared.
- The data from before one page turned at the migration (`sg_one_page_convert`): a draft took
  ownership of the bids it named, a bid named by several drafts was copied into each after the first,
  a row two bids of one draft held stayed in the first, and a bid no draft named became a draft
  request of its own, named after it. Issued requests were not touched.

### Invited vendor

| field | what | seen in |
|---|---|---|
| id | | sg-bids |
| name | the vendor | 2+ |
| fpt | the vendor's Flow PT Group | sg-bids |
| groupName | the Group's name as picked, for production's page; never sent to a vendor | sg-bids |
| email | contact email | 2+ |
| ndaFile, ndaExecuted | NDA file and whether it is signed | 2+ |
| tpn | Trusted Partner Network status | 2+ |
| capacity | the vendor's capacity | OpenBID |
| packages | the bids of the request it is invited to. Absent: every bid | sg-bids |

A vendor invited to some bids sees and answers their rows alone, in every version. The server reads
no other row for it (`src/lib/pure/access.ts`: the vendor's reads of rows and packages carry the
invitation's packages), refuses a line or a figure outside them, and the database refuses them too
(`sg_bid_lines_guard`, `sg_bids_guard`). A request from before packages takes no list. A vendor
never reads a draft's bids.

Production changes a vendor's bids while the vendor has submitted no answer, withdrawn or not. After
that it is refused, with the reason: an answer is for the bids it was made for. A draft saved for
wider bids is stopped at submit and the vendor reloads.

## Vendor answer

What a vendor sends, a `VendorBid` in the code. One per vendor per round. Every amount in it is in
its currency.

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
| unit | on a counted row, the price of one. The total is it times the count | sg-bids |

An excluded line is a different thing from a zero price, and from a shot the vendor did not bid.
The comparison shows all three apart.

### Per bid

| field | what | seen in |
|---|---|---|
| packages | bids priced as one figure: `package`, `total`, `notes` | sg-bids |
| line, inPackage | the row is covered by its bid's figure. Its total is zero | sg-bids |
| declined | bids the vendor is not bidding on | sg-bids |

Per bid the vendor prices row by row, gives one figure for the bid, or does not bid. A figure covers
every row of the bid not omitted: each carries a line marked `inPackage`, so a scenario, an award
row and a Flow PT Bid Line still name the row. A bid not answered has no line and no figure. The
vendor answers one bid at least. Switching a bid's way of pricing, or not bidding on it, clears what
it held, after a confirm. The figures common to the request (costs, discount, tax, rebate) are given
once. The figures count once in the lines total, so
the discount, the tax and an `all` rebate base take them. A `labour` rebate base cannot know a
figure's labour: the estimate says so, as for a line without department detail.

### Rate card

| field | what | seen in |
|---|---|---|
| rateCard, rates | a price per difficulty that appears in the vendor's rows: `difficulty`, `amount` | sg-bids |
| rateCard, fallback | the price for a row with no difficulty | sg-bids |
| line, fromRate | the line's total came from the card | sg-bids |

The rules are in `src/lib/pure/rate-card.ts`, with property tests. A rate fills every row of its
difficulty in the bids priced row by row; a bid priced as one figure, or not bid on, takes none. A
price the vendor types on a row is its own: no rate change touches it, and Use rate puts the rate
back. Every total, the comparison, the award and the Flow PT write read the lines' amounts, as
before. The card is kept in the answer's header, `fromRate` in the line's detail.

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

A bid is deleted on its request's page, with its rows or moving them to another bid.

A request is deleted whole: its bids and rows, invitations, every answer and line, the rates and
the scenarios. A draft goes after one confirm. An issued, undone or closed request asks for its
name.
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

### Bids in the comparison

- A row of a bid a vendor priced as one figure shows "In the bid's figure" for it, never a zero or a
  gap; a bid it declined shows "Not bidding". Row marks count row prices only.
- Each bid also compares as a unit: a vendor's figure, or the sum of its row prices, complete when
  it priced every row not omitted. The lowest is marked among the figures and the complete sums.
  Grouped by bid, the group's row is that comparison.
- A bid priced as one figure is awarded whole or not at all. A click on one of its rows picks the
  whole bid for that vendor, a second click takes it off, and a row price picked in its place takes
  the rest off that vendor, said on the rail. A split with that vendor is refused. A bulk pick over
  part of the bid skips its rows for that vendor. "Give each row to its lowest" gives the bid to its
  lowest figure when that beats its rows' lowest prices summed. The server refuses a scenario that
  gives part of such a bid (`partialPackagePicks`), and the award refuses it too.
- A bid priced row by row behaves as before, split awards included. A bid a vendor declined never
  goes to it.

## In Flow PT

The award writes one Bid in Flow PT per vendor per bid of the request it answered, per round
(`src/lib/pure/fpt-award.ts`). In the app nothing changes: one request, one link per vendor, one
answer, one comparison.

| Bid | key `sg_sgbids_key` | name | total | Bid Lines |
|---|---|---|---|---|
| a bid priced row by row | `sgbids/<request>/<vendor>/r<round>/p:<package>` | `<request name> <vendor> R<round> <bid name>` | the sum of its rows | one per row, with its amount |
| a bid priced as one figure | the same | the same | the figure | one per row, no amount |
| the whole-bid figures | `sgbids/<request>/<vendor>/r<round>/general` | `<request name> <vendor> R<round> General costs` | non-shot costs less discount plus tax | none |

- A bid the vendor declined, or left unpriced, has no Bid.
- A vendor's Bids sum to its grand total exactly, in minor units of its currency. In the base
  currency each Bid is converted alone and the last takes the rounding, so they sum exactly there
  too. The rebate estimate and the total after rebate are whole-bid figures: they sit on the General
  costs Bid alone. The General costs Bid is written only when the vendor gave a non-shot cost, a
  discount, a tax or a rebate split. It may be negative: a discount with no non-shot cost.
- The request's code goes in the Bid's Request Code; its name, the code when it has none, starts the
  Bid's name.
- The package id (`bid:<id>` for a bid of a draft) is percent-encoded in the key, so any id
  finds its row again. A line key is its Bid's key and the row, as before.
- Award status is per Bid: a bid priced as one figure is awarded whole; a bid priced row by row is
  awarded when any of its rows is, and a split inside it stays per Bid Line as before. The General
  costs Bid is awarded when the vendor wins anything.
- Every Bid of a published vendor is written, awarded or not, so its Bids carry its whole answer.
  Bid Lines are the awarded rows, or every row with the switch "every line of every bid" on.
- A request from before packages keeps one Bid per vendor, keyed `sgbids/<request>/<vendor>/r<round>`
  as before, with the grand total and the rebate on it. It gains the General costs Bid only when the
  vendor gave whole-bid figures; then its one Bid carries the lines' sum. With no whole-bid figure the
  plan is exactly what it was, so an award published before packages, and its undo, still match.
- The bid's name is in the Bid's name.
- A counted row's Bid Line is named with its count, `SIMPLE x120 Vendor A`, carries the line total
  as its amount, and no item. Bid Line has one optional field, Count (`sg_count`, a number): when the
  site has it, every Bid Line carries its count, 1 for a Shot or Asset of Flow PT. A site without it
  is still ready; the publish page offers to create it and says the count is in the name alone.
  Sums per Bid stay the line totals, so they still equal the bid's total exactly.
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
