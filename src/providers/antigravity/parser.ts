import type { AuthFile, JsonRecord } from '../../api/types';

export type AntigravityQuotaBucket = {
  id: string;
  label: string;
  window: string | null;
  remainingFraction: number;
  resetTime: string | null;
  resetAtMs: number | null;
  periodHours: number | null;
  description?: string;
};

export type AntigravityQuotaGroup = {
  id: string;
  label: string;
  description?: string;
  buckets: AntigravityQuotaBucket[];
};

export type AntigravitySubscription = {
  plan: 'free' | 'pro' | 'ultra' | 'ultra-lite' | 'unknown';
  tierId: string | null;
  tierName: string | null;
};

export type AntigravityQuotaData = {
  groups: AntigravityQuotaGroup[];
  subscription: AntigravitySubscription | null;
  serverTimeOffsetMs: number | null;
};

function record(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function text(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function projectField(value: unknown): string | null {
  const entry = record(value);
  if (!entry) return null;
  return text(entry.project_id ?? entry.projectId);
}

function parseDownload(value: string): JsonRecord | null {
  try {
    const parsed: unknown = JSON.parse(value.trim());
    return record(parsed);
  } catch {
    return null;
  }
}

export async function resolveAntigravityProjectId(
  file: AuthFile,
  download: (name: string) => Promise<string>,
): Promise<string | null> {
  const direct = text(file.project_id ?? file.projectId);
  if (direct) return direct;

  const metadata = projectField(file.metadata);
  if (metadata) return metadata;

  const attributes = record(file.attributes);
  const attributeProject = projectField(attributes);
  if (attributeProject) return attributeProject;
  const virtualProject = attributes ? text(attributes.gemini_virtual_project) : null;
  if (virtualProject) return virtualProject;

  try {
    const downloaded = parseDownload(await download(file.name));
    if (!downloaded) return null;
    const downloadedDirect = text(downloaded.project_id ?? downloaded.projectId);
    if (downloadedDirect) return downloadedDirect;
    const installed = projectField(downloaded.installed);
    if (installed) return installed;
    const web = projectField(downloaded.web);
    if (web) return web;
  } catch {
    return null;
  }

  return null;
}

function parsePayload(value: unknown): JsonRecord | null {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value.trim());
    } catch {
      return null;
    }
  }
  const entry = record(parsed);
  if (!entry) return null;
  const body = record(entry.body);
  if (body && (Array.isArray(body.groups) || 'models' in body)) return body;
  return entry;
}

function fraction(value: unknown): number | null {
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) return null;
    const percent = normalized.endsWith('%');
    const parsed = Number(percent ? normalized.slice(0, -1) : normalized);
    if (!Number.isFinite(parsed)) return null;
    const result = percent ? parsed / 100 : parsed;
    return result >= 0 && result <= 1 ? result : null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value >= 0 && value <= 1 ? value : null;
}

function stableId(value: string, fallback: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function periodHours(window: string | null): number | null {
  switch ((window ?? '').trim().toLowerCase()) {
    case '5h':
    case 'five-hour':
    case 'five_hour':
      return 5;
    case 'weekly':
    case 'week':
      return 168;
    default:
      return null;
  }
}

function bucketOrder(window: string | null): number {
  switch ((window ?? '').trim().toLowerCase()) {
    case '5h':
    case 'five-hour':
    case 'five_hour':
      return 0;
    case 'weekly':
    case 'week':
      return 1;
    default:
      return 2;
  }
}

function parseDate(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTier(value: unknown): { id: string | null; name: string | null } | null {
  const entry = record(value);
  if (!entry) return null;
  const id = text(entry.id);
  const name = text(entry.name);
  return id || name ? { id, name } : null;
}

export function parseAntigravitySubscription(payload: unknown): AntigravitySubscription | null {
  const parsed = parsePayload(payload);
  if (!parsed) return null;
  const current = parseTier(parsed.currentTier ?? parsed.current_tier);
  const paid = parseTier(parsed.paidTier ?? parsed.paid_tier);
  const tier = paid?.id ? paid : current;
  if (!tier) return null;
  const plans: Record<string, AntigravitySubscription['plan']> = {
    'free-tier': 'free',
    'g1-pro-tier': 'pro',
    'g1-ultra-tier': 'ultra',
    'g1-ultra-lite-tier': 'ultra-lite',
  };
  return { plan: tier.id ? plans[tier.id] ?? 'unknown' : 'unknown', tierId: tier.id, tierName: tier.name };
}

function dateOffset(headers: Record<string, string[]>, nowMs: number): number | null {
  const dateEntry = Object.entries(headers).find(([key]) => key.toLowerCase() === 'date')?.[1]?.[0];
  if (!dateEntry) return null;
  const serverMs = Date.parse(dateEntry);
  return Number.isFinite(serverMs) ? serverMs - nowMs : null;
}

export function parseAntigravityQuota(
  payload: unknown,
  headers: Record<string, string[]>,
  nowMs: number,
): AntigravityQuotaData {
  const parsed = parsePayload(payload);
  const rawGroups = parsed && Array.isArray(parsed.groups) ? parsed.groups : [];
  const groups = rawGroups.map((rawGroup, groupIndex): AntigravityQuotaGroup | null => {
    const group = record(rawGroup);
    if (!group) return null;
    const label = text(group.displayName ?? group.display_name) ?? `Quota Group ${groupIndex + 1}`;
    const groupId = stableId(label, `quota-group-${groupIndex + 1}`);
    const rawBuckets = Array.isArray(group.buckets) ? group.buckets : [];
    const buckets = rawBuckets.map((rawBucket, bucketIndex): AntigravityQuotaBucket | null => {
      const bucket = record(rawBucket);
      if (!bucket) return null;
      const remainingFraction = fraction(bucket.remainingFraction ?? bucket.remaining_fraction);
      if (remainingFraction === null) return null;
      const window = text(bucket.window);
      const id = text(bucket.bucketId ?? bucket.bucket_id) ?? `${groupId}-${window ?? `bucket-${bucketIndex + 1}`}`;
      const bucketLabel = text(bucket.displayName ?? bucket.display_name) ?? id;
      const resetTime = text(bucket.resetTime ?? bucket.reset_time);
      return {
        id,
        label: bucketLabel,
        window,
        remainingFraction,
        resetTime,
        resetAtMs: parseDate(resetTime),
        periodHours: periodHours(window),
        ...(text(bucket.description) ? { description: text(bucket.description) as string } : {}),
      };
    }).filter((bucket): bucket is AntigravityQuotaBucket => bucket !== null);
    buckets.sort((left, right) => bucketOrder(left.window) - bucketOrder(right.window) || left.label.localeCompare(right.label));
    return buckets.length ? {
      id: groupId,
      label,
      ...(text(group.description) ? { description: text(group.description) as string } : {}),
      buckets,
    } : null;
  }).filter((group): group is AntigravityQuotaGroup => group !== null);
  groups.sort((left, right) => left.label.localeCompare(right.label));

  const nestedSubscription = parsed?.subscription ?? parsed?.subscriptionSummary;
  return {
    groups,
    subscription: parseAntigravitySubscription(nestedSubscription),
    serverTimeOffsetMs: dateOffset(headers, nowMs),
  };
}
