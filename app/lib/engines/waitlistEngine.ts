import { findBestWaitlistLead, type WaitlistLead } from "../waitlistEngine";
import type { RestaurantOrder } from "../domain/restaurant";

export { findBestWaitlistLead };
export type { WaitlistLead };

export function getRecoverableRevenue(order: Pick<RestaurantOrder, "amount" | "depositAmount">) {
  return Math.max(Number(order.amount ?? 0), Number(order.depositAmount ?? 0), 0);
}

export function rankWaitlistCandidates(
  order: Pick<RestaurantOrder, "id" | "orderType" | "amount">,
  waitlist: WaitlistLead[]
) {
  const best = findBestWaitlistLead(order, waitlist);
  if (!best) return [];

  return [
    {
      ...best,
      recoverableRevenue: getRecoverableRevenue(order),
    },
  ];
}
