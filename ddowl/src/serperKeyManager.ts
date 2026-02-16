import axios from 'axios';

const MIN_REMAINING = 5;

export class SerperKeyManager {
  private keys: string[];
  private currentIndex = 0;
  private balances: Map<string, number> = new Map();
  private exhausted: Set<string> = new Set();
  private initialized = false;

  constructor() {
    const multiKeys = process.env.SERPER_API_KEYS || '';
    const singleKey = process.env.SERPER_API_KEY || '';

    if (multiKeys) {
      this.keys = multiKeys.split(',').map(k => k.trim()).filter(Boolean);
    } else if (singleKey) {
      this.keys = [singleKey];
    } else {
      this.keys = [];
    }

    if (this.keys.length === 0) {
      throw new Error('[SERPER] No API keys configured. Set SERPER_API_KEYS or SERPER_API_KEY.');
    }

    // Start with 0 balance until we fetch real ones
    for (const key of this.keys) {
      this.balances.set(key, 0);
    }

    console.log(`[SERPER] Key pool initialized: ${this.keys.length} key(s)`);
  }

  /** Fetch real balance from Serper /account endpoint for a single key */
  private async fetchBalance(key: string): Promise<number> {
    try {
      const res = await axios.get('https://google.serper.dev/account', {
        headers: { 'X-API-KEY': key },
        timeout: 5000,
      });
      return res.data?.balance ?? 0;
    } catch {
      return 0;
    }
  }

  /** Fetch real balances for all keys. Call on startup. */
  async init(): Promise<void> {
    const results = await Promise.all(
      this.keys.map(async (key, i) => {
        const balance = await this.fetchBalance(key);
        this.balances.set(key, balance);
        const masked = key.slice(0, 4) + '...';
        if (balance <= MIN_REMAINING) {
          this.exhausted.add(key);
          console.log(`[SERPER] Key #${i + 1} (${masked}): ${balance} credits — EXHAUSTED`);
        } else {
          console.log(`[SERPER] Key #${i + 1} (${masked}): ${balance} credits`);
        }
        return balance;
      })
    );

    // Start with the key that has the most credits
    let bestIdx = 0;
    let bestBalance = 0;
    for (let i = 0; i < this.keys.length; i++) {
      const bal = this.balances.get(this.keys[i]) || 0;
      if (bal > bestBalance) {
        bestBalance = bal;
        bestIdx = i;
      }
    }
    this.currentIndex = bestIdx;
    this.initialized = true;

    const totalCredits = results.reduce((a, b) => a + b, 0);
    const activeKeys = this.keys.length - this.exhausted.size;
    console.log(`[SERPER] Ready: ${activeKeys}/${this.keys.length} keys active, ${totalCredits} total credits`);
  }

  getActiveKey(): string {
    // Find a non-exhausted key with credits
    for (let i = 0; i < this.keys.length; i++) {
      const idx = (this.currentIndex + i) % this.keys.length;
      const key = this.keys[idx];
      if (!this.exhausted.has(key)) {
        this.currentIndex = idx;
        return key;
      }
    }
    throw new Error(`[SERPER] All ${this.keys.length} API keys exhausted. No credits remaining.`);
  }

  recordUsage(): void {
    const key = this.keys[this.currentIndex];
    const balance = (this.balances.get(key) || 0) - 1;
    this.balances.set(key, Math.max(0, balance));

    if (balance <= MIN_REMAINING) {
      const masked = key.slice(0, 4) + '...';
      console.log(`[SERPER] Key #${this.currentIndex + 1} (${masked}) down to ${balance} credits — rotating`);
      this.exhausted.add(key);
      this.currentIndex = (this.currentIndex + 1) % this.keys.length;

      // Log what we're rotating to
      const nextKey = this.keys[this.currentIndex];
      const nextBalance = this.balances.get(nextKey) || 0;
      const nextMasked = nextKey.slice(0, 4) + '...';
      if (!this.exhausted.has(nextKey)) {
        console.log(`[SERPER] Now using Key #${this.currentIndex + 1} (${nextMasked}): ${nextBalance} credits`);
      }
    }
  }

  rotateOnError(): string {
    const oldKey = this.keys[this.currentIndex];
    const masked = oldKey.slice(0, 4) + '...';
    console.log(`[SERPER] Key #${this.currentIndex + 1} (${masked}) got API error — marking exhausted`);
    this.exhausted.add(oldKey);
    this.balances.set(oldKey, 0);
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;
    return this.getActiveKey();
  }

  /** Re-check a specific key's balance (e.g. after a reset date) */
  async refreshKey(index: number): Promise<void> {
    if (index < 0 || index >= this.keys.length) return;
    const key = this.keys[index];
    const balance = await this.fetchBalance(key);
    const masked = key.slice(0, 4) + '...';
    this.balances.set(key, balance);
    if (balance > MIN_REMAINING) {
      this.exhausted.delete(key);
      console.log(`[SERPER] Key #${index + 1} (${masked}) refreshed: ${balance} credits — back in rotation`);
    } else {
      console.log(`[SERPER] Key #${index + 1} (${masked}) refreshed: ${balance} credits — still exhausted`);
    }
  }

  /** Re-check all keys. Brings reset keys back into rotation. */
  async refreshAll(): Promise<void> {
    for (let i = 0; i < this.keys.length; i++) {
      await this.refreshKey(i);
    }
    // Switch to the key with most credits
    let bestIdx = this.currentIndex;
    let bestBalance = 0;
    for (let i = 0; i < this.keys.length; i++) {
      const bal = this.balances.get(this.keys[i]) || 0;
      if (bal > bestBalance && !this.exhausted.has(this.keys[i])) {
        bestBalance = bal;
        bestIdx = i;
      }
    }
    this.currentIndex = bestIdx;
  }

  getStatus(): { index: number; masked: string; balance: number; exhausted: boolean; active: boolean }[] {
    return this.keys.map((key, i) => ({
      index: i,
      masked: key.slice(0, 4) + '...',
      balance: this.balances.get(key) || 0,
      exhausted: this.exhausted.has(key),
      active: i === this.currentIndex,
    }));
  }

  getTotalCredits(): number {
    let total = 0;
    for (const key of this.keys) {
      if (!this.exhausted.has(key)) {
        total += this.balances.get(key) || 0;
      }
    }
    return total;
  }
}

let instance: SerperKeyManager | null = null;

export function getSerperKeyManager(): SerperKeyManager {
  if (!instance) {
    instance = new SerperKeyManager();
  }
  return instance;
}
