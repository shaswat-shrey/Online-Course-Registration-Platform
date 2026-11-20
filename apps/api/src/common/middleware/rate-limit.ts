import type { RequestHandler } from 'express';
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { redis } from '../../infrastructure/redis/redis.js';
import { RateLimitError, ServiceUnavailableError } from '../exceptions/app-error.js';

type Req = Parameters<RequestHandler>[0];

interface LimiterOptions {
  name: string;
  points: number;
  durationSeconds: number;
  key: (req: Req) => string;
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

/**
 * Fail-closed limiter for authentication endpoints: if Redis is unavailable the
 * request is refused (503) rather than allowing unlimited guessing (SECURITY.md §8).
 * Accepts several buckets (e.g. per IP and per IP+identifier); all must allow.
 */
export function strictRateLimit(buckets: LimiterOptions[]): RequestHandler {
  const limiters = buckets.map(
    (b) =>
      [
        b,
        new RateLimiterRedis({
          storeClient: redis,
          keyPrefix: `rl:${b.name}`,
          points: b.points,
          duration: b.durationSeconds,
        }),
      ] as const,
  );
  return async (req, _res, next) => {
    try {
      for (const [bucket, limiter] of limiters) await limiter.consume(bucket.key(req));
      next();
    } catch (err) {
      if (err instanceof RateLimiterRes) {
        return next(new RateLimitError(Math.max(1, Math.ceil(err.msBeforeNext / 1000))));
      }
      next(new ServiceUnavailableError('Authentication is temporarily unavailable'));
    }
  };
}

/**
 * Per-user limit for endpoints that create content other people receive
 * (messages, posts, tickets, feedback) or that are expensive (exports).
 * Runs after authentication, so it keys on the caller, not the IP.
 */
export function userRateLimit(
  name: string,
  points: number,
  durationSeconds: number,
): RequestHandler {
  return rateLimit({
    name: `user-${name}`,
    points,
    durationSeconds,
    key: (req) =>
      (req as Req & { actor?: { userId: string } }).actor?.userId ?? req.ip ?? 'anonymous',
  });
}
