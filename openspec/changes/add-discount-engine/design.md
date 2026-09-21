# Design

## Context

See `proposal.md` — Why. The behavioural decisions are already fixed in
`docs/spec/pricing-discounts.md` (D-1…D-14) and mirrored in the delta spec;
this document only settles how the code realises them.

Constraints:

- `app/src/types.ts` and `app/src/pricing.ts` are a stable contract — reuse
  `subtotalKopecks`, `shippingKopecks`, `tierPercent`; change nothing there.
- Money is integer kopecks everywhere; the only fractional values allowed are
  the transient results of percentage multiplication, each rounded exactly
  once (half-kopeck up).
- ESM TypeScript project (`"type": "module"`, imports end in `.js`), tested
  with vitest.

## Goals / Non-Goals

**Goals:**

- One pure function `priceOrder(order, catalog, now)` implementing the whole
  engine, trivially testable against AC-1…AC-12.
- Every rejection path expressed as data (`rejectedCoupons`), never as an
  exception.

**Non-Goals:**

- Coupon storage/CRUD, usage limits, shipping discounts, per-line discount
  allocation, currencies other than UAH (spec §2 "Поза скоупом").
- Public API surface beyond what spec §5 fixes.

## Decisions

1. **Single module, single entry point.** All logic lives in
   `app/src/discounts.ts`; internal helpers (`roundHalfUp`, `categorySum`,
   coupon validation) stay unexported. Alternative — a class or a pipeline of
   small exported functions — rejected: the spec's contract is one function,
   and a smaller surface keeps the traceability table honest.
2. **Validation as a reason-or-null function.** One helper returns the first
   matching `CouponRejectionReason` (checked in the normative order
   `unknown → duplicate → expired → min_subtotal_not_met → not_applicable`)
   or `null`. This makes the "first reason wins" rule from the spec a single
   visible list rather than scattered `if`s.
3. **Sequential fold for capping.** Coupons are processed with a running
   `remainder = subtotal − tierDiscount − grantedSoFar`; each coupon grants
   `min(nominal, base, remainder)`. Alternative — proportional distribution
   when the cap is hit — rejected by spec D-7 (order-of-entry capping is the
   agreed behaviour).
4. **`Math.round` as `roundHalfUp`.** For non-negative inputs
   `Math.round(x)` rounds half up, which is exactly D-4; inputs are always
   non-negative (percent of a non-negative base). No decimal library needed —
   subtotals are far below `Number.MAX_SAFE_INTEGER`.
5. **Date comparison via `getTime()`.** `now >= new Date(coupon.expiresAt)`
   compared numerically; `expiresAt` strings come from the stable `Coupon`
   type. Invalid date strings are not defended against — the catalog is
   trusted input (out of scope per spec §2).
6. **Tests named by AC ID.** `discounts.test.ts` contains one test per
   AC (`"AC-1: …"` … `"AC-12: …"`) plus the two extra delta-spec scenarios
   (absent category, expiry boundary), so vitest output reads as the
   traceability table.

## Risks / Trade-offs

- [Additive discounts can stack steeply (10% + 15% + fixed…)] → capped at
  100% of subtotal by D-7; business accepted this in the spec's decision
  table.
- [`Math.round` on a computed float like `9990 * 0.05`] → compute as
  `Math.round((base * value) / 100)`; a float epsilon landing a hair below
  .5 is theoretically possible but not for integer inputs of this magnitude;
  AC-6 pins the behaviour with a test.
- [Engine unused by existing code paths] → intentional: the homework wires it
  via tests only; `index.ts` re-export keeps it reachable for consumers.

## Migration Plan

Pure addition — new files only, no data or API migration. Rollback = delete
`discounts.ts` / `discounts.test.ts`.
