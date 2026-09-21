# Proposal

## Why

The shop has loyalty tiers (`tierPercent`) that are defined in code but applied
nowhere, and no promo-code support at all. The business asked for discounts
before the autumn campaign (see `materials/feature-request.md`); the ambiguous
ticket has already been turned into an agreed, decision-complete specification
in `docs/spec/pricing-discounts.md` (decisions D-1…D-14, criteria AC-1…AC-12).
This change implements that specification.

## What Changes

- New discount engine module `app/src/discounts.ts` exposing a pure
  `priceOrder(order, catalog, now): PriceBreakdown` function.
- Loyalty-tier discount (Silver 5%, Gold 10%) is actually applied to the item
  subtotal.
- Promo codes: percent or fixed amount, optionally restricted to a category
  and/or a minimum order subtotal; several codes may be combined additively,
  in the order the customer typed them.
- Invalid codes (expired, unknown, duplicate, below minimum, empty base) never
  throw — they are reported in `rejectedCoupons` with a structured reason.
- Money stays in integer kopecks; each discount is rounded exactly once,
  half-kopeck up; total discount is capped so the goods part never goes
  negative (`total ≥ shipping`).
- No changes to `app/src/types.ts` or `app/src/pricing.ts` (stable contract);
  new tests in `app/src/discounts.test.ts` named after acceptance-criteria IDs.

## Capabilities

### New Capabilities

- `pricing-discounts`: computing the discounted price of an order — tier
  discount, promo-code validation and application, rounding, capping, and the
  resulting `PriceBreakdown`.

### Modified Capabilities

_None — there are no existing specs; current pricing behaviour
(`subtotalKopecks`, `shippingKopecks`, `tierPercent`) is unchanged._

## Impact

- **Code:** new `app/src/discounts.ts`, new `app/src/discounts.test.ts`;
  `app/src/index.ts` may re-export the new module. Existing files untouched.
- **API:** new exported function `priceOrder` and types
  `PriceBreakdown`, `AppliedCoupon`, `RejectedCoupon`,
  `CouponRejectionReason` (as fixed in §5 of `docs/spec/pricing-discounts.md`).
- **Dependencies:** none added; tests run under the existing vitest setup.
- **Docs:** `docs/traceability.md` (Task C) will map AC → code → test.
