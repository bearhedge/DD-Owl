const MIN_REMAINING = 50;
const DEFAULT_MAX_CREDITS = 2500;

export class SerperKeyManager {
  private keys: string[];
  private currentIndex = 0;
  private usageCount: Map<string, number> = new Map();
  private exhausted: Set<string> = new Set();
  private maxCredits: number;

  constructor(maxCredits?: number) {
    this.maxCredits = maxCredits ?? DEFAULT_MAX_CREDITS;

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

    for (const key of this.keys) {
      this.usageCount.set(key, 0);
    }

    console.log(`[SERPER] Key pool initialized: ${this.keys.length} key(s)`);
  }

  getActiveKey(): string {
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
    const used = (this.usageCount.get(key) || 0) + 1;
    this.usageCount.set(key, used);

    const remaining = this.maxCredits - used;
    if (remaining < MIN_REMAINING) {
      const masked = key.slice(0, 4) + '...';
      console.log(`[SERPER] Key #${this.currentIndex + 1} (${masked}) has ~${remaining} credits left — rotating`);
      this.exhausted.add(key);
      this.currentIndex = (this.currentIndex + 1) % this.keys.length;
    }
  }

  rotateOnError(): string {
    const oldKey = this.keys[this.currentIndex];
    const masked = oldKey.slice(0, 4) + '...';
    console.log(`[SERPER] Key #${this.currentIndex + 1} (${masked}) got API error — marking exhausted`);
    this.exhausted.add(oldKey);
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;
    return this.getActiveKey();
  }

  getStatus(): { index: number; masked: string; used: number; remaining: number; exhausted: boolean }[] {
    return this.keys.map((key, i) => {
      const used = this.usageCount.get(key) || 0;
      return {
        index: i,
        masked: key.slice(0, 4) + '...',
        used,
        remaining: this.maxCredits - used,
        exhausted: this.exhausted.has(key),
      };
    });
  }
}

let instance: SerperKeyManager | null = null;

export function getSerperKeyManager(): SerperKeyManager {
  if (!instance) {
    instance = new SerperKeyManager();
  }
  return instance;
}
