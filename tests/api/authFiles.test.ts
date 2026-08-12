import { describe, expect, it, vi } from 'vitest';
import fixture from '../fixtures/auth-files/duplicates.json';
import { createCpaApi, normalizeAuthFilesResponse } from '../../src/api/authFiles';
import type { AuthenticatedFetch } from '../../src/auth/types';
import type { JsonRecord } from '../../src/api/types';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('CPA auth-files boundary', () => {
  it('preserves typed raw nested fields and auth_index after normalization', () => {
    const raw: JsonRecord = {
      name: 'typed.json',
      auth_index: 'raw-index',
      id: 'credential-id',
      metadata: { account: 'metadata-account' },
      attributes: { project: 'metadata-project' },
      id_token: { email: 'user@example.com' },
      project_id: 'project-id',
      status: 'active',
      size: 42,
    };

    const [file] = normalizeAuthFilesResponse({ files: [raw] });
    const metadata = file?.metadata;
    const attributes = file?.attributes;
    const idToken = file?.id_token;

    expect(file?.auth_index).toBe('raw-index');
    expect(file?.authIndex).toBe('raw-index');
    expect(file?.id).toBe('credential-id');
    expect(metadata?.account).toBe('metadata-account');
    expect(attributes?.project).toBe('metadata-project');
    expect(idToken).toEqual({ email: 'user@example.com' });
    expect(file?.project_id).toBe('project-id');
    expect(file?.status).toBe('active');
    expect(file?.size).toBe(42);
  });

  it('deduplicates by name, merges missing fields, keeps records, and sorts filenames', async () => {
    const request = vi.fn<AuthenticatedFetch>(async () => jsonResponse({ files: fixture }));
    const api = createCpaApi(request);

    const files = await api.listAuthFiles();

    expect(files.map((file) => file.name)).toEqual(['a-unavailable.json', 'duplicate.json', 'z-runtime.json']);
    expect(files).toHaveLength(3);
    expect(files[0]?.unavailable).toBe(true);
    expect(files[2]?.runtime_only).toBe(true);

    const duplicate = files[1];
    expect(duplicate?.source).toBe('file');
    expect(duplicate?.path).toBe('/auth/duplicate.json');
    expect(duplicate?.email).toBe('fallback@example.com');
    expect(duplicate?.attributes).toEqual({ region: 'us' });
    expect(duplicate?.modified).toBe(Date.parse('2026-08-12T12:00:00.000Z'));
    expect(request).toHaveBeenCalledWith('/cpa/v0/management/auth-files', expect.objectContaining({
      method: 'GET',
      headers: { Accept: 'application/json' },
    }));
  });

  it('downloads an auth file using an encoded filename', async () => {
    const request = vi.fn<AuthenticatedFetch>(async () => new Response('{"provider":"antigravity"}'));
    const api = createCpaApi(request);

    await expect(api.downloadAuthFile('folder/name with spaces.json')).resolves.toBe('{"provider":"antigravity"}');
    expect(request).toHaveBeenCalledWith(
      '/cpa/v0/management/auth-files/download?name=folder%2Fname%20with%20spaces.json',
      expect.objectContaining({ method: 'GET', headers: { Accept: 'text/plain' } }),
    );
  });
});
