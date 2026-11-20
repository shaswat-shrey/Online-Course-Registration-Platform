/* global __ENV, __VU */
/**
 * Registration load test (TESTING.md §6, NFR-PERF-002). Requires k6
 * (https://k6.io) — not an npm dependency.
 *
 *   k6 run -e BASE_URL=http://localhost:4000/api/v1 \
 *          -e PASSWORD=... -e SECTION_ID=<uuid> \
 *          -e EMAILS=a@x.edu,b@x.edu,... load/registration.k6.js
 *
 * Every virtual user signs in once (setup), then repeatedly checks
 * eligibility, registers (or joins the waitlist) and drops again, so the
 * section's seat counter is exercised under contention. Thresholds encode the
 * targets: p95 below 800 ms for registration and no unexpected errors.
 * Clear the auth rate-limit keys (ucrams:rl:*) before a large run.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const BASE = __ENV.BASE_URL || 'http://localhost:4000/api/v1';
const SECTION = __ENV.SECTION_ID;
const EMAILS = (__ENV.EMAILS || '').split(',').filter(Boolean);

export const options = {
  scenarios: {
    register: { executor: 'constant-vus', vus: Math.min(EMAILS.length, 50) || 1, duration: '1m' },
  },
  thresholds: {
    'http_req_duration{name:register}': ['p(95)<800'],
    'checks{name:register}': ['rate>0.99'],
  },
};

export function setup() {
  return EMAILS.map((email) => {
    const res = http.post(
      `${BASE}/auth/login`,
      JSON.stringify({ email, password: __ENV.PASSWORD }),
      {
        headers: { 'Content-Type': 'application/json' },
      },
    );
    return res.json('data.accessToken');
  });
}

export default function (tokens) {
  const token = tokens[(__VU - 1) % tokens.length];
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  http.get(`${BASE}/registrations/eligibility?sectionId=${SECTION}`, {
    headers,
    tags: { name: 'eligibility' },
  });
  const res = http.post(
    `${BASE}/registrations`,
    JSON.stringify({ sectionId: SECTION, joinWaitlist: true }),
    { headers: { ...headers, 'Idempotency-Key': uuidv4() }, tags: { name: 'register' } },
  );
  // 201 registered/waitlisted, 409 already registered or full, 422 a rule failed: all are correct answers.
  check(
    res,
    { 'register answered': (r) => [201, 409, 422].includes(r.status) },
    { name: 'register' },
  );
  if (res.status === 201) {
    const id = res.json('data.id');
    http.post(`${BASE}/registrations/${id}/drop`, JSON.stringify({}), {
      headers,
      tags: { name: 'drop' },
    });
  }
  sleep(0.5);
}
