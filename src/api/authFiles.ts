import type { AuthenticatedFetch } from '../auth/types';
import { CpaApiError } from './errors';
import type { AuthFile, JsonRecord } from './types';

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readTextField(entry: JsonRecord, key: string): string {
  const value = entry[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readDateField(entry: JsonRecord): number {
  const candidates = [
    entry.modtime,
    entry.updated_at,
    entry.last_refresh,
    entry.modified,
    entry.updatedAt,
    entry.lastRefresh,
  ];

  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value < 1e12 ? value * 1000 : value;
    }
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) return parsed;
  }

  return 0;
}

function readBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return typeof value === 'string' && ['true', '1', 'yes'].includes(value.trim().toLowerCase());
}

function isRuntimeOnlyEntry(entry: JsonRecord): boolean {
  return readBoolean(entry.runtime_only ?? entry.runtimeOnly);
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function countMeaningfulFields(entry: JsonRecord): number {
  return Object.values(entry).reduce<number>(
    (count, value) => count + (hasMeaningfulValue(value) ? 1 : 0),
    0,
  );
}

function authFilePriorityScore(entry: JsonRecord): number {
  let score = 0;
  if (readTextField(entry, 'source').toLowerCase() === 'file') score += 32;
  if (readTextField(entry, 'path')) score += 16;
  if (!isRuntimeOnlyEntry(entry)) score += 8;
  if (!readBoolean(entry.disabled)) score += 4;
  if (readDateField(entry) > 0) score += 2;
  return score;
}

function compareAuthFileEntries(left: JsonRecord, right: JsonRecord): number {
  const scoreDifference = authFilePriorityScore(right) - authFilePriorityScore(left);
  if (scoreDifference !== 0) return scoreDifference;

  const dateDifference = readDateField(right) - readDateField(left);
  if (dateDifference !== 0) return dateDifference;

  return countMeaningfulFields(right) - countMeaningfulFields(left);
}

function mergeAuthFileEntries(entries: JsonRecord[]): JsonRecord {
  const [primary, ...rest] = [...entries].sort(compareAuthFileEntries);
  const merged: JsonRecord = { ...primary };

  for (const entry of rest) {
    for (const [key, value] of Object.entries(entry)) {
      if (!hasMeaningfulValue(merged[key]) && hasMeaningfulValue(value)) {
        merged[key] = value;
      }
    }
  }

  return merged;
}

const INTEGER_STRING_PATTERN = /^[+-]?\d+$/;

function readIntegerField(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || !INTEGER_STRING_PATTERN.test(trimmed)) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function normalizeAuthFileEntry(entry: JsonRecord): AuthFile {
  const statusMessage = readTextField(entry, 'status_message') || readTextField(entry, 'statusMessage');
  const email = readTextField(entry, 'email');
  const projectId = readTextField(entry, 'project_id') || readTextField(entry, 'projectId');
  const modified = readDateField(entry);
  const authIndex = entry.auth_index ?? entry.authIndex;
  const normalizedAuthIndex = typeof authIndex === 'string' ? authIndex.trim() : authIndex;

  return {
    ...entry,
    runtimeOnly: readBoolean(entry.runtime_only ?? entry.runtimeOnly),
    ...(normalizedAuthIndex !== undefined ? { authIndex: normalizedAuthIndex } : {}),
    ...(statusMessage ? { statusMessage } : {}),
    ...(modified > 0 ? { modified } : {}),
    priority: readIntegerField(entry.priority),
    weight: readIntegerField(entry.weight),
    ...(email ? { email } : {}),
    ...(projectId ? { projectId } : {}),
  } as AuthFile;
}

export function normalizeAuthFilesResponse(payload: unknown): AuthFile[] {
  const files = isRecord(payload) && Array.isArray(payload.files) ? payload.files : Array.isArray(payload) ? payload : [];
  const grouped = new Map<string, JsonRecord[]>();

  for (const value of files) {
    if (!isRecord(value)) continue;
    const name = readTextField(value, 'name');
    const key = name || JSON.stringify(value);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(value);
    else grouped.set(key, [value]);
  }

  const normalized = Array.from(grouped.values())
    .map((entries) => normalizeAuthFileEntry(mergeAuthFileEntries(entries)))
    .filter((entry) => typeof entry.name === 'string');

  normalized.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'accent' }));
  return normalized;
}

async function readJson(response: Response, operation: string): Promise<unknown> {
  if (!response.ok) {
    const bodyText = await response.text();
    throw new CpaApiError(bodyText.trim() || `HTTP ${response.status}`, { statusCode: response.status });
  }
  try {
    return await response.json();
  } catch (cause) {
    throw new CpaApiError(`${operation} 响应不是有效 JSON`, { statusCode: response.status, cause });
  }
}

export function createAuthFileApi(request: AuthenticatedFetch) {
  return {
    async listAuthFiles(signal?: AbortSignal): Promise<AuthFile[]> {
      const response = await request('/cpa/v0/management/auth-files', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal,
      });
      return normalizeAuthFilesResponse(await readJson(response, '认证文件列表'));
    },

    async downloadAuthFile(name: string, signal?: AbortSignal): Promise<string> {
      const response = await request(
        `/cpa/v0/management/auth-files/download?name=${encodeURIComponent(name)}`,
        { method: 'GET', headers: { Accept: 'text/plain' }, signal },
      );
      if (!response.ok) {
        const bodyText = await response.text();
        throw new CpaApiError(bodyText.trim() || `HTTP ${response.status}`, { statusCode: response.status });
      }
      return response.text();
    },
  };
}

export { createCpaApi } from './apiCall';
