import { clearRateLimits } from './support';

/** Start every run with clean auth rate-limit counters (see clearRateLimits). */
export default async function globalSetup() {
  await clearRateLimits();
}
