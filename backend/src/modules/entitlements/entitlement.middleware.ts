import type { Request } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { entitlementRequired } from "../../lib/http-errors.js";
import { requireTenant } from "../../middleware/tenant-guard.js";
import { getEntitlements, resolveMetricForFeature, currentPeriodUsage } from "./entitlement.service.js";
import { logger } from "../../lib/logger.js";

/**
 * Gates a route on a plan feature AND on remaining quota.
 *
 * The original version only checked that the feature existed and was non-zero,
 * so `aiConversations: 5` behaved as unlimited: a tenant could use a thousand
 * conversations and still pass. Both halves now have to hold - the plan must
 * include the capability, and the current period must have room left.
 *
 * Negative limits are unlimited by convention in the plan seed, so they pass.
 */
export function requireEntitlement(featureKey: string, amount = 1) {
  return asyncHandler(async (req: Request, _res, next) => {
    const { organizationId } = requireTenant(req);
    const { features } = await getEntitlements(organizationId);
    const value = features[featureKey];

    // Feature absent from the plan: nothing is metered against it, so gating
    // here would produce 402s for something the tenant is already entitled to.
    if (value === undefined || value === null) {
      next();
      return;
    }

    if (value === false) {
      throw entitlementRequired(
        "Your plan does not include this capability.",
        { featureKey },
      );
    }

    // Every branch below must `return` after calling `next()`. Falling through
    // calls the next handler twice, which walks the router stack past the real
    // route and lands on notFoundHandler - a 404 for a request that should have
    // succeeded.
    if (value === true) {
      next();
      return;
    }

    if (typeof value !== "number") {
      next();
      return;
    }

    // Negative limits are unlimited by convention in the plan seed.
    if (value < 0) {
      next();
      return;
    }

    const used = await currentPeriodUsage(organizationId, resolveMetricForFeature(featureKey));
    if (used !== null && used + amount > value) {
      logger.info(
        { organizationId, featureKey, used, limit: value },
        "Entitlement quota exhausted.",
      );
      throw entitlementRequired("Your plan limit for this capability has been reached.", {
        featureKey,
        limit: value,
        used,
        remaining: Math.max(0, value - used),
      });
    }

    next();
  });
}
