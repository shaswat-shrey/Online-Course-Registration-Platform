import 'dotenv/config';
import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const csv = z.string().transform((v) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

/** Values copied from .env.example that must never reach production. */
const INSECURE_DEFAULTS = ['change-me', 'ucrams_dev_password', 'minioadmin'];

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_VERSION: z.string().default('0.1.0'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    API_HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),

    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),

    CORS_ORIGINS: csv.default(['http://localhost:5173']),
    API_DOCS_ENABLED: bool.default(true),
    RATE_LIMIT_GLOBAL_PER_MINUTE: z.coerce.number().int().min(1).default(300),

    STORAGE_DRIVER: z.enum(['s3', 'local']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./storage'),
    STORAGE_SIGNING_SECRET: z.string().min(32),
    PUBLIC_API_URL: z.url().default('http://localhost:4000'),
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().default('ucrams'),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool.default(true),

    // Authentication (docs/SECURITY.md §2)
    JWT_ACCESS_SECRET: z.string().min(32),
    /** Previous signing secret, accepted for verification during key rotation. */
    JWT_ACCESS_SECRET_PREVIOUS: z.string().min(32).optional(),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    JWT_ISSUER: z.string().default('ucrams'),
    /** Encrypts two-factor secrets at rest (AES-256-GCM). Changing it invalidates enrolments. */
    MFA_ENCRYPTION_KEY: z.string().min(32),
    REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    REFRESH_REMEMBER_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().min(0).max(60).default(10),
    COOKIE_SECURE: bool.optional(),
    LOCKOUT_THRESHOLD: z.coerce.number().int().min(1).default(5),
    LOCKOUT_BASE_MINUTES: z.coerce.number().int().min(1).default(15),
    LOCKOUT_MAX_MINUTES: z.coerce.number().int().min(1).default(1440),
    RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
    INVITE_TOKEN_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(72),
    ARGON2_MEMORY_KIB: z.coerce.number().int().min(8192).default(19456),
    ARGON2_TIME_COST: z.coerce.number().int().min(1).default(2),
    /** Public URL of the web app, used in email links. */
    WEB_APP_URL: z.url().default('http://localhost:5173'),

    MAIL_TRANSPORT: z.enum(['smtp', 'log']).default('log'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().default(1025),
    SMTP_SECURE: bool.default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    MAIL_FROM: z.string().default('UCRAMS <no-reply@ucrams.local>'),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === 's3') {
      for (const key of ['S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const) {
        if (!env[key])
          ctx.addIssue({ code: 'custom', path: [key], message: 'Required for s3 storage' });
      }
    }
    if (env.MAIL_TRANSPORT === 'smtp' && !env.SMTP_HOST) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: 'Required for smtp transport' });
    }
    if (env.NODE_ENV === 'production') {
      if (env.COOKIE_SECURE === false) {
        ctx.addIssue({
          code: 'custom',
          path: ['COOKIE_SECURE'],
          message: 'Cookies must be Secure in production',
        });
      }
      const secrets = {
        JWT_ACCESS_SECRET: env.JWT_ACCESS_SECRET,
        STORAGE_SIGNING_SECRET: env.STORAGE_SIGNING_SECRET,
        MFA_ENCRYPTION_KEY: env.MFA_ENCRYPTION_KEY,
        DATABASE_URL: env.DATABASE_URL,
        ...(env.STORAGE_DRIVER === 's3' ? { S3_SECRET_KEY: env.S3_SECRET_KEY ?? '' } : {}),
      };
      for (const [key, value] of Object.entries(secrets)) {
        if (INSECURE_DEFAULTS.some((d) => value.includes(d))) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'Insecure example value in production',
          });
        }
      }
      if (env.API_DOCS_ENABLED) {
        ctx.addIssue({
          code: 'custom',
          path: ['API_DOCS_ENABLED'],
          message: 'API docs must be disabled in production (or protected; see SECURITY.md)',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Secure cookies default to on in production and off for plain-HTTP local development. */
export function cookieSecure(e: Env): boolean {
  return e.COOKIE_SECURE ?? e.NODE_ENV === 'production';
}

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

/** Validated configuration. Importing this module fails fast on invalid env. */
export const env: Env = parseEnv(process.env);
