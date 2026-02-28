import { RelayPool } from "snstr";
import { QUERY_TIMEOUT } from "./constants.js";

/**
 * Extended RelayPool with compatibility methods for existing codebase
 */
export class CompatibleRelayPool extends RelayPool {
  private readonly defaultQueryTimeoutMs: number;

  constructor(relays: string[] = []) {
    super(relays);
    this.defaultQueryTimeoutMs = QUERY_TIMEOUT;
  }

  private withHardTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const safeTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : QUERY_TIMEOUT;
      const timer = setTimeout(() => {
        reject(new Error(`Query timed out after ${safeTimeoutMs}ms`));
      }, safeTimeoutMs);

      operation().then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private getTimeoutMs(override?: number): number {
    const candidate = Number.isInteger(override) ? override : this.defaultQueryTimeoutMs;
    return typeof candidate === "number" && candidate > 0 ? candidate : this.defaultQueryTimeoutMs;
  }

  /**
   * Compatibility method to match existing codebase API
   * Maps to snstr's querySync method
   */
  async get(
    relays: string[],
    filter: NostrFilter,
    options: { timeout?: number; timeoutMs?: number } = {},
  ): Promise<NostrEvent | null> {
    const timeoutMs = this.getTimeoutMs(options.timeout ?? options.timeoutMs);
    try {
      const events = await this.withHardTimeout(
        () => this.querySync(relays, filter, { timeout: timeoutMs }),
        timeoutMs,
      );
      return events.length > 0 ? events[0] : null;
    } catch (error) {
      console.error('Error in pool.get:', error);
      return null;
    }
  }

  /**
   * Compatibility method to match existing codebase API  
   * Maps to snstr's querySync method for multiple events
   */
  async getMany(
    relays: string[],
    filter: NostrFilter,
    options: { timeout?: number; timeoutMs?: number } = {},
  ): Promise<NostrEvent[]> {
    const timeoutMs = this.getTimeoutMs(options.timeout ?? options.timeoutMs);
    try {
      return await this.withHardTimeout(
        () => this.querySync(relays, filter, { timeout: timeoutMs }),
        timeoutMs,
      );
    } catch (error) {
      console.error('Error in pool.getMany:', error);
      return [];
    }
  }

  /**
   * Compatibility method to match existing codebase API
   * Maps to snstr's close method but ignores relay parameter
   */
  async close(_relays?: string[]): Promise<void> {
    try {
      await super.close();
    } catch (error) {
      console.error('Error in pool.close:', error);
    }
  }
}

/**
 * Create a fresh RelayPool instance for making Nostr requests
 * @returns A new CompatibleRelayPool instance
 */
export function getFreshPool(relays: string[] = []): CompatibleRelayPool {
  return new CompatibleRelayPool(relays);
}

/**
 * Interface for Nostr events
 */
export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/**
 * Interface for Nostr filter parameters
 */
export interface NostrFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  [key: string]: unknown;
  [key: `#${string}`]: string[];
} 
