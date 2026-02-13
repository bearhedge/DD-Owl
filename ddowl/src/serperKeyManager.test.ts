import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SerperKeyManager } from './serperKeyManager.js';

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

  it('rotates when credits drop below threshold', () => {
    vi.stubEnv('SERPER_API_KEYS', 'key1,key2');
    const mgr = new SerperKeyManager(100); // 100 max credits for testing
    // Use 51 credits on key1 (100 - 51 = 49, below threshold of 50)
    for (let i = 0; i < 51; i++) mgr.recordUsage();
    expect(mgr.getActiveKey()).toBe('key2');
  });

  it('rotateOnError moves to next key immediately', () => {
    vi.stubEnv('SERPER_API_KEYS', 'key1,key2,key3');
    const mgr = new SerperKeyManager();
    expect(mgr.getActiveKey()).toBe('key1');
    mgr.rotateOnError();
    expect(mgr.getActiveKey()).toBe('key2');
  });

  it('throws when all keys exhausted', () => {
    vi.stubEnv('SERPER_API_KEYS', 'key1,key2');
    const mgr = new SerperKeyManager(60); // 60 max
    for (let i = 0; i < 11; i++) mgr.recordUsage(); // key1: 49 left → rotates
    for (let i = 0; i < 11; i++) mgr.recordUsage(); // key2: 49 left → rotates
    expect(() => mgr.getActiveKey()).toThrow(/all.*exhausted/i);
  });

  it('getStatus returns all keys with remaining credits', () => {
    vi.stubEnv('SERPER_API_KEYS', 'key1,key2');
    const mgr = new SerperKeyManager(2500);
    mgr.recordUsage();
    const status = mgr.getStatus();
    expect(status).toHaveLength(2);
    expect(status[0].remaining).toBe(2499);
    expect(status[0].masked).toBe('key1...');
  });
});
