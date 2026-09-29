import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, fetchFriends, fetchFriendRequests, sendFriendRequest } from '@/shared/api/api';

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('sendFriendRequest — the outcome comes from the body, not the status', () => {
  it('pending in either direction becomes pending_received / already_pending', async () => {
    stubFetch(200, { friendship: { status: 'pending' }, direction: 'incoming' });
    expect(await sendFriendRequest('ana')).toBe('pending_received');
    stubFetch(200, { friendship: { status: 'pending' }, direction: 'outgoing' });
    expect(await sendFriendRequest('ana')).toBe('already_pending');
  });

  it('already accepted becomes already_friends; pending with no direction is a new request', async () => {
    stubFetch(200, { friendship: { status: 'accepted' } });
    expect(await sendFriendRequest('ana')).toBe('already_friends');
    stubFetch(201, { friendship: { status: 'pending' } });
    expect(await sendFriendRequest('ana')).toBe('created');
  });

  it('cooldown arrives with retryAfter on the ApiError', async () => {
    stubFetch(409, { error: { code: 'cooldown', message: 'Wait', retryAfter: '2026-09-19T00:00:00.000Z' } });
    await expect(sendFriendRequest('ana')).rejects.toMatchObject({ status: 409, code: 'cooldown', retryAfter: '2026-09-19T00:00:00.000Z' });
    await expect(sendFriendRequest('ana')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('building list URLs', () => {
  it('omits empty params and encodes the rest', async () => {
    const f = stubFetch(200, { items: [], nextCursor: null });
    await fetchFriends(null, '');
    expect(f).toHaveBeenLastCalledWith('/api/friends', expect.anything());
    await fetchFriends('lune', 'a&b');
    expect(f).toHaveBeenLastCalledWith('/api/friends?cursor=lune&q=a%26b', expect.anything());
    await fetchFriendRequests('incoming', '2026-01-01T00:00:00.000000Z_id');
    expect(f).toHaveBeenLastCalledWith('/api/friend-requests?direction=incoming&cursor=2026-01-01T00%3A00%3A00.000000Z_id', expect.anything());
  });
});
