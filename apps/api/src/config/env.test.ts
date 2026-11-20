import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379/0',
  STORAGE_SIGNING_SECRET: 'x'.repeat(40),
  JWT_ACCESS_SECRET: 'j'.repeat(40),
  MFA_ENCRYPTION_KEY: 'm'.repeat(40),
};

describe('parseEnv', () => {
  it('applies defaults for optional settings', () => {
    const env = parseEnv(base);
    expect(env.API_PORT).toBe(4000);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173']);
    expect(env.STORAGE_DRIVER).toBe('local');
  });

  it('parses comma-separated origins and booleans', () => {
    const env = parseEnv({
      ...base,
      CORS_ORIGINS: 'https://a.edu, https://b.edu',
      API_DOCS_ENABLED: 'false',
    });
    expect(env.CORS_ORIGINS).toEqual(['https://a.edu', 'https://b.edu']);
    expect(env.API_DOCS_ENABLED).toBe(false);
  });

  it('fails with a readable message when required values are missing', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects non-postgres database URLs and short secrets', () => {
    expect(() => parseEnv({ ...base, DATABASE_URL: 'mysql://x@y/z' })).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ ...base, STORAGE_SIGNING_SECRET: 'short' })).toThrow(
      /STORAGE_SIGNING_SECRET/,
    );
  });

  it('requires S3 credentials when the s3 driver is selected', () => {
    expect(() => parseEnv({ ...base, STORAGE_DRIVER: 's3' })).toThrow(/S3_ENDPOINT/);
  });

  it('refuses example secrets and enabled docs in production', () => {
    const prod = {
      ...base,
      NODE_ENV: 'production',
      STORAGE_SIGNING_SECRET: 'change-me-change-me-change-me-change-me',
    };
    expect(() => parseEnv(prod)).toThrow(/Insecure example value/);
    expect(() => parseEnv({ ...base, NODE_ENV: 'production' })).toThrow(/API_DOCS_ENABLED/);
    expect(() =>
      parseEnv({ ...base, NODE_ENV: 'production', API_DOCS_ENABLED: 'false' }),
    ).not.toThrow();
  });
});
