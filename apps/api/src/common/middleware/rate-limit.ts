import type { RequestHandler } from 'express';
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { redis } from '../../infrastructure/redis/redis.js';
import { RateLimitError } from '../exceptions/app-error.js';

interface LimiterOptions {
  name: string;
  points: number;
  durationSeconds: number;
  key: (req: Parameters<RequestHandler>[0]) => string;
}

/**
 * Redis-backed limiter with an in-memory insurance limiter, so general
 * endpoints keep a per-instance limit if Redis is unavailable (SECURITY.md §8).
 * Auth endpoints (Phase 2) use a fail-closed variant.
 */
export function rateLimit(options: LimiterOptions): RequestHandler {
  const insurance = new RateLimiterMemory({
    keyPrefix: `rl-mem:${options.name}`,
    points: options.points,
    duration: options.durationSeconds,
  });
  const limiter = new RateLimiterRedis({
    storeClient: redis,
    keyPrefix: `rl:${options.name}`,
    points: options.points,
    duration: options.durationSeconds,
    insuranceLimiter: insurance,
  });

  return async (req, res, next) => {
    try {
      const result = await limiter.consume(options.key(req));
      res.setHeader('RateLimit-Limit', String(options.points));
      res.setHeader('RateLimit-Remaining', String(result.remainingPoints));
      next();
    } catch (err) {
      if (err instanceof RateLimiterRes) {
        return next(new RateLimitError(Math.max(1, Math.ceil(err.msBeforeNext / 1000))));
      }
      next(err);
    }
  };
}
