export type Sub2ApiUser = Record<string, unknown> & {
  id?: number | string;
  status?: string | null;
};

export type AuthenticatedFetch = (
  input: string | URL,
  init?: RequestInit & { timeoutMs?: number },
) => Promise<Response>;

export interface AuthenticatedSession {
  user: Sub2ApiUser;
  request: AuthenticatedFetch;
  signal: AbortSignal;
  invalidate(reason: string): void;
  destroy(): void;
}
