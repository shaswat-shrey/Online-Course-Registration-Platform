import {
  ErrorCode,
  PUBLIC_SETTINGS,
  SETTING_KEYS,
  SETTINGS,
  type SettingKey,
  type SettingValue,
} from '@ucrams/shared';
import type { ActorContext } from '../../common/context/actor.js';
import { BusinessRuleError, NotFoundError } from '../../common/exceptions/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { recordAudit } from '../audit/audit.service.js';
import { assertGlobal } from '../authz/authz.js';

/** Settings change rarely; a short cache keeps hot paths (messaging rules, banner) off the database. */
const CACHE_MS = 30_000;
let cache: { at: number; values: Map<string, unknown> } | null = null;

async function loadAll() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.values;
  const rows = await prisma.systemSetting.findMany();
  const values = new Map<string, unknown>();
  for (const key of SETTING_KEYS) {
    const row = rows.find((r) => r.key === key);
    const parsed = row ? SETTINGS[key].schema.safeParse(row.value) : null;
    values.set(key, parsed?.success ? parsed.data : SETTINGS[key].default);
  }
  cache = { at: Date.now(), values };
  return values;
}

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  return (await loadAll()).get(key) as SettingValue<K>;
}

export function clearSettingsCache() {
  cache = null;
}

const describe = (key: SettingKey, value: unknown, updatedAt: Date | null) => ({
  key,
  value,
  default: SETTINGS[key].default,
  label: SETTINGS[key].label,
  description: SETTINGS[key].description,
  updatedAt: updatedAt?.toISOString() ?? null,
});

export async function listSettings(actor: ActorContext) {
  assertGlobal(actor, 'settings:manage');
  const [values, rows] = await Promise.all([loadAll(), prisma.systemSetting.findMany()]);
  return SETTING_KEYS.map((k) =>
    describe(k, values.get(k), rows.find((r) => r.key === k)?.updatedAt ?? null),
  );
}

export async function publicSettings() {
  const values = await loadAll();
  return Object.fromEntries(PUBLIC_SETTINGS.map((k) => [k, values.get(k)]));
}

export async function updateSetting(actor: ActorContext, key: string, value: unknown) {
  assertGlobal(actor, 'settings:manage');
  if (!(SETTING_KEYS as string[]).includes(key)) throw new NotFoundError('Setting');
  const k = key as SettingKey;
  const parsed = SETTINGS[k].schema.safeParse(
    typeof value === 'string' && value.trim() === '' && SETTINGS[k].default === null ? null : value,
  );
  if (!parsed.success)
    throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'Invalid value for this setting', {
      fields: [{ path: 'body.value', message: parsed.error.issues[0]?.message ?? 'Invalid value' }],
    });
  const before = await getSetting(k);
  const row = await prisma.systemSetting.upsert({
    where: { key: k },
    create: { key: k, value: parsed.data as never, updatedById: actor.userId },
    update: { value: parsed.data as never, updatedById: actor.userId },
  });
  clearSettingsCache();
  await recordAudit(actor, {
    action: 'settings.updated',
    entityType: 'SystemSetting',
    entityId: k,
    changes: { before, after: parsed.data } as never,
  });
  return describe(k, parsed.data, row.updatedAt);
}
