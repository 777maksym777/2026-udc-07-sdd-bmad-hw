// One test per acceptance criterion of docs/spec/pricing-discounts.md, named
// by AC ID so vitest output doubles as the traceability table, plus the two
// extra scenarios from the OpenSpec delta spec.

import { describe, it, expect } from "vitest";
import { priceOrder } from "./discounts.js";
import type { Order, LineItem, Coupon } from "./types.js";

// Amounts are whole kopecks. Defaults per spec §4: country UA (shipping
// 4_900), now = 2026-09-21T00:00:00Z, catalog coupons valid till 2027-01-01.
const NOW = new Date("2026-09-21T00:00:00Z");
const VALID_TILL = "2027-01-01T00:00:00Z";

const item = (over: Partial<LineItem> = {}): LineItem => ({
  sku: "AA-1",
  name: "Thing",
  unitPriceKopecks: 100_000,
  quantity: 1,
  category: "standard",
  ...over,
});

const order = (over: Partial<Order> = {}): Order => ({
  id: "o1",
  items: [item()],
  country: "UA",
  customerTier: "none",
  coupons: [],
  ...over,
});

const catalog: Coupon[] = [
  { code: "SAVE10", kind: "percent", value: 10, expiresAt: VALID_TILL },
  { code: "SAVE15", kind: "percent", value: 15, expiresAt: VALID_TILL },
  { code: "TAKE50", kind: "fixed", value: 5_000, expiresAt: VALID_TILL },
  { code: "FRESH10", kind: "percent", value: 10, expiresAt: VALID_TILL, category: "fresh" },
  { code: "FRESH15", kind: "percent", value: 15, expiresAt: VALID_TILL, category: "fresh" },
  { code: "MIN500", kind: "fixed", value: 5_000, expiresAt: VALID_TILL, minSubtotalKopecks: 50_000 },
  { code: "OLD10", kind: "percent", value: 10, expiresAt: "2026-09-01T00:00:00Z" },
  { code: "EDGE", kind: "percent", value: 10, expiresAt: NOW.toISOString() },
  { code: "BIG150", kind: "fixed", value: 15_000, expiresAt: VALID_TILL },
  { code: "BIG300", kind: "fixed", value: 30_000, expiresAt: VALID_TILL },
];

