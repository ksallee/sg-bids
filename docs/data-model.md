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
- Each vendor bids in its own currency. Production compares in the request's base currency.

## Bid request

What production sends. One per bid package.

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
| fpt | the Flow PT Shot | sg-bids |
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
| fpt | the Flow PT Asset | sg-bids |
| description | what it is | 2+ |
| type, difficulty | kind of asset and how hard | 2+ |
| timesUsed | how many shots use it | 2+ |
| omitted | the asset is out | sg-bids |
| notes | production's note to the vendors | sg-bids |

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

The rate is null when the bid is in the base currency, and required when it is not. NIM converts
at the bid date. vfx_bidding_assist keeps amounts in both currencies.

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

The scenario's cost is the picked lines in the base currency, each times its share. Non-shot
costs, discount and tax are left out. They stay in each bid's grand total.

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
