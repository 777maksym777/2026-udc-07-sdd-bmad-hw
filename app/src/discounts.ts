// Discount engine for the autumn campaign (materials/feature-request.md).
// All amounts are whole kopecks. Discounts apply to the goods subtotal only;
// shipping is added afterwards and is never discounted.

import type { Coupon, LineItem, Order } from "./types.js";
import { lineTotalKopecks, shippingKopecks, subtotalKopecks, tierPercent } from "./pricing.js";

export type SkipReason =
  | "unknown"
  | "duplicate"
  | "expired"
  | "below_min_subtotal"
  | "no_matching_items";

export interface AppliedCoupon {
  code: string;
  discountKopecks: number;
}

export interface SkippedCoupon {
  code: string;
  reason: SkipReason;
}

export interface OrderPricing {
  subtotalKopecks: number;
  tierDiscountKopecks: number;
  /** Valid coupons, in the order the customer typed them. */
  appliedCoupons: AppliedCoupon[];
  /** Coupons that did not apply, each with the reason — never a thrown error. */
  skippedCoupons: SkippedCoupon[];
  /** tier + coupons, capped at the subtotal so the goods part never goes negative. */
  discountKopecks: number;
  shippingKopecks: number;
  totalKopecks: number;
}

function categoryTotalKopecks(order: Order, category: LineItem["category"]): number {
  return order.items
    .filter((item) => item.category === category)
    .reduce((sum, item) => sum + lineTotalKopecks(item), 0);
}

/**
 * Prices an order: tier discount plus every valid coupon, all computed from
 * the pre-discount subtotal (or the coupon's category slice of it), summed,
 * capped at the subtotal, shipping added on top. Each percentage is rounded
 * once with Math.round (half a kopeck rounds up).
 */
export function priceOrder(order: Order, catalog: Coupon[], now: Date = new Date()): OrderPricing {
  const subtotal = subtotalKopecks(order);
  const tierDiscount = Math.round((subtotal * tierPercent(order)) / 100);

  const applied: AppliedCoupon[] = [];
  const skipped: SkippedCoupon[] = [];
  const used = new Set<string>();

  for (const code of order.coupons) {
    if (used.has(code)) {
      skipped.push({ code, reason: "duplicate" });
      continue;
    }
    used.add(code);

    const coupon = catalog.find((c) => c.code === code);
    if (!coupon) {
      skipped.push({ code, reason: "unknown" });
      continue;
    }
    if (now.getTime() >= new Date(coupon.expiresAt).getTime()) {
      skipped.push({ code, reason: "expired" });
      continue;
    }
    if (coupon.minSubtotalKopecks !== undefined && subtotal < coupon.minSubtotalKopecks) {
      skipped.push({ code, reason: "below_min_subtotal" });
      continue;
    }

    const base =
      coupon.category === undefined ? subtotal : categoryTotalKopecks(order, coupon.category);
    if (base === 0) {
      skipped.push({ code, reason: "no_matching_items" });
      continue;
    }

    const discount =
      coupon.kind === "percent"
        ? Math.round((base * coupon.value) / 100)
        : Math.min(coupon.value, base);
    applied.push({ code, discountKopecks: discount });
  }

  const couponDiscount = applied.reduce((sum, c) => sum + c.discountKopecks, 0);
  const discountTotal = Math.min(tierDiscount + couponDiscount, subtotal);
  const shipping = shippingKopecks(order);

  return {
    subtotalKopecks: subtotal,
    tierDiscountKopecks: tierDiscount,
    appliedCoupons: applied,
    skippedCoupons: skipped,
    discountKopecks: discountTotal,
    shippingKopecks: shipping,
    totalKopecks: subtotal - discountTotal + shipping,
  };
}
