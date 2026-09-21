// Discount engine. Implements docs/spec/pricing-discounts.md (decisions
// D-1..D-14, criteria AC-1..AC-12). All amounts are whole kopecks; the only
// fractional values are transient percentage results, each rounded exactly
// once (half a kopeck rounds up, D-4).

import type { Order, LineItem, Coupon } from "./types.js";
import { lineTotalKopecks, subtotalKopecks, shippingKopecks, tierPercent } from "./pricing.js";

export type CouponRejectionReason =
  | "expired" // now ≥ expiresAt (D-8, D-11)
  | "unknown" // code not in the catalog (D-9)
  | "duplicate" // same code entered again (D-10)
  | "min_subtotal_not_met" // pre-discount subtotal < minSubtotalKopecks (D-6)
  | "not_applicable"; // the coupon's base (category/order) is empty (D-12, D-14)

export interface AppliedCoupon {
  code: string;
  /** Actually granted amount — possibly truncated per D-7/D-13. */
  discountKopecks: number;
}

export interface RejectedCoupon {
  code: string;
  reason: CouponRejectionReason;
}

export interface PriceBreakdown {
  subtotalKopecks: number;
  tierDiscountKopecks: number;
  /** Sum over appliedCoupons. */
  couponDiscountKopecks: number;
  /** In the order the customer typed the codes. */
  appliedCoupons: AppliedCoupon[];
  /** In the order the customer typed the codes. */
  rejectedCoupons: RejectedCoupon[];
  shippingKopecks: number;
  /** subtotal − tier − coupons + shipping; never below shipping (D-2, D-7). */
  totalKopecks: number;
}

/** Half a kopeck rounds up; inputs are always non-negative here (D-4). */
function roundHalfUp(x: number): number {
  return Math.round(x);
}

function categorySumKopecks(order: Order, category: LineItem["category"]): number {
  return order.items
    .filter((i) => i.category === category)
    .reduce((sum, i) => sum + lineTotalKopecks(i), 0);
}

/**
 * First matching rejection reason, or null when the coupon is valid.
 * Normative order: unknown → duplicate → expired → min_subtotal_not_met →
 * not_applicable (D-6, D-8..D-12).
 */
function rejectionReason(
  coupon: Coupon | undefined,
  alreadySeen: boolean,
  subtotal: number,
  baseKopecks: number,
  now: Date,
): CouponRejectionReason | null {
  if (!coupon) return "unknown";
  if (alreadySeen) return "duplicate";
  if (now.getTime() >= new Date(coupon.expiresAt).getTime()) return "expired";
  if (coupon.minSubtotalKopecks !== undefined && subtotal < coupon.minSubtotalKopecks) {
    return "min_subtotal_not_met";
  }
  if (baseKopecks <= 0) return "not_applicable";
  return null;
}

/**
 * Pure function; never throws because of coupon content.
 * @param order   order.coupons are codes in the order the customer typed them
 * @param catalog the known coupons
 * @param now     instant used for the expiresAt check (D-11)
 */
export function priceOrder(order: Order, catalog: Coupon[], now: Date): PriceBreakdown {
  const subtotal = subtotalKopecks(order);

  // Tier discount from the full pre-discount subtotal (D-1, D-4).
  const tierDiscount = roundHalfUp((subtotal * tierPercent(order)) / 100);

  const appliedCoupons: AppliedCoupon[] = [];
  const rejectedCoupons: RejectedCoupon[] = [];
  const seenCodes = new Set<string>();
  // Remaining discountable amount — coupons are capped one by one (D-7, D-13).
  let remainder = subtotal - tierDiscount;

  for (const code of order.coupons) {
    const coupon = catalog.find((c) => c.code === code);
    const base = coupon?.category !== undefined ? categorySumKopecks(order, coupon.category) : subtotal;

    const reason = rejectionReason(coupon, seenCodes.has(code), subtotal, base, now);
    seenCodes.add(code);
    if (reason !== null) {
      rejectedCoupons.push({ code, reason });
      continue;
    }

    // coupon is defined here (reason would be "unknown" otherwise).
    const nominal =
      coupon!.kind === "percent" ? roundHalfUp((base * coupon!.value) / 100) : coupon!.value;
    const granted = Math.min(nominal, base, remainder);
    remainder -= granted;
    appliedCoupons.push({ code, discountKopecks: granted });
  }

  const couponDiscount = appliedCoupons.reduce((sum, c) => sum + c.discountKopecks, 0);
  const shipping = shippingKopecks(order);

  return {
    subtotalKopecks: subtotal,
    tierDiscountKopecks: tierDiscount,
    couponDiscountKopecks: couponDiscount,
    appliedCoupons,
    rejectedCoupons,
    shippingKopecks: shipping,
    totalKopecks: subtotal - tierDiscount - couponDiscount + shipping,
  };
}
