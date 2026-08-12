import type { Provider } from '../providers/types';

const PROVIDER_LABELS: Record<Provider, string> = {
  claude: 'Claude',
  antigravity: 'Antigravity',
  codex: 'Codex',
  xai: 'xAI',
  kimi: 'Kimi',
};

export async function buildAnonymousAccountLabel(provider: Provider, stableIdentifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableIdentifier));
  const bytes = new Uint8Array(digest);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `${PROVIDER_LABELS[provider]} · ${hex.slice(0, 6)}`;
}
