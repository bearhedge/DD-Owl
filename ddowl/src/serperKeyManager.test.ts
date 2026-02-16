import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SerperKeyManager } from './serperKeyManager.js';

// Mock axios so init() doesn't make real HTTP calls
vi.mock('axios', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: { balance: 100 } }),
    post: vi.fn(),
  },
}));

describe('SerperKeyManager', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('loads keys from SERPER_API_KEYS', () => {
    vi.stubEnv('SERPER_API_KEYS', 'key1,key2,key3');
    vi.stubEnv('SERPER_API_KEY', '');
    const mgr = new SerperKeyManager();
    expect(mgr.getActiveKey()).toBe('key1');
  });

  it('falls back to SERPER_API_KEY if SERPER_API_KEYS not set', () => {
    vi.stubEnv('SERPER_API_KEYS', '');
    vi.stubEnv('SERPER_API_KEY', 'single-key');
    const mgr = new SerperKeyManager();
    expect(mgr.getActiveKey()).toBe('single-key');
  });

  it('throws if no keys available', () => {
    vi.stubEnv('SERPER_API_KEYS', '');
    vi.stubEnv('SERPER_API_KEY', '');
    expect(() => new SerperKeyManager()).toThrow();
  });

  it('rotates when balance drops below threshold after init', async () => {
    vi.stubEnv('SERPER_API_KEYS', 'key1,key2');
    const mgr = new SerperKeyManager();
    await mgr.init(); // Sets both keys to 100 credits (mocked)
    // Burn 96 credits on key1 (100 → 4, below MIN_REMAINING=5)
    for (let i = 0; i < 96; i++) mgr.recordUsage();
    expect(mgr.getActiveKey()).toBe('key2');
  });

  it('rotateOnError moves to next key immediately', async () => {
    vi.stubEnv('SERPER_API_KEYS', 'key1,key2,key3');
    const mgr = new SerperKeyManager();
    await mgr.init();
    expect(mgr.getActiveKey()).toBe('key1');
    mgr.rotateOnError();
    expect(mgr.getActiveKey()).toBe('key2');
  });

  it('throws when all keys exhausted', async () => {
    vi.stubEnv('SERPER_API_KEYS', 'key1,key2');
    const mgr = new SerperKeyManager();
    await mgr.init(); // 100 credits each
    for (let i = 0; i < 96; i++) mgr.recordUsage(); // key1 exhausted
    for (let i = 0; i < 96; i++) mgr.recordUsage(); // key2 exhausted
    expect(() => mgr.getActiveKey()).toThrow(/all.*exhausted/i);
  });

  it('getStatus returns all keys with balances', async () => {
    vi.stubEnv('SERPER_API_KEYS', 'key1,key2');
    const mgr = new SerperKeyManager();
    await mgr.init();
    mgr.recordUsage();
    const status = mgr.getStatus();
    expect(status).toHaveLength(2);
    expect(status[0].balance).toBe(99);
    expect(status[0].masked).toBe('key1...');
    expect(status[0].active).toBe(true);
  });
});
