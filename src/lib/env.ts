import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  PIN_PEPPER: z.string().min(16, 'PIN_PEPPER must be at least 16 characters'),
  TOTP_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'TOTP_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)'),
  CRON_SECRET: z.string().min(16, 'CRON_SECRET must be at least 16 characters'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  MESSAGING_PROVIDER: z.enum(['prepare', 'send']).default('prepare'),
  WHATSAPP_API_TOKEN: z.string().optional().default(''),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(''),
  MEMBER_SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  ADMIN_SESSION_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  MAX_LOGIN_FAILURES: z.coerce.number().int().min(3).max(20).default(5),
  LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  REVERSAL_APPROVAL_THRESHOLD_PAISE: z.coerce.number().int().min(0).default(100_000),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

/**
 * Parses and validates environment variables. Throws immediately if any required
 * variable is missing or malformed.
 */
export function parseEnv(rawEnv: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(rawEnv);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return result.data;
}

/**
 * Returns the validated environment object, caching it across calls in the process.
 */
export function getEnv(): Env {
  if (!cachedEnv) {
    cachedEnv = parseEnv(process.env);
  }
  return cachedEnv;
}

/**
 * Resets the cached environment object (for isolated test suites only).
 */
export function resetEnvCacheForTests(): void {
  cachedEnv = null;
}
