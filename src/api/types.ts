import type { AuthenticatedFetch } from '../auth/types';

export type JsonRecord = Record<string, unknown>;

export interface AuthFile extends JsonRecord {
  name: string;
  id?: string;
  provider?: string;
  type?: string;
  source?: string;
  path?: string;
  account?: string;
  email?: string;
  projectId?: string;
  project_id?: string;
  authIndex?: string | number | null;
  auth_index?: string | number | null;
  metadata?: JsonRecord;
  attributes?: JsonRecord;
  id_token?: JsonRecord | string;
  runtimeOnly?: boolean | string;
  runtime_only?: boolean | string;
  disabled?: boolean | string | number;
  unavailable?: boolean | string | number;
  status?: string;
  size?: number;
  modified?: number;
  priority?: number;
  weight?: number;
  statusMessage?: string;
}

export interface ApiCallRequest {
  authIndex: string;
  method: 'GET' | 'POST';
  url: string;
  header: Record<string, string>;
  data?: string;
}

export interface ApiCallResult<T = unknown> {
  statusCode: number;
  header: Record<string, string[]>;
  bodyText: string;
  body: T | string | null;
}

export interface CpaApi {
  listAuthFiles(signal?: AbortSignal): Promise<AuthFile[]>;
  downloadAuthFile(name: string, signal?: AbortSignal): Promise<string>;
  apiCall<T>(
    request: ApiCallRequest,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<ApiCallResult<T>>;
}

export type CpaRequest = AuthenticatedFetch;
