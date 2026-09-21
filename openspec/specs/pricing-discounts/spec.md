# pricing-discounts Specification

## Purpose

Deterministic computation of an order's discounted price: loyalty-tier
discount plus promo codes (percent/fixed, category- and minimum-restricted),
with fixed rounding and capping rules, returned as a structured
`PriceBreakdown`. Source of decisions: `docs/spec/pricing-discounts.md`
(D-1…D-14, AC-1…AC-12).

All amounts below are integer kopecks (1 000 грн = 100 000 kopecks). Unless a
scenario says otherwise: country `UA` (shipping 4 900), `now =
2026-09-21T00:00:00Z`, coupons in the catalog expire `2027-01-01T00:00:00Z`.

## Requirements

### Requirement: Tier discount applies to the item subtotal
The engine SHALL compute the loyalty-tier discount as the tier percentage
(Silver 5%, Gold 10%, none 0%) of the full item subtotal before any other
discount (D-1), rounded once to the nearest kopeck with half a kopeck rounding
up (D-4).

#### Scenario: AC-1 Gold tier, no coupons
- **WHEN** a Gold customer's order subtotal is 100 000 with no coupons
- **THEN** `tierDiscountKopecks = 10 000`, `couponDiscountKopecks = 0`, and
  `totalKopecks = 94 900` (90 000 items + 4 900 shipping)

#### Scenario: AC-6 Half-kopeck rounds up (boundary)
- **WHEN** a Silver customer (5%) orders a single item of 9 990
- **THEN** 5% = 499.5 rounds up: `tierDiscountKopecks = 500` and
  `totalKopecks = 9 990 − 500 + 4 900 = 14 390`

### Requirement: Discounts combine additively
Tier and coupon discounts SHALL be additive: each discount is computed from
its own full pre-discount base and the amounts are summed; discounts are never
applied to another discount's result (D-1).

#### Scenario: AC-5 Tier plus percent coupon
- **WHEN** a Gold customer (10%) applies coupon `SAVE15` (15%, no category) to
  a subtotal of 100 000
- **THEN** the discount is `10 000 + 15 000 = 25 000` and
  `totalKopecks = 79 900` (not 23 500 as sequential application would give)

### Requirement: Discount base excludes shipping
Discounts SHALL be computed only from the item subtotal; shipping is added
after all discounts and is never reduced, so `totalKopecks ≥ shippingKopecks`
always holds (D-2).

#### Scenario: AC-12 Digital order fully discounted (boundary)
- **WHEN** an all-digital order of 20 000 from a Gold customer carries a fixed
  coupon of 30 000
- **THEN** tier = 2 000, the coupon is capped to the 18 000 remainder,
  `shippingKopecks = 0` and `totalKopecks = 0` — never negative

### Requirement: All valid coupons apply in typed order
The engine SHALL apply every valid coupon, in the order the codes appear in
`order.coupons` (D-3). Percent coupons take `round(base × value / 100)` with
half-up rounding (D-4); fixed coupons take their value, capped by their base
and the remaining discountable amount (D-7, D-13).

#### Scenario: AC-9 Percent and fixed coupon together
- **WHEN** `SAVE10` (10%) and `TAKE50` (fixed 5 000) are applied to a
  subtotal of 100 000 with no tier
- **THEN** both apply in typed order: `couponDiscountKopecks = 15 000` and
  `totalKopecks = 89 900`

#### Scenario: AC-3 Two coupons on the same category
- **WHEN** an order has fresh items for 40 000 and standard items for 60 000,
  and both `FRESH10` (10%, fresh) and `FRESH15` (15%, fresh) are entered
- **THEN** each computes from the category sum:
  `couponDiscountKopecks = 4 000 + 6 000 = 10 000`

### Requirement: Category coupons compute from their category's sum
A coupon with a `category` SHALL use the pre-discount sum of that category's
line items as its base: percent of that sum, or a fixed amount capped by it
(D-5). If the order contains no items of that category (base 0), the coupon
SHALL be rejected with reason `not_applicable` (D-12).

#### Scenario: Category coupon on absent category
- **WHEN** `FRESH10` (10%, fresh) is entered on an order containing only
  standard items for 50 000
- **THEN** `FRESH10` appears in `rejectedCoupons` with reason
  `not_applicable` and contributes 0 discount

### Requirement: Minimum subtotal is checked before any discounts
A coupon's `minSubtotalKopecks` SHALL be checked against the order's full
pre-discount item subtotal, not the subtotal after other discounts (D-6).

