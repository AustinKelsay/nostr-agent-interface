import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { generateKeypair, encodeNoteId, encodeEvent, encodeAddress } from 'snstr';
import { NostrEvent } from '../utils/index.js';
import { 
  processZapReceipt, 
  validateZapReceipt, 
  formatZapReceipt,
  parseZapRequestData,
  determineZapDirection,
  decodeEventId,
  decodeBolt11FromZap,
  getAmountFromDecodedInvoice,
  prepareAnonymousZap,
  extractLnurlFromProfileMetadata,
  normalizeLnurlToUrl,
  isValidUrl,
  ZapCache,
  ZapReceipt,
} from '../zap/zap-tools.js';

describe('Zap Processing Functions', () => {
  let testKeys: { publicKey: string; privateKey: string };
  let zapperKeys: { publicKey: string; privateKey: string };
  const originalConsoleError = console.error;
  
  beforeAll(async () => {
    console.error = () => {};
    testKeys = await generateKeypair();
    zapperKeys = await generateKeypair();
  });

  afterAll(() => {
    console.error = originalConsoleError;
  });

  describe('validateZapReceipt', () => {
    it('should validate a proper zap receipt', () => {
      const zapReceipt: NostrEvent = {
        id: 'test-id',
        pubkey: zapperKeys.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 9735,
        tags: [
          ['p', testKeys.publicKey],
          ['bolt11', 'lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq8rkx3yf5tcsyz3d73gafnh3cax9rn449d9p5uxz9ezhhypd0elx87sjle52x86fux2ypatgddc6k63n7erqz25le42c4u4ecky03ylcqca784w'],
          ['description', JSON.stringify({ 
            kind: 9734, 
            content: 'Test zap',
            tags: [['p', testKeys.publicKey]],
            pubkey: 'sender-pubkey'
          })]
        ],
        content: '',
        sig: 'test-sig'
      };

      const result = validateZapReceipt(zapReceipt);
      
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should reject invalid kind', () => {
      const invalidReceipt: NostrEvent = {
        id: 'test-id',
        pubkey: zapperKeys.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 1, // Wrong kind
        tags: [],
        content: '',
        sig: 'test-sig'
      };

      const result = validateZapReceipt(invalidReceipt);
      
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Not a zap receipt');
    });

    it('should reject missing bolt11 tag', () => {
      const invalidReceipt: NostrEvent = {
        id: 'test-id',
        pubkey: zapperKeys.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 9735,
        tags: [
          ['p', testKeys.publicKey],
          ['description', '{}'] // Missing bolt11
        ],
        content: '',
        sig: 'test-sig'
      };

      const result = validateZapReceipt(invalidReceipt);
      
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Missing bolt11');
    });

    it('should reject missing description tag', () => {
      const invalidReceipt: NostrEvent = {
        id: 'missing-description',
        pubkey: zapperKeys.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 9735,
        tags: [
          ['p', testKeys.publicKey],
          ['bolt11', 'lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq8rkx3yf5tcsyz3d73gafnh3cax9rn449d9p5uxz9ezhhypd0elx87sjle52x86fux2ypatgddc6k63n7erqz25le42c4u4ecky03ylcqca784w'],
        ],
        content: '',
        sig: 'test-sig'
      };

      const result = validateZapReceipt(invalidReceipt);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Missing description');
    });

    it('should reject invalid zap request json in description', () => {
      const invalidReceipt: NostrEvent = {
        id: 'invalid-description-json',
        pubkey: zapperKeys.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 9735,
        tags: [
          ['p', testKeys.publicKey],
          ['bolt11', 'lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq8rkx3yf5tcsyz3d73gafnh3cax9rn449d9p5uxz9ezhhypd0elx87sjle52x86fux2ypatgddc6k63n7erqz25le42c4u4ecky03ylcqca784w'],
          ['description', '{bad json'],
        ],
        content: '',
        sig: 'test-sig'
      };

      const result = validateZapReceipt(invalidReceipt);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid zap request JSON');
    });

    it('should reject invalid zap request kind', () => {
      const invalidReceipt: NostrEvent = {
        id: 'invalid-zap-request-kind',
        pubkey: zapperKeys.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 9735,
        tags: [
          ['p', testKeys.publicKey],
          ['bolt11', 'lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq8rkx3yf5tcsyz3d73gafnh3cax9rn449d9p5uxz9ezhhypd0elx87sjle52x86fux2ypatgddc6k63n7erqz25le42c4u4ecky03ylcqca784w'],
          ['description', JSON.stringify({
            kind: 1,
            content: 'bad kind',
            tags: [['p', testKeys.publicKey]],
            pubkey: 'sender-pubkey'
          })],
        ],
        content: '',
        sig: 'test-sig'
      };

      const result = validateZapReceipt(invalidReceipt);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid zap request kind');
    });

    it('should reject recipient pubkey mismatch', () => {
      const invalidReceipt: NostrEvent = {
        id: 'recipient-mismatch',
        pubkey: zapperKeys.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 9735,
        tags: [
          ['p', 'different-recipient'],
          ['bolt11', 'lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq8rkx3yf5tcsyz3d73gafnh3cax9rn449d9p5uxz9ezhhypd0elx87sjle52x86fux2ypatgddc6k63n7erqz25le42c4u4ecky03ylcqca784w'],
          ['description', JSON.stringify({
            kind: 9734,
            content: 'recipient mismatch',
            tags: [['p', testKeys.publicKey]],
            pubkey: 'sender-pubkey'
          })],
        ],
        content: '',
        sig: 'test-sig'
      };

      const result = validateZapReceipt(invalidReceipt);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Recipient pubkey mismatch');
    });

    it('should reject event id mismatch when e tag is present', () => {
      const invalidReceipt: NostrEvent = {
        id: 'event-mismatch',
        pubkey: zapperKeys.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 9735,
        tags: [
          ['p', testKeys.publicKey],
          ['e', 'event-on-receipt'],
          ['bolt11', 'lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq8rkx3yf5tcsyz3d73gafnh3cax9rn449d9p5uxz9ezhhypd0elx87sjle52x86fux2ypatgddc6k63n7erqz25le42c4u4ecky03ylcqca784w'],
          ['description', JSON.stringify({
            kind: 9734,
            content: 'event mismatch',
            tags: [['p', testKeys.publicKey], ['e', 'event-on-request']],
            pubkey: 'sender-pubkey'
          })],
        ],
        content: '',
        sig: 'test-sig'
      };

      const result = validateZapReceipt(invalidReceipt);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Event ID mismatch');
    });
  });

  describe('parseZapRequestData', () => {
    it('should parse zap request from description tag', () => {
      const zapRequest = {
        kind: 9734,
        content: 'Great post!',
        tags: [
          ['p', testKeys.publicKey],
          ['amount', '100000']
        ],
        pubkey: 'sender-pubkey',
        created_at: Math.floor(Date.now() / 1000)
      };

      const zapReceipt: NostrEvent = {
        id: 'test-id',
        pubkey: zapperKeys.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 9735,
        tags: [
          ['p', testKeys.publicKey],
          ['bolt11', 'lnbc1pvjluez'],
          ['description', JSON.stringify(zapRequest)]
        ],
        content: '',
        sig: 'test-sig'
      };

      const result = parseZapRequestData(zapReceipt);
      
      expect(result).toBeDefined();
      expect(result?.content).toBe('Great post!');
      expect(result?.pubkey).toBe('sender-pubkey');
      expect(result?.amount).toBe(100000);
    });

    it('should parse optional relays, event id, and lnurl tags', () => {
      const zapRequest = {
        kind: 9734,
        content: 'optional tags',
        tags: [
          ['p', testKeys.publicKey],
          ['amount', '21000'],
          ['relays', 'wss://relay.one', 'wss://relay.two'],
          ['e', 'event-id-123'],
          ['lnurl', 'https://ln.example/zap'],
        ],
        pubkey: 'sender-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        id: 'request-id',
        sig: 'request-sig',
      };

      const zapReceipt: NostrEvent = {
        id: 'test-id-optional-tags',
        pubkey: zapperKeys.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 9735,
        tags: [
          ['p', testKeys.publicKey],
          ['bolt11', 'lnbc1pvjluez'],
          ['description', JSON.stringify(zapRequest)]
        ],
        content: '',
        sig: 'test-sig'
      };

      const result = parseZapRequestData(zapReceipt);
      expect(result?.relays).toEqual(['wss://relay.one', 'wss://relay.two']);
      expect(result?.event).toBe('event-id-123');
      expect(result?.lnurl).toBe('https://ln.example/zap');
    });

    it('should handle missing description tag', () => {
      const zapReceipt: NostrEvent = {
        id: 'test-id',
        pubkey: zapperKeys.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 9735,
        tags: [
          ['p', testKeys.publicKey],
          ['bolt11', 'lnbc10u1p...']
        ],
        content: '',
        sig: 'test-sig'
      };

      const result = parseZapRequestData(zapReceipt);
      
      expect(result).toBeUndefined();
    });
  });

  describe('determineZapDirection', () => {
    it('should identify received zaps', () => {
      const zapReceipt: ZapReceipt = {
        id: 'test-id',
        pubkey: zapperKeys.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 9735,
        tags: [
          ['p', testKeys.publicKey], // Recipient
          ['P', 'sender-pubkey'] // Sender
        ],
        content: '',
        sig: 'test-sig'
      };

      const direction = determineZapDirection(zapReceipt, testKeys.publicKey);
      
      expect(direction).toBe('received');
    });

    it('should identify sent zaps', () => {
      const zapReceipt: ZapReceipt = {
        id: 'test-id',
        pubkey: zapperKeys.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 9735,
        tags: [
          ['p', 'recipient-pubkey'], // Recipient
          ['P', testKeys.publicKey] // Sender
        ],
        content: '',
        sig: 'test-sig'
      };

      const direction = determineZapDirection(zapReceipt, testKeys.publicKey);
      
      expect(direction).toBe('sent');
    });

    it('should identify self zaps', () => {
      const zapReceipt: ZapReceipt = {
        id: 'test-id',
        pubkey: zapperKeys.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 9735,
        tags: [
          ['p', testKeys.publicKey], // Recipient
          ['P', testKeys.publicKey] // Sender (same)
        ],
        content: '',
        sig: 'test-sig'
      };

      const direction = determineZapDirection(zapReceipt, testKeys.publicKey);
      
      expect(direction).toBe('self');
    });

    it('should fall back to sender pubkey from description when P tag is missing', () => {
      const zapRequest = {
        kind: 9734,
        content: 'sent via fallback',
        tags: [['p', 'recipient-pubkey']],
        pubkey: testKeys.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        id: 'fallback-id',
        sig: 'fallback-sig',
      };

      const zapReceipt: ZapReceipt = {
        id: 'fallback-sender',
        pubkey: zapperKeys.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 9735,
        tags: [
          ['p', 'recipient-pubkey'],
          ['description', JSON.stringify(zapRequest)],
        ],
        content: '',
        sig: 'test-sig'
      };

      const direction = determineZapDirection(zapReceipt, testKeys.publicKey);
      expect(direction).toBe('sent');
    });

    it('should return unknown when neither sender nor recipient matches context', () => {
      const zapReceipt: ZapReceipt = {
        id: 'unknown-direction',
        pubkey: zapperKeys.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 9735,
        tags: [
          ['p', 'recipient-other'],
          ['P', 'sender-other']
        ],
        content: '',
        sig: 'test-sig'
      };

      const direction = determineZapDirection(zapReceipt, testKeys.publicKey);
      expect(direction).toBe('unknown');
    });
  });

  describe('decodeBolt11FromZap', () => {
    it('should return undefined when bolt11 tag is missing', () => {
      const receipt: NostrEvent = {
        id: 'no-bolt11',
        pubkey: zapperKeys.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 9735,
        tags: [['p', testKeys.publicKey]],
        content: '',
        sig: 'sig',
      };
      expect(decodeBolt11FromZap(receipt)).toBeUndefined();
    });

    it('should return undefined for invalid bolt11 payloads', () => {
      const receipt: NostrEvent = {
        id: 'invalid-bolt11',
        pubkey: zapperKeys.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 9735,
        tags: [['bolt11', 'definitely-not-a-bolt11-invoice']],
        content: '',
        sig: 'sig',
      };
      expect(decodeBolt11FromZap(receipt)).toBeUndefined();
    });
  });

  describe('getAmountFromDecodedInvoice', () => {
    it('should convert millisats to sats', () => {
      const decodedInvoice = { sections: [{ name: 'amount', value: 123456 }] };
      expect(getAmountFromDecodedInvoice(decodedInvoice)).toBe(123);
    });

    it('should return undefined when amount section is missing', () => {
      const decodedInvoice = { sections: [{ name: 'payment_hash', value: 'abc' }] };
      expect(getAmountFromDecodedInvoice(decodedInvoice)).toBeUndefined();
    });

    it('should return undefined for malformed decoded invoices', () => {
      expect(getAmountFromDecodedInvoice(null)).toBeUndefined();
      expect(getAmountFromDecodedInvoice({})).toBeUndefined();
    });
  });

  describe('decodeEventId', () => {
    it('should decode a hex event id', async () => {
      const hex = 'A'.repeat(64);
      const result = await decodeEventId(hex);
      expect(result).toEqual({ type: 'eventId', eventId: hex.toLowerCase() });
    });

    it('should decode a note entity', async () => {
      const eventId = '1'.repeat(64);
      const note = encodeNoteId(eventId);
      const result = await decodeEventId(note);
      expect(result).toEqual({ type: 'note', eventId });
    });

    it('should decode a nevent entity with relays and author', async () => {
      const eventId = '2'.repeat(64);
      const author = testKeys.publicKey;
      const relays = ['wss://relay.one', 'wss://relay.two'];
      const nevent = encodeEvent({ id: eventId, relays, author });
      const result = await decodeEventId(nevent);
      expect(result).toEqual({ type: 'nevent', eventId, relays, pubkey: author });
    });

    it('should decode an naddr entity', async () => {
      const identifier = 'article-id';
      const kind = 30023;
      const relays = ['wss://relay.one'];
      const naddr = encodeAddress({
        identifier,
        pubkey: testKeys.publicKey,
        kind,
        relays,
      });
      const result = await decodeEventId(naddr);
      expect(result).toEqual({
        type: 'naddr',
        pubkey: testKeys.publicKey,
        kind,
        relays,
        identifier,
      });
    });

    it('should return null for unsupported or invalid identifiers', async () => {
      expect(await decodeEventId('')).toBeNull();
      expect(await decodeEventId('not-an-event-id')).toBeNull();
      expect(await decodeEventId('note1definitelyinvalid')).toBeNull();
    });
  });

  describe('processZapReceipt', () => {
    it('should populate target event/coordinate and amount from zap request fallback', () => {
      const receipt: ZapReceipt = {
        id: `process-${Date.now()}`,
        pubkey: zapperKeys.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 9735,
        tags: [
          ['p', testKeys.publicKey],
          ['e', 'event-target-id'],
          ['a', `30023:${testKeys.publicKey}:identifier`],
          ['bolt11', 'invalid-bolt11'],
          ['description', JSON.stringify({
            kind: 9734,
            content: 'test',
            pubkey: 'sender-pubkey',
            id: 'req-id',
            sig: 'req-sig',
            created_at: Math.floor(Date.now() / 1000),
            tags: [['p', testKeys.publicKey], ['amount', '123000']],
          })],
        ],
        content: '',
        sig: 'sig'
      };

      const processed = processZapReceipt(receipt, testKeys.publicKey);
      expect(processed.direction).toBe('received');
      expect(processed.targetEvent).toBe('event-target-id');
      expect(processed.targetCoordinate).toContain('30023:');
      expect(processed.amountSats).toBe(123);
    });

    it('should return cached result for repeated processing of same id', () => {
      const id = `cached-${Date.now()}`;
      const first: ZapReceipt = {
        id,
        pubkey: zapperKeys.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 9735,
        tags: [['p', testKeys.publicKey], ['amount', '1000']],
        content: '',
        sig: 'sig'
      };
      const second: ZapReceipt = {
        ...first,
        tags: [['p', 'other-target'], ['amount', '9999999']],
      };

      const a = processZapReceipt(first, testKeys.publicKey);
      const b = processZapReceipt(second, testKeys.publicKey);

      expect(b).toEqual(a);
      expect(b.id).toBe(id);
    });
  });

  describe('formatZapReceipt', () => {
    it('should format a zap receipt', () => {
      const zapRequest = {
        kind: 9734,
        content: 'Great content!',
        tags: [
          ['p', testKeys.publicKey],
          ['amount', '50000']
        ],
        pubkey: 'sender-pubkey',
        created_at: Math.floor(Date.now() / 1000)
      };

      const zapReceipt: NostrEvent = {
        id: 'abcdef123456',
        pubkey: zapperKeys.publicKey,
        created_at: Math.floor(Date.now() / 1000) - 3600,
        kind: 9735,
        tags: [
          ['p', testKeys.publicKey],
          ['P', 'sender-pubkey'],
          ['bolt11', 'lnbc1pvjluez'],
          ['description', JSON.stringify(zapRequest)]
        ],
        content: '',
        sig: 'test-sig'
      };

      const formatted = formatZapReceipt(zapReceipt, testKeys.publicKey);
      
      // The format has changed, so we check for key elements
      expect(formatted).toContain('RECEIVED');
      expect(formatted).toContain('Great content!');
      expect(formatted).toContain('From: sender-');
    });

    it('should include preimage and cached context-free formatting details', () => {
      const id = `format-cache-${Date.now()}`;
      const zapRequest = {
        kind: 9734,
        content: 'cached format',
        tags: [['p', testKeys.publicKey], ['amount', '2000']],
        pubkey: 'sender-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        id: 'request-id',
        sig: 'request-sig',
      };

      const zapReceipt: NostrEvent = {
        id,
        pubkey: zapperKeys.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 9735,
        tags: [
          ['p', testKeys.publicKey],
          ['e', 'event-target-id'],
          ['preimage', '1234567890abcdef1234'],
          ['bolt11', 'invalid-bolt11'],
          ['description', JSON.stringify(zapRequest)],
        ],
        content: '',
        sig: 'test-sig'
      };

      processZapReceipt(zapReceipt as ZapReceipt, testKeys.publicKey);
      const formatted = formatZapReceipt(zapReceipt);

      expect(formatted).toContain('Preimage: 1234567890...');
      expect(formatted).toContain('Target: Event (event-ta...)');
      expect(formatted).toContain('Comment: cached format');
      expect(formatted).toContain('---');
    });
  });

  describe('ZapCache', () => {
    it('should expire entries based on ttl', () => {
      const cache = new ZapCache(5, 1); // 1 minute TTL
      const originalNow = Date.now;
      const base = 1_700_000_000_000;
      Date.now = () => base;
      try {
        cache.add({
          id: 'ttl-zap',
          kind: 9735,
          content: '',
          tags: [],
          pubkey: 'pub',
          sig: 'sig',
          created_at: 1700000000,
        });
        expect(cache.get('ttl-zap')).toBeDefined();

        Date.now = () => base + 61_000;
        expect(cache.get('ttl-zap')).toBeUndefined();
      } finally {
        Date.now = originalNow;
      }
    });

    it('should evict oldest entries when exceeding max size', () => {
      const cache = new ZapCache(2, 60);
      const originalNow = Date.now;
      let now = 1_700_000_000_000;
      Date.now = () => now;
      try {
        cache.add({ id: 'a', kind: 9735, content: '', tags: [], pubkey: 'pub', sig: 'sig', created_at: 1 });
        now += 1;
        cache.add({ id: 'b', kind: 9735, content: '', tags: [], pubkey: 'pub', sig: 'sig', created_at: 2 });
        now += 1;
        cache.add({ id: 'c', kind: 9735, content: '', tags: [], pubkey: 'pub', sig: 'sig', created_at: 3 });

        const hasA = !!cache.get('a');
        const hasB = !!cache.get('b');
        const hasC = !!cache.get('c');

        // Current cleanup policy trims to 75% of max size after overflow.
        expect([hasA, hasB, hasC].filter(Boolean).length).toBe(1);
        expect(hasC).toBe(true);
      } finally {
        Date.now = originalNow;
      }
    });
  });

  describe.serial('prepareAnonymousZap', () => {
    it('should fail fast for invalid targets before network work', async () => {
      const result = await prepareAnonymousZap('definitely-invalid-target', 42, 'test');
      expect(result?.success).toBe(false);
      expect(result?.invoice).toBe('');
      expect(result?.message).toContain('Invalid target');
    });
  });

  describe('LNURL helper utilities', () => {
    function encodeLnurlPayload(url: string): string {
      const charset = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
      const bytes = new TextEncoder().encode(url);
      let bits = 0;
      let value = 0;
      let payload = '';

      for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
          payload += charset[(value >> (bits - 5)) & 31];
          bits -= 5;
        }
      }

      if (bits > 0) {
        payload += charset[(value << (5 - bits)) & 31];
      }

      return `lnurl${payload}`;
    }

    it('extracts LNURL/lightning values from canonical and fallback metadata keys', () => {
      expect(extractLnurlFromProfileMetadata({ lud16: 'alice@example.com' })).toBe('alice@example.com');
      expect(extractLnurlFromProfileMetadata({ LUD06: 'lnurl1abc' })).toBe('lnurl1abc');
      expect(extractLnurlFromProfileMetadata({ lightningAddress: 'bob@example.com' })).toBe('bob@example.com');
      expect(extractLnurlFromProfileMetadata({ other: 'value' })).toBeNull();
    });

    it('normalizes lightning addresses and bech32-style lnurl payloads to URLs', () => {
      expect(normalizeLnurlToUrl('alice@example.com')).toBe('https://example.com/.well-known/lnurlp/alice');
      expect(normalizeLnurlToUrl('wallet.example/path')).toBe('https://wallet.example/path');

      const decodedLnurl = 'https://wallet.example/.well-known/lnurlp/alice';
      const lnurlBech32 = encodeLnurlPayload(decodedLnurl);
      expect(normalizeLnurlToUrl(lnurlBech32)).toBe(decodedLnurl);
      expect(normalizeLnurlToUrl(`lnurl1${lnurlBech32.substring(5)}`)).toBe(decodedLnurl);
    });

    it('validates callback URLs as HTTP/S only', () => {
      expect(isValidUrl('https://wallet.example/cb')).toBe(true);
      expect(isValidUrl('http://wallet.example/cb')).toBe(true);
      expect(isValidUrl('ftp://wallet.example/cb')).toBe(false);
      expect(isValidUrl('not-a-url')).toBe(false);
    });
  });
});
