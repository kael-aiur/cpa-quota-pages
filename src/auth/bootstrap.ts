import { createAuthenticatedFetch } from './authenticatedFetch';
import type { AuthenticatedSession, Sub2ApiUser } from './types';

interface AuthMeResponse {
  code?: unknown;
  data?: unknown;
  message?: unknown;
}

function isUser(value: unknown): value is Sub2ApiUser {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readAuthMe(response: Response): Promise<Sub2ApiUser> {
  if (!response.ok) {
    throw new Error(`Sub2API 身份验证失败: HTTP ${response.status}`);
  }

  let body: AuthMeResponse;
  try {
    body = await response.json() as AuthMeResponse;
  } catch {
    throw new Error('Sub2API 身份验证失败: 响应不是有效 JSON');
  }
  if (body.code !== 0) {
    throw new Error(`Sub2API 身份验证失败: business code ${String(body.code)}`);
  }
  if (!isUser(body.data)) {
    throw new Error('Sub2API 身份验证失败: 用户数据为空');
  }
  if ('status' in body.data && body.data.status !== 'active') {
    throw new Error(`Sub2API 身份验证失败: 用户状态不是 active (${String(body.data.status)})`);
  }
  return body.data;
}

export async function bootstrapSub2ApiAuth(options: {
  url: URL;
  history: History;
  fetchImpl?: typeof fetch;
  onInvalidated?: (reason: string) => void;
}): Promise<AuthenticatedSession> {
  const tokenParam = options.url.searchParams.get('token');
  if (!tokenParam) {
    throw new Error('缺少认证 token');
  }

  const cleanedUrl = new URL(options.url.href);
  cleanedUrl.searchParams.delete('token');
  options.history.replaceState(null, '', `${cleanedUrl.pathname}${cleanedUrl.search}${cleanedUrl.hash}`);

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl('/api/v1/auth/me', {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${tokenParam}`,
      'Cache-Control': 'no-store',
    },
  });
  const user = await readAuthMe(response);

  let token: string | null = tokenParam;
  const rootController = new AbortController();
  const request = createAuthenticatedFetch({
    origin: options.url.origin,
    token: () => token,
    fetchImpl,
    rootSignal: rootController.signal,
    onInvalidated: (reason) => {
      token = null;
      if (!rootController.signal.aborted) rootController.abort(new Error(reason));
      options.onInvalidated?.(reason);
    },
  });

  return {
    user,
    request,
    signal: rootController.signal,
    invalidate(reason: string) {
      token = null;
      request.invalidate(reason);
    },
    destroy() {
      token = null;
      if (!rootController.signal.aborted) rootController.abort(new Error('会话已销毁'));
      request.destroy();
    },
  };
}