#### Scenario: AC-8 Minimum met exactly despite tier discount
- **WHEN** subtotal is 50 000, the customer is Gold (tier discount 5 000) and
  coupon `MIN500` (fixed 5 000, `minSubtotalKopecks = 50 000`) is entered
- **THEN** the minimum check passes (50 000 ≥ 50 000) and
  `totalKopecks = 50 000 − 5 000 − 5 000 + 4 900 = 44 900`

### Requirement: Total discount is capped at the item subtotal
The sum of tier and coupon discounts SHALL NOT exceed the item subtotal.
Coupons are capped one by one in typed order: each receives
`min(nominal, base, remainder)` where the remainder is the subtotal minus the
tier discount and previously granted coupon discounts; once the remainder is
0, later coupons grant 0 (D-7, D-13). The goods part of the total is
therefore never negative.

#### Scenario: AC-4 Fixed coupon larger than the order (boundary)
- **WHEN** subtotal is 10 000, tier is none, and a fixed coupon of 15 000 is
  applied
- **THEN** the coupon is truncated to 10 000 and
  `totalKopecks = 0 + 4 900 = 4 900`

### Requirement: Invalid coupons are rejected with a structured reason, never an exception
`priceOrder` SHALL never throw because of coupon content. An invalid coupon
SHALL NOT affect the price and SHALL appear in `rejectedCoupons` with the
first matching reason, checked in the order: `unknown` (not in catalog, D-9)
→ `duplicate` (same code entered again, D-10) → `expired`
(`now ≥ expiresAt`, D-8/D-11) → `min_subtotal_not_met` (D-6) →
`not_applicable` (empty base, D-12). Valid coupons in the same order still
apply.

#### Scenario: AC-2 Expired coupon
- **WHEN** a coupon with `expiresAt = 2026-09-01T00:00:00Z` is entered at
  `now = 2026-09-21T00:00:00Z`
- **THEN** it is in `rejectedCoupons` with reason `expired`, contributes 0,
  and no exception is thrown

#### Scenario: AC-10 Duplicate code
- **WHEN** `SAVE10` (10%) is entered twice on a subtotal of 100 000
- **THEN** the discount 10 000 is granted once and the second entry is
  rejected with reason `duplicate`

#### Scenario: AC-11 Unknown code alongside a valid one
- **WHEN** `NOPE` (not in the catalog) and valid `SAVE10` are entered on a
  subtotal of 100 000
- **THEN** `NOPE` is rejected with reason `unknown`, `SAVE10` grants 10 000,
  and `totalKopecks = 94 900`

### Requirement: Time is an explicit parameter
The engine SHALL take the current instant `now` as an explicit parameter and
treat a coupon as expired when `now ≥ expiresAt` (D-11). Equal inputs SHALL
always produce equal outputs (pure function).

#### Scenario: Expiry boundary instant
- **WHEN** a coupon's `expiresAt` equals `now` exactly
- **THEN** the coupon is rejected with reason `expired`

### Requirement: Empty order is a valid input
An order with no items SHALL yield subtotal 0, tier and coupon discounts 0,
every entered coupon rejected (`not_applicable`, or `min_subtotal_not_met`
when a minimum is set), shipping 0, and total 0 — not an error (D-14).

#### Scenario: AC-7 Empty order with tier and coupon (boundary)
- **WHEN** `items = []`, tier is Gold and `SAVE15` is entered
- **THEN** `subtotalKopecks = 0`, both discounts are 0, `SAVE15` is rejected
  with `not_applicable`, `shippingKopecks = 0`, `totalKopecks = 0`

### Requirement: The breakdown is self-consistent
The returned `PriceBreakdown` SHALL satisfy
`totalKopecks = subtotalKopecks − tierDiscountKopecks − couponDiscountKopecks
+ shippingKopecks`, with `couponDiscountKopecks` equal to the sum over
`appliedCoupons` and `tierDiscountKopecks + couponDiscountKopecks ≤
subtotalKopecks`. `appliedCoupons` and `rejectedCoupons` SHALL preserve typed
order, and every entered code SHALL appear in exactly one of the two lists.

#### Scenario: Invariant holds across accepted and rejected coupons
- **WHEN** any of the scenarios above is executed
- **THEN** the invariant equation holds and each entered code appears exactly
  once across `appliedCoupons` ∪ `rejectedCoupons`
