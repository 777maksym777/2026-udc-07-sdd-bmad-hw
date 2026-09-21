// Tests for the ad-hoc discount engine (materials/feature-request.md).
// Each test name states the behaviour it pins down.

import { describe, expect, it } from "vitest";
import type { Coupon, LineItem, Order } from "./types.js";
import { priceOrder } from "./discounts.js";

const NOW = new Date("2026-09-21T12:00:00Z");
const FUTURE = "2026-12-31T00:00:00Z";

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

describe("tier discount", () => {
  it("silver takes 5% off the goods subtotal, shipping untouched", () => {
    const r = priceOrder(order({ customerTier: "silver" }), [], NOW);
    expect(r.tierDiscountKopecks).toBe(5_000);
    expect(r.totalKopecks).toBe(100_000 - 5_000 + 4_900);
  });

  it("gold takes 10% off the goods subtotal", () => {
    const r = priceOrder(order({ customerTier: "gold" }), [], NOW);
    expect(r.tierDiscountKopecks).toBe(10_000);
    expect(r.totalKopecks).toBe(100_000 - 10_000 + 4_900);
  });

  it("tier 'none' gives no discount", () => {
    const r = priceOrder(order(), [], NOW);
    expect(r.tierDiscountKopecks).toBe(0);
    expect(r.totalKopecks).toBe(104_900);
  });
});

describe("coupons", () => {
  it("percent coupon takes its percent of the goods subtotal", () => {
    const r = priceOrder(
      order({ coupons: ["FALL15"] }),
      [coupon({ code: "FALL15", value: 15 })],
      NOW,
    );
    expect(r.appliedCoupons).toEqual([{ code: "FALL15", discountKopecks: 15_000 }]);
    expect(r.totalKopecks).toBe(100_000 - 15_000 + 4_900);
  });

  it("fixed coupon subtracts its amount in kopecks", () => {
    const r = priceOrder(
      order({ coupons: ["MINUS200"] }),
      [coupon({ code: "MINUS200", kind: "fixed", value: 20_000 })],
      NOW,
    );
    expect(r.appliedCoupons).toEqual([{ code: "MINUS200", discountKopecks: 20_000 }]);
    expect(r.totalKopecks).toBe(100_000 - 20_000 + 4_900);
  });

  it("tier and coupon stack additively, each from the full subtotal", () => {
    const r = priceOrder(
      order({ customerTier: "gold", coupons: ["FALL15"] }),
      [coupon({ code: "FALL15", value: 15 })],
      NOW,
    );
    // 10% + 15% of 1000 грн = 250 грн, not 10% then 15% of the remainder.
    expect(r.discountKopecks).toBe(25_000);
    expect(r.totalKopecks).toBe(100_000 - 25_000 + 4_900);
  });

  it("all valid coupons apply, in the order the customer typed them", () => {
    const r = priceOrder(
      order({ coupons: ["FALL15", "MINUS50"] }),
      [
        coupon({ code: "FALL15", value: 15 }),
        coupon({ code: "MINUS50", kind: "fixed", value: 5_000 }),
      ],
      NOW,
    );
    expect(r.appliedCoupons.map((c) => c.code)).toEqual(["FALL15", "MINUS50"]);
    expect(r.discountKopecks).toBe(20_000);
  });

  it("the same code typed twice counts once; the repeat is skipped as duplicate", () => {
    const r = priceOrder(
      order({ coupons: ["FALL15", "FALL15"] }),
      [coupon({ code: "FALL15", value: 15 })],
      NOW,
    );
    expect(r.appliedCoupons).toHaveLength(1);
    expect(r.skippedCoupons).toEqual([{ code: "FALL15", reason: "duplicate" }]);
  });

  it("an unknown code is skipped with reason, not an error", () => {
    const r = priceOrder(order({ coupons: ["NOPE"] }), [], NOW);
    expect(r.skippedCoupons).toEqual([{ code: "NOPE", reason: "unknown" }]);
    expect(r.totalKopecks).toBe(104_900);
  });
});

