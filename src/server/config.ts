import { z } from 'zod';

export interface Config {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  appBaseUrl: string;
  trustProxy: boolean;
  databasePath: string;
  storageDir: string;
  retentionDays: number;
  displayTimezone: string;
  adminUser: string;
  adminPasswordHash: string;
  sessionSecret: string;
  adminAlertEmail?: string;
  gitlab: { url?: string; token?: string };
  github: { apiUrl: string; token?: string };
  smtp: {
    host?: string;
    port: number;
    secure: boolean;
    user?: string;
    pass?: string;
    from: string;
  };
  rateLimit: { loginPerMin: number; reportsPerMin: number };
}

export class ConfigError extends Error {}

const boolString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_BASE_URL: z.string().url(),
  TRUST_PROXY: boolString,
  DATABASE_PATH: z.string().default('./data/fixi.db'),
  STORAGE_DIR: z.string().default('./storage'),
  RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
  DISPLAY_TIMEZONE: z.string().default('Europe/Paris'),

  ADMIN_USER: z.string().min(1),
  ADMIN_PASSWORD_HASH: z
    .string()
    .regex(/^\$2[aby]\$\d{2}\$.{53}$/, 'must be a bcrypt hash (generate it with `npm run hash-password`)'),
  SESSION_SECRET: z.string().min(32, 'must contain at least 32 characters'),
  ADMIN_ALERT_EMAIL: z.string().email().optional(),

  GITLAB_URL: z.string().url().optional(),
  GITLAB_TOKEN: z.string().optional(),
  GITHUB_API_URL: z.string().url().default('https://api.github.com'),
  GITHUB_TOKEN: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: boolString,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('Fixi <fixi@localhost>'),
});

/** Reads and validates the environment. Throws a ConfigError with a readable message. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // `.env` files often contain `KEY=` for optional values: treat empty strings as unset.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new ConfigError(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    appBaseUrl: e.APP_BASE_URL.replace(/\/+$/, ''),
    trustProxy: e.TRUST_PROXY,
    databasePath: e.DATABASE_PATH,
    storageDir: e.STORAGE_DIR,
    retentionDays: e.RETENTION_DAYS,
    displayTimezone: e.DISPLAY_TIMEZONE,
    adminUser: e.ADMIN_USER,
    adminPasswordHash: e.ADMIN_PASSWORD_HASH,
    sessionSecret: e.SESSION_SECRET,
    adminAlertEmail: e.ADMIN_ALERT_EMAIL,
    gitlab: { url: e.GITLAB_URL?.replace(/\/+$/, ''), token: e.GITLAB_TOKEN },
    github: { apiUrl: e.GITHUB_API_URL.replace(/\/+$/, ''), token: e.GITHUB_TOKEN },
    smtp: {
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      secure: e.SMTP_SECURE,
      user: e.SMTP_USER,
      pass: e.SMTP_PASS,
      from: e.SMTP_FROM,
    },
    rateLimit: { loginPerMin: 5, reportsPerMin: 10 },
  };
}
