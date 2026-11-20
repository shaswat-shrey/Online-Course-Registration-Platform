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
      const secrets = {
        STORAGE_SIGNING_SECRET: env.STORAGE_SIGNING_SECRET,
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
