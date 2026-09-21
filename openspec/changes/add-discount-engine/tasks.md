# Tasks

## 1. Contract and helpers

- [ ] 1.1 Create `app/src/discounts.ts` with the types from spec §5
      (`CouponRejectionReason`, `AppliedCoupon`, `RejectedCoupon`,
      `PriceBreakdown`) and the `priceOrder(order, catalog, now)` signature;
      verify `cd app && npx tsc --noEmit` (via vitest run) compiles.
- [ ] 1.2 Implement internal helpers: `roundHalfUp`, category sum, and the
      reason-or-null coupon validator with the normative reason order
      `unknown → duplicate → expired → min_subtotal_not_met → not_applicable`
      (design decision 2); verified by the AC tests in group 3.

## 2. Engine

- [ ] 2.1 Implement tier discount: `roundHalfUp(subtotal × tierPercent / 100)`
      from the full pre-discount subtotal (D-1, D-4); verify with AC-1 and
      AC-6 tests.
- [ ] 2.2 Implement coupon application as a sequential fold in typed order
      with running remainder capping `min(nominal, base, remainder)`
      (D-3, D-5, D-7, D-13); verify with AC-3, AC-4, AC-9, AC-12 tests.
- [ ] 2.3 Assemble `PriceBreakdown` (subtotal, tier, coupons,
      applied/rejected lists in typed order, shipping via `shippingKopecks`,
      total) and re-export `priceOrder` from `app/src/index.ts`; verify the
      invariant `total = subtotal − tier − coupons + shipping` in tests.

## 3. Tests (one per acceptance criterion)

- [ ] 3.1 Create `app/src/discounts.test.ts` with tests `AC-1` … `AC-12`
      named exactly by ID, using the concrete numbers from
      `docs/spec/pricing-discounts.md` §4; verify `cd app && npm test` is
      green with all 8 existing tests untouched.
- [ ] 3.2 Add the two extra delta-spec scenarios: category coupon on an
      absent category (`not_applicable`) and expiry at the exact boundary
      instant (`now === expiresAt` → `expired`); verify both pass in the same
      run.

## 4. Verification

- [ ] 4.1 Run `cd app && npm test` and confirm 8 old + all new tests pass;
      confirm no changes to `types.ts` / `pricing.ts` via `git diff --stat`.
- [ ] 4.2 Back-check against the spec: no behaviour in code without an AC, no
      AC without a test, no test without an AC — record the result in
      `docs/traceability.md` (Task C deliverable).
