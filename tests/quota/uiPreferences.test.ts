import { beforeEach, describe, expect, it } from 'vitest';
import {
  readUiPreferences,
  writeProviderPreference,
  writeSortModePreference,
} from '../../src/quota/uiPreferences';

const key = 'cpaQuota.uiState';

describe('quota UI preferences', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('reads corrupt or unsupported values as defaults', () => {
    expect(readUiPreferences()).toEqual({});
    sessionStorage.setItem(key, '{bad json');
    expect(readUiPreferences()).toEqual({});
    sessionStorage.setItem(key, JSON.stringify({ provider: 'secret', sortMode: 'fast', token: 'nope' }));
    expect(readUiPreferences()).toEqual({});
  });

  it('stores only provider and sortMode', () => {
    writeProviderPreference('codex');
    expect(JSON.parse(sessionStorage.getItem(key) ?? '')).toEqual({ provider: 'codex' });
    writeSortModePreference('soonest');
    expect(JSON.parse(sessionStorage.getItem(key) ?? '')).toEqual({ provider: 'codex', sortMode: 'soonest' });
  });

  it('preserves the other allowed field on each write', () => {
    sessionStorage.setItem(key, JSON.stringify({ provider: 'claude', sortMode: 'default' }));
    writeProviderPreference('xai');
    expect(readUiPreferences()).toEqual({ provider: 'xai', sortMode: 'default' });
    writeSortModePreference('soonest');
    expect(readUiPreferences()).toEqual({ provider: 'xai', sortMode: 'soonest' });
  });
});
