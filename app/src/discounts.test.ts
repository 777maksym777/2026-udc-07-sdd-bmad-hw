// Tests for the discount engine, named after the acceptance criteria in
// docs/spec/pricing-discounts.md (AC-1..AC-15), plus boundary tests for
// decision wordings that have normative text but no AC of their own.

import { describe, expect, it } from "vitest";
import type { Coupon, LineItem, Order } from "./types.js";
import { priceOrder } from "./discounts.js";

const NOW = new Date("2026-09-21T00:00:00Z");
const FUTURE = "2027-01-01T00:00:00Z";

function item(overrides: Partial<LineItem> = {}): LineItem {
  return {
    sku: "SKU-1",
    name: "Товар",
    unitPriceKopecks: 100_000,
    quantity: 1,
    category: "standard",
    ...overrides,
  };
}

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: "ORD-1",
    items: [item()],
    country: "UA",
    customerTier: "none",
    coupons: [],
    ...overrides,
  };
}

function coupon(overrides: Partial<Coupon> = {}): Coupon {
  return { code: "SAVE", kind: "percent", value: 10, expiresAt: FUTURE, ...overrides };
}

describe("acceptance criteria", () => {
  it("AC-1: Gold, no coupons — tier 10% of subtotal, shipping untouched", () => {
    const r = priceOrder(order({ customerTier: "gold" }), [], NOW);
    expect(r.tierDiscountKopecks).toBe(10_000);
    expect(r.couponDiscountKopecks).toBe(0);
    expect(r.totalKopecks).toBe(94_900);
  });

  it("AC-2: expired coupon — rejected with reason 'expired', no throw", () => {
    const r = priceOrder(
      order({ coupons: ["OLD"] }),
      [coupon({ code: "OLD", expiresAt: "2026-09-01T00:00:00Z" })],
      NOW,
    );
    expect(r.rejectedCoupons).toEqual([{ code: "OLD", reason: "expired" }]);
    expect(r.couponDiscountKopecks).toBe(0);
  });

  it("AC-3: two coupons on the same category — each from the category sum", () => {
    const o = order({
      items: [
        item({ sku: "F", category: "fresh", unitPriceKopecks: 40_000 }),
        item({ sku: "S", unitPriceKopecks: 60_000 }),
      ],
      coupons: ["FRESH10", "FRESH15"],
    });
    const r = priceOrder(
      o,
      [
        coupon({ code: "FRESH10", value: 10, category: "fresh" }),
        coupon({ code: "FRESH15", value: 15, category: "fresh" }),
      ],
      NOW,
    );
    expect(r.appliedCoupons).toEqual([
      { code: "FRESH10", discountKopecks: 4_000 },
      { code: "FRESH15", discountKopecks: 6_000 },
    ]);
    expect(r.couponDiscountKopecks).toBe(10_000);
  });

  it("AC-4: fixed coupon larger than subtotal — truncated, goods part not negative", () => {
    const r = priceOrder(
      order({ items: [item({ unitPriceKopecks: 10_000 })], coupons: ["BIG"] }),
      [coupon({ code: "BIG", kind: "fixed", value: 15_000 })],
      NOW,
    );
    expect(r.appliedCoupons).toEqual([{ code: "BIG", discountKopecks: 10_000 }]);
    expect(r.totalKopecks).toBe(4_900);
  });

  it("AC-5: tier and coupon are additive, each from the full subtotal", () => {
    const r = priceOrder(
      order({ customerTier: "gold", coupons: ["SAVE15"] }),
      [coupon({ code: "SAVE15", value: 15 })],
      NOW,
    );
    expect(r.tierDiscountKopecks + r.couponDiscountKopecks).toBe(25_000);
    expect(r.totalKopecks).toBe(79_900);
  });

  it("AC-6: half a kopeck rounds up — Silver 5% of 9 990 is 500", () => {
    const r = priceOrder(
      order({ customerTier: "silver", items: [item({ unitPriceKopecks: 9_990 })] }),
      [],
      NOW,
    );
    expect(r.tierDiscountKopecks).toBe(500);
    expect(r.totalKopecks).toBe(14_390);
  });

  it("AC-7: empty order — zeros everywhere, coupon rejected, no error", () => {
    const r = priceOrder(
      order({ items: [], customerTier: "gold", coupons: ["SAVE15"] }),
      [coupon({ code: "SAVE15", value: 15 })],
      NOW,
    );
    expect(r.subtotalKopecks).toBe(0);
    expect(r.tierDiscountKopecks).toBe(0);
    expect(r.rejectedCoupons).toEqual([{ code: "SAVE15", reason: "not_applicable" }]);
    expect(r.shippingKopecks).toBe(0);
    expect(r.totalKopecks).toBe(0);
  });

  it("AC-8: minSubtotal checked before discounts — 50 000 passes despite tier", () => {
    const r = priceOrder(
      order({ customerTier: "gold", items: [item({ unitPriceKopecks: 50_000 })], coupons: ["MIN500"] }),
      [coupon({ code: "MIN500", kind: "fixed", value: 5_000, minSubtotalKopecks: 50_000 })],
      NOW,
    );
    expect(r.appliedCoupons).toEqual([{ code: "MIN500", discountKopecks: 5_000 }]);
    expect(r.totalKopecks).toBe(44_900);
  });

  it("AC-9: percent and fixed coupons both apply, in typed order", () => {
    const r = priceOrder(
      order({ coupons: ["SAVE10", "TAKE50"] }),
      [coupon({ code: "SAVE10", value: 10 }), coupon({ code: "TAKE50", kind: "fixed", value: 5_000 })],
      NOW,
    );
    expect(r.appliedCoupons.map((c) => c.code)).toEqual(["SAVE10", "TAKE50"]);
    expect(r.couponDiscountKopecks).toBe(15_000);
    expect(r.totalKopecks).toBe(89_900);
  });

  it("AC-10: same code twice — second entry rejected as 'duplicate'", () => {
    const r = priceOrder(order({ coupons: ["SAVE10", "SAVE10"] }), [coupon({ code: "SAVE10" })], NOW);
    expect(r.couponDiscountKopecks).toBe(10_000);
    expect(r.rejectedCoupons).toEqual([{ code: "SAVE10", reason: "duplicate" }]);
  });

  it("AC-11: unknown code rejected, valid one still applies", () => {
    const r = priceOrder(order({ coupons: ["NOPE", "SAVE10"] }), [coupon({ code: "SAVE10" })], NOW);
    expect(r.rejectedCoupons).toEqual([{ code: "NOPE", reason: "unknown" }]);
    expect(r.couponDiscountKopecks).toBe(10_000);
    expect(r.totalKopecks).toBe(94_900);
  });

  it("AC-12: digital order fully discounted — coupon capped, shipping never eaten", () => {
    const r = priceOrder(
      order({
        customerTier: "gold",
        items: [item({ category: "digital", unitPriceKopecks: 20_000 })],
        coupons: ["BIG"],
      }),
      [coupon({ code: "BIG", kind: "fixed", value: 30_000 })],
      NOW,
    );
    expect(r.tierDiscountKopecks).toBe(2_000);
    expect(r.appliedCoupons).toEqual([{ code: "BIG", discountKopecks: 18_000 }]);
    expect(r.shippingKopecks).toBe(0);
    expect(r.totalKopecks).toBe(0);
  });

  it("AC-13: coupon eaten by an exhausted remainder — rejected 'not_applicable', never applied with 0", () => {
    const r = priceOrder(
      order({ items: [item({ unitPriceKopecks: 10_000 })], coupons: ["TAKE100", "SAVE10"] }),
      [coupon({ code: "TAKE100", kind: "fixed", value: 10_000 }), coupon({ code: "SAVE10", value: 10 })],
      NOW,
    );
    expect(r.appliedCoupons).toEqual([{ code: "TAKE100", discountKopecks: 10_000 }]);
    expect(r.rejectedCoupons).toEqual([{ code: "SAVE10", reason: "not_applicable" }]);
    expect(r.appliedCoupons.every((c) => c.discountKopecks > 0)).toBe(true);
    expect(r.totalKopecks).toBe(4_900);
  });

  it("AC-14: offset-less, malformed or calendar-invalid expiresAt — rejected 'expired' regardless of TZ", () => {
    const r = priceOrder(
      order({ coupons: ["BADTIME", "GARBAGE", "FEB30", "NONLEAP"] }),
      [
        coupon({ code: "BADTIME", expiresAt: "2026-12-31T23:59" }),
        coupon({ code: "GARBAGE", expiresAt: "not-a-date" }),
        // Date.parse would silently roll these onto March — D-16 rejects them.
        coupon({ code: "FEB30", expiresAt: "2027-02-30T00:00:00Z" }),
        coupon({ code: "NONLEAP", expiresAt: "2027-02-29T00:00:00Z" }),
      ],
      NOW,
    );
    expect(r.rejectedCoupons).toEqual([
      { code: "BADTIME", reason: "expired" },
      { code: "GARBAGE", reason: "expired" },
      { code: "FEB30", reason: "expired" },
      { code: "NONLEAP", reason: "expired" },
    ]);
  });

  it("AC-15: case mismatch — 'save10' vs catalog 'SAVE10' is 'unknown'", () => {
    const r = priceOrder(order({ coupons: ["save10"] }), [coupon({ code: "SAVE10" })], NOW);
    expect(r.rejectedCoupons).toEqual([{ code: "save10", reason: "unknown" }]);
    expect(r.couponDiscountKopecks).toBe(0);
    expect(r.totalKopecks).toBe(104_900);
  });
});

