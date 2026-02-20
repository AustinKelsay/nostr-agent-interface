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

import { createProfile, postNote } from '../profile/profile-tools.js';

const VALID_PRIVATE_KEY = '0'.repeat(63) + '1';

describe('profile-tools publish error paths', () => {
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

  it('createProfile returns failure when no relay accepts the profile event', async () => {
    mockPool.publish.mockReturnValue([
      Promise.resolve({ success: false }),
      Promise.reject(new Error('relay timeout')),
    ]);

    const result = await createProfile(
      VALID_PRIVATE_KEY,
      { name: 'test-user' },
      ['wss://relay.one', 'wss://relay.two'],
    );

    expect(result.success).toBe(false);
    expect(result.message).toBe('Failed to publish profile to any relay');
    expect(mockPool.close).toHaveBeenCalledTimes(1);
  });

  it('createProfile returns structured error when publish throws', async () => {
    mockPool.publish.mockImplementation(() => {
      throw new Error('profile publish exploded');
    });

    const result = await createProfile(
      VALID_PRIVATE_KEY,
      { name: 'test-user' },
      ['wss://relay.one'],
    );

    expect(result.success).toBe(false);
    expect(result.message).toBe('Error creating profile: profile publish exploded');
    expect(mockPool.close).toHaveBeenCalledTimes(1);
  });

  it('createProfile returns success when at least one relay accepts publish', async () => {
    mockPool.publish.mockReturnValue([
      Promise.resolve({ success: true }),
      Promise.resolve({ success: false }),
      Promise.reject(new Error('relay down')),
    ]);

    const result = await createProfile(
      VALID_PRIVATE_KEY,
      { name: 'test-user' },
      ['wss://relay.one', 'wss://relay.two', 'wss://relay.three'],
    );

    expect(result.success).toBe(true);
    expect(result.message).toBe('Profile published to 1/3 relays');
    expect(result.eventId).toBeDefined();
    expect(result.publicKey).toBeDefined();
    expect(mockPool.close).toHaveBeenCalledTimes(1);
  });

  it('createProfile returns fatal error when pool creation fails', async () => {
    getFreshPoolMock.mockImplementation(() => {
      throw new Error('pool constructor failed');
    });

    const result = await createProfile(
      VALID_PRIVATE_KEY,
      { name: 'test-user' },
      ['wss://relay.one'],
    );

    expect(result.success).toBe(false);
    expect(result.message).toBe('Fatal error: pool constructor failed');
    expect(mockPool.close).not.toHaveBeenCalled();
  });

  it('postNote returns failure when no relay accepts the signed note', async () => {
    mockPool.publish.mockReturnValue([
      Promise.resolve({ success: false }),
      Promise.reject(new Error('relay timeout')),
    ]);

    const result = await postNote(
      VALID_PRIVATE_KEY,
      'hello',
      [['t', 'nostr']],
      ['wss://relay.one', 'wss://relay.two'],
    );

    expect(result.success).toBe(false);
    expect(result.message).toBe('Failed to publish note to any relay');
    expect(mockPool.close).toHaveBeenCalledTimes(1);
  });

  it('postNote returns structured error when publish throws', async () => {
    mockPool.publish.mockImplementation(() => {
      throw new Error('post publish exploded');
    });

    const result = await postNote(
      VALID_PRIVATE_KEY,
      'hello',
      [['t', 'nostr']],
      ['wss://relay.one'],
    );

    expect(result.success).toBe(false);
    expect(result.message).toBe('Error posting note: post publish exploded');
    expect(mockPool.close).toHaveBeenCalledTimes(1);
  });

  it('postNote returns success when one relay accepts publish', async () => {
    mockPool.publish.mockReturnValue([
      Promise.resolve({ success: false }),
      Promise.resolve({ success: true }),
    ]);

    const result = await postNote(
      VALID_PRIVATE_KEY,
      'hello',
      [['t', 'nostr']],
      ['wss://relay.one', 'wss://relay.two'],
    );

    expect(result.success).toBe(true);
    expect(result.message).toBe('Note published to 1/2 relays');
    expect(result.noteId).toBeDefined();
    expect(result.publicKey).toBeDefined();
    expect(mockPool.close).toHaveBeenCalledTimes(1);
  });
});
