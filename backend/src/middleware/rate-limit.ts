import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";
import { env } from "../config/env.js";

interface RateLimiterOptions {
  limit?: number;
  windowMs?: number;
  skipInTest?: boolean;
}

export function createAuthRateLimiter(
  options: RateLimiterOptions = {},
): RateLimitRequestHandler {
  const {
    limit = 10,
    windowMs = 15 * 60 * 1000,
    skipInTest = false,
  } = options;

  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => skipInTest && env.NODE_ENV === "test",
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Please try again later.",
        },
      });
    },
  });
}

export const authRateLimiter = createAuthRateLimiter({ skipInTest: true });