describe("decision boundaries without an AC of their own", () => {
  it("D-11: coupon is invalid exactly at its expiresAt instant", () => {
    const r = priceOrder(
      order({ coupons: ["EDGE"] }),
      [coupon({ code: "EDGE", expiresAt: NOW.toISOString() })],
      NOW,
    );
    expect(r.rejectedCoupons).toEqual([{ code: "EDGE", reason: "expired" }]);
  });

  it("D-16: an explicit numeric offset is a valid expiresAt", () => {
    const r = priceOrder(
      order({ coupons: ["TZOK"] }),
      [coupon({ code: "TZOK", expiresAt: "2027-01-01T00:00:00+02:00" })],
      NOW,
    );
    expect(r.appliedCoupons).toEqual([{ code: "TZOK", discountKopecks: 10_000 }]);
  });

  it("D-6: coupon below its minimum subtotal — rejected 'min_subtotal_not_met'", () => {
    const r = priceOrder(
      order({ coupons: ["MIN"] }),
      [coupon({ code: "MIN", kind: "fixed", value: 5_000, minSubtotalKopecks: 150_000 })],
      NOW,
    );
    expect(r.rejectedCoupons).toEqual([{ code: "MIN", reason: "min_subtotal_not_met" }]);
  });

  it("D-12: category coupon on absent category — rejected 'not_applicable'", () => {
    const r = priceOrder(
      order({ coupons: ["FRESH10"] }),
      [coupon({ code: "FRESH10", category: "fresh" })],
      NOW,
    );
    expect(r.rejectedCoupons).toEqual([{ code: "FRESH10", reason: "not_applicable" }]);
  });

  it("D-4: percent coupon also rounds half a kopeck up — 15% of 9 990 is 1 499", () => {
    const r = priceOrder(
      order({ items: [item({ unitPriceKopecks: 9_990 })], coupons: ["SAVE15"] }),
      [coupon({ code: "SAVE15", value: 15 })],
      NOW,
    );
    expect(r.appliedCoupons).toEqual([{ code: "SAVE15", discountKopecks: 1_499 }]);
  });

  it("D-13: fixed category coupon is capped by the category sum, not the subtotal", () => {
    const o = order({
      items: [
        item({ sku: "F", category: "fresh", unitPriceKopecks: 5_000 }),
        item({ sku: "S", unitPriceKopecks: 45_000 }),
      ],
      coupons: ["FRESH50"],
    });
    const r = priceOrder(
      o,
      [coupon({ code: "FRESH50", kind: "fixed", value: 8_000, category: "fresh" })],
      NOW,
    );
    expect(r.appliedCoupons).toEqual([{ code: "FRESH50", discountKopecks: 5_000 }]);
  });

  it("invariant: total = subtotal − tier − coupons + shipping and every code lands in exactly one list", () => {
    const o = order({
      customerTier: "gold",
      items: [item(), item({ sku: "F", category: "fresh", unitPriceKopecks: 9_990 })],
      coupons: ["SAVE10", "SAVE10", "NOPE", "FRESH15", "OLD"],
    });
    const r = priceOrder(
      o,
      [
        coupon({ code: "SAVE10" }),
        coupon({ code: "FRESH15", value: 15, category: "fresh" }),
        coupon({ code: "OLD", expiresAt: "2026-01-01T00:00:00Z" }),
      ],
      NOW,
    );
    expect(r.totalKopecks).toBe(
      r.subtotalKopecks - r.tierDiscountKopecks - r.couponDiscountKopecks + r.shippingKopecks,
    );
    expect(r.tierDiscountKopecks + r.couponDiscountKopecks).toBeLessThanOrEqual(r.subtotalKopecks);
    expect(r.appliedCoupons.length + r.rejectedCoupons.length).toBe(o.coupons.length);
  });
});