describe("priceOrder", () => {
  it("AC-1: Gold, no coupons — tier 10% of subtotal, shipping untouched", () => {
    const b = priceOrder(order({ customerTier: "gold" }), catalog, NOW);
    expect(b.subtotalKopecks).toBe(100_000);
    expect(b.tierDiscountKopecks).toBe(10_000);
    expect(b.couponDiscountKopecks).toBe(0);
    expect(b.totalKopecks).toBe(94_900); // 90_000 items + 4_900 shipping
  });

  it("AC-2: expired coupon — rejected with reason 'expired', no throw", () => {
    const b = priceOrder(order({ coupons: ["OLD10"] }), catalog, NOW);
    expect(b.rejectedCoupons).toEqual([{ code: "OLD10", reason: "expired" }]);
    expect(b.couponDiscountKopecks).toBe(0);
    expect(b.totalKopecks).toBe(104_900);
  });

  it("AC-3: two coupons on the same category — each from the category sum", () => {
    const o = order({
      items: [
        item({ sku: "F-1", category: "fresh", unitPriceKopecks: 40_000 }),
        item({ sku: "S-1", category: "standard", unitPriceKopecks: 60_000 }),
      ],
      coupons: ["FRESH10", "FRESH15"],
    });
    const b = priceOrder(o, catalog, NOW);
    expect(b.appliedCoupons).toEqual([
      { code: "FRESH10", discountKopecks: 4_000 },
      { code: "FRESH15", discountKopecks: 6_000 },
    ]);
    expect(b.couponDiscountKopecks).toBe(10_000);
  });

  it("AC-4: fixed coupon larger than subtotal — truncated, goods part not negative", () => {
    const o = order({ items: [item({ unitPriceKopecks: 10_000 })], coupons: ["BIG150"] });
    const b = priceOrder(o, catalog, NOW);
    expect(b.appliedCoupons).toEqual([{ code: "BIG150", discountKopecks: 10_000 }]);
    expect(b.totalKopecks).toBe(4_900); // 0 goods + shipping
  });

  it("AC-5: tier and coupon are additive, each from the full subtotal", () => {
    const b = priceOrder(order({ customerTier: "gold", coupons: ["SAVE15"] }), catalog, NOW);
    expect(b.tierDiscountKopecks).toBe(10_000);
    expect(b.couponDiscountKopecks).toBe(15_000); // not 13_500 (sequential)
    expect(b.totalKopecks).toBe(79_900);
  });

  it("AC-6: half a kopeck rounds up — Silver 5% of 9 990 is 500", () => {
    const o = order({ customerTier: "silver", items: [item({ unitPriceKopecks: 9_990 })] });
    const b = priceOrder(o, catalog, NOW);
    expect(b.tierDiscountKopecks).toBe(500); // 499.5 → 500
    expect(b.totalKopecks).toBe(14_390); // 9_990 − 500 + 4_900
  });

  it("AC-7: empty order — zeros everywhere, coupon rejected, no error", () => {
    const b = priceOrder(order({ items: [], customerTier: "gold", coupons: ["SAVE15"] }), catalog, NOW);
    expect(b.subtotalKopecks).toBe(0);
    expect(b.tierDiscountKopecks).toBe(0);
    expect(b.couponDiscountKopecks).toBe(0);
    expect(b.rejectedCoupons).toEqual([{ code: "SAVE15", reason: "not_applicable" }]);
    expect(b.shippingKopecks).toBe(0);
    expect(b.totalKopecks).toBe(0);
  });

  it("AC-8: minSubtotal checked before discounts — 50 000 passes despite tier", () => {
    const o = order({
      customerTier: "gold",
      items: [item({ unitPriceKopecks: 50_000 })],
      coupons: ["MIN500"],
    });
    const b = priceOrder(o, catalog, NOW);
    expect(b.appliedCoupons).toEqual([{ code: "MIN500", discountKopecks: 5_000 }]);
    expect(b.totalKopecks).toBe(44_900); // 50_000 − 5_000 − 5_000 + 4_900
  });

  it("AC-9: percent and fixed coupons both apply, in typed order", () => {
    const b = priceOrder(order({ coupons: ["SAVE10", "TAKE50"] }), catalog, NOW);
    expect(b.appliedCoupons).toEqual([
      { code: "SAVE10", discountKopecks: 10_000 },
      { code: "TAKE50", discountKopecks: 5_000 },
    ]);
    expect(b.totalKopecks).toBe(89_900);
  });

  it("AC-10: same code twice — second entry rejected as 'duplicate'", () => {
    const b = priceOrder(order({ coupons: ["SAVE10", "SAVE10"] }), catalog, NOW);
    expect(b.appliedCoupons).toEqual([{ code: "SAVE10", discountKopecks: 10_000 }]);
    expect(b.rejectedCoupons).toEqual([{ code: "SAVE10", reason: "duplicate" }]);
  });

  it("AC-11: unknown code rejected, valid one still applies", () => {
    const b = priceOrder(order({ coupons: ["NOPE", "SAVE10"] }), catalog, NOW);
    expect(b.rejectedCoupons).toEqual([{ code: "NOPE", reason: "unknown" }]);
    expect(b.appliedCoupons).toEqual([{ code: "SAVE10", discountKopecks: 10_000 }]);
    expect(b.totalKopecks).toBe(94_900);
  });

  it("AC-12: digital order fully discounted — coupon capped, shipping never eaten", () => {
    const o = order({
      customerTier: "gold",
      items: [item({ category: "digital", unitPriceKopecks: 20_000 })],
      coupons: ["BIG300"],
    });
    const b = priceOrder(o, catalog, NOW);
    expect(b.tierDiscountKopecks).toBe(2_000);
    expect(b.appliedCoupons).toEqual([{ code: "BIG300", discountKopecks: 18_000 }]);
    expect(b.shippingKopecks).toBe(0);
    expect(b.totalKopecks).toBe(0);
  });

  // Extra scenarios from the OpenSpec delta spec (openspec/changes/add-discount-engine).

  it("category coupon on absent category — rejected as 'not_applicable'", () => {
    const o = order({ items: [item({ unitPriceKopecks: 50_000 })], coupons: ["FRESH10"] });
    const b = priceOrder(o, catalog, NOW);
    expect(b.rejectedCoupons).toEqual([{ code: "FRESH10", reason: "not_applicable" }]);
    expect(b.couponDiscountKopecks).toBe(0);
  });

  it("expiry boundary — coupon with expiresAt === now is already expired", () => {
    const b = priceOrder(order({ coupons: ["EDGE"] }), catalog, NOW);
    expect(b.rejectedCoupons).toEqual([{ code: "EDGE", reason: "expired" }]);
  });

  // Found by the Task C back-check: D-7 says later coupons grant 0 once the
  // remainder is exhausted, but no AC pinned it. Added here, noted in
  // docs/traceability.md.

  it("D-7: coupon after the remainder is exhausted applies with 0", () => {
    const o = order({ items: [item({ unitPriceKopecks: 10_000 })], coupons: ["BIG150", "TAKE50"] });
    const b = priceOrder(o, catalog, NOW);
    expect(b.appliedCoupons).toEqual([
      { code: "BIG150", discountKopecks: 10_000 },
      { code: "TAKE50", discountKopecks: 0 },
    ]);
    expect(b.totalKopecks).toBe(4_900);
  });
});