describe("expiry", () => {
  it("an expired coupon is skipped with reason 'expired'", () => {
    const r = priceOrder(
      order({ coupons: ["OLD"] }),
      [coupon({ code: "OLD", expiresAt: "2026-01-01T00:00:00Z" })],
      NOW,
    );
    expect(r.skippedCoupons).toEqual([{ code: "OLD", reason: "expired" }]);
  });

  it("a coupon is invalid exactly at its expiresAt instant", () => {
    const r = priceOrder(
      order({ coupons: ["EDGE"] }),
      [coupon({ code: "EDGE", expiresAt: NOW.toISOString() })],
      NOW,
    );
    expect(r.skippedCoupons).toEqual([{ code: "EDGE", reason: "expired" }]);
  });
});

describe("category coupons", () => {
  it("a category percent coupon applies to that category's items only", () => {
    const o = order({
      items: [item(), item({ sku: "SKU-2", category: "fresh", unitPriceKopecks: 40_000 })],
      coupons: ["FRESH10"],
    });
    const r = priceOrder(o, [coupon({ code: "FRESH10", value: 10, category: "fresh" })], NOW);
    expect(r.appliedCoupons).toEqual([{ code: "FRESH10", discountKopecks: 4_000 }]);
  });

  it("a fixed category coupon never exceeds that category's total", () => {
    const o = order({
      items: [item(), item({ sku: "SKU-2", category: "fresh", unitPriceKopecks: 3_000 })],
      coupons: ["FRESH50"],
    });
    const r = priceOrder(
      o,
      [coupon({ code: "FRESH50", kind: "fixed", value: 5_000, category: "fresh" })],
      NOW,
    );
    expect(r.appliedCoupons).toEqual([{ code: "FRESH50", discountKopecks: 3_000 }]);
  });

  it("a category coupon with no matching items is skipped", () => {
    const r = priceOrder(
      order({ coupons: ["FRESH10"] }),
      [coupon({ code: "FRESH10", category: "fresh" })],
      NOW,
    );
    expect(r.skippedCoupons).toEqual([{ code: "FRESH10", reason: "no_matching_items" }]);
  });
});

describe("minimum subtotal", () => {
  it("is checked against the pre-discount subtotal", () => {
    // Gold tier would drop the paid amount below the minimum, but the check
    // uses the raw subtotal, so the coupon still applies.
    const r = priceOrder(
      order({ customerTier: "gold", coupons: ["BIG"] }),
      [coupon({ code: "BIG", kind: "fixed", value: 5_000, minSubtotalKopecks: 100_000 })],
      NOW,
    );
    expect(r.appliedCoupons).toHaveLength(1);
  });

  it("a coupon below its minimum subtotal is skipped with reason", () => {
    const r = priceOrder(
      order({ coupons: ["BIG"] }),
      [coupon({ code: "BIG", kind: "fixed", value: 5_000, minSubtotalKopecks: 150_000 })],
      NOW,
    );
    expect(r.skippedCoupons).toEqual([{ code: "BIG", reason: "below_min_subtotal" }]);
  });
});

describe("rounding and bounds", () => {
  it("half a kopeck rounds up, once per discount", () => {
    // 5% of 1 990 kopecks = 99.5 → 100.
    const o = order({ customerTier: "silver", items: [item({ unitPriceKopecks: 1_990 })] });
    const r = priceOrder(o, [], NOW);
    expect(r.tierDiscountKopecks).toBe(100);
  });

  it("total discount is capped at the subtotal — the total never drops below shipping", () => {
    const r = priceOrder(
      order({ customerTier: "gold", coupons: ["HUGE"] }),
      [coupon({ code: "HUGE", kind: "fixed", value: 500_000 })],
      NOW,
    );
    expect(r.discountKopecks).toBe(100_000);
    expect(r.totalKopecks).toBe(4_900);
  });

  it("an all-digital order ships for free and still takes discounts", () => {
    const o = order({
      customerTier: "silver",
      items: [item({ category: "digital", unitPriceKopecks: 30_000 })],
    });
    const r = priceOrder(o, [], NOW);
    expect(r.shippingKopecks).toBe(0);
    expect(r.totalKopecks).toBe(30_000 - 1_500);
  });

  it("an empty order totals zero and applies nothing", () => {
    const r = priceOrder(
      order({ items: [], customerTier: "gold", coupons: ["FALL15"] }),
      [coupon({ code: "FALL15", value: 15 })],
      NOW,
    );
    expect(r.subtotalKopecks).toBe(0);
    expect(r.skippedCoupons).toEqual([{ code: "FALL15", reason: "no_matching_items" }]);
    expect(r.totalKopecks).toBe(0);
  });
});
