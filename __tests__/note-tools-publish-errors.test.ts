import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

const mockPool = {
  close: mock(async () => {}),
  publish: mock(() => [] as Promise<{ success: boolean }>[]),
};

const getFreshPoolMock = mock(() => mockPool);

mock.module('../utils/index.js', () => ({
  DEFAULT_RELAYS: ['wss://mock.relay'],
  getFreshPool: getFreshPoolMock,
}));

import { postAnonymousNote, publishNote } from '../note/note-tools.js';

const signedNote = {
  id: 'a'.repeat(64),
  pubkey: 'b'.repeat(64),
  created_at: 1_700_000_000,
  kind: 1,
  tags: [] as string[][],
  content: 'mock note',
  sig: 'c'.repeat(128),
};

describe('note-tools publish error paths', () => {
  beforeEach(() => {
    mockPool.close.mockClear();
    mockPool.publish.mockClear();
    getFreshPoolMock.mockClear();
    getFreshPoolMock.mockImplementation(() => mockPool);
  });

  afterEach(() => {
    getFreshPoolMock.mockImplementation(() => mockPool);
    mockPool.publish.mockImplementation(() => [Promise.resolve({ success: true })]);
  });

  afterAll(() => {
    mock.restore();
  });

  it('postAnonymousNote returns failure when no relay accepts the event', async () => {
    mockPool.publish.mockReturnValue([
      Promise.resolve({ success: false }),
      Promise.reject(new Error('relay timeout')),
    ]);

    const result = await postAnonymousNote('hello', ['wss://relay.one', 'wss://relay.two']);

    expect(result.success).toBe(false);
    expect(result.message).toBe('Failed to publish note to any relay');
    expect(mockPool.close).toHaveBeenCalledTimes(1);
  });

  it('postAnonymousNote returns structured error when publish throws', async () => {
    mockPool.publish.mockImplementation(() => {
      throw new Error('publish explosion');
    });

    const result = await postAnonymousNote('hello', ['wss://relay.one']);

    expect(result.success).toBe(false);
    expect(result.message).toBe('Error posting anonymous note: publish explosion');
    expect(mockPool.close).toHaveBeenCalledTimes(1);
  });

  it('postAnonymousNote returns fatal error when pool creation fails', async () => {
    getFreshPoolMock.mockImplementation(() => {
      throw new Error('pool init failed');
    });

    const result = await postAnonymousNote('hello', ['wss://relay.one']);

    expect(result.success).toBe(false);
    expect(result.message).toBe('Fatal error: pool init failed');
    expect(mockPool.close).not.toHaveBeenCalled();
  });

  it('publishNote returns failure when no relay accepts the signed note', async () => {
    mockPool.publish.mockReturnValue([
      Promise.resolve({ success: false }),
      Promise.reject(new Error('relay offline')),
    ]);

    const result = await publishNote(signedNote, ['wss://relay.one', 'wss://relay.two']);

    expect(result.success).toBe(false);
    expect(result.message).toBe('Failed to publish note to any relay');
    expect(mockPool.close).toHaveBeenCalledTimes(1);
  });

  it('publishNote returns structured error when publish throws', async () => {
    mockPool.publish.mockImplementation(() => {
      throw new Error('publish crash');
    });

    const result = await publishNote(signedNote, ['wss://relay.one']);

    expect(result.success).toBe(false);
    expect(result.message).toBe('Error publishing note: publish crash');
    expect(mockPool.close).toHaveBeenCalledTimes(1);
  });

  it('publishNote returns fatal error when pool creation fails', async () => {
    getFreshPoolMock.mockImplementation(() => {
      throw new Error('pool unavailable');
    });

    const result = await publishNote(signedNote, ['wss://relay.one']);

    expect(result.success).toBe(false);
    expect(result.message).toBe('Fatal error: pool unavailable');
    expect(mockPool.close).not.toHaveBeenCalled();
  });
});
