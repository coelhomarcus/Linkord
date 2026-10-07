import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from '@/shared/api/api';
import { subscribeAdminAccessLost, subscribeAdminSessionEnded } from '@/features/admin/adminAccess';
import { fetchAdminUsers, suspendUser } from '@/features/admin/adminApi';
import { invalidateAdminLists, readListWindow, saveListWindow } from '@/features/admin/adminListCache';

vi.mock('@/shared/api/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/shared/api/api')>()), apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const lost = vi.fn();
const ended = vi.fn();
let unsubscribe: Array<() => void> = [];
beforeEach(() => {
  vi.clearAllMocks();
  unsubscribe.forEach((off) => off());
  unsubscribe = [subscribeAdminAccessLost(lost), subscribeAdminSessionEnded(ended)];
});

describe('admin access lost', () => {
  it('a 403 "forbidden" on a read raises it, and still rejects for the caller', async () => {
    mockedFetch.mockRejectedValue(new ApiError(403, 'forbidden', 'Apenas administradores.'));
    await expect(fetchAdminUsers({}, null)).rejects.toBeInstanceOf(ApiError);
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('so does a 403 on a mutation', async () => {
    mockedFetch.mockRejectedValue(new ApiError(403, 'forbidden', 'x'));
    await expect(suspendUser('u1', 'reason')).rejects.toBeInstanceOf(ApiError);
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('other failures (a business rule, a server error) are not a loss of access', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(409, 'last_admin', 'x'));
    await expect(suspendUser('u1', 'reason')).rejects.toBeInstanceOf(ApiError);
    mockedFetch.mockRejectedValueOnce(new ApiError(500, 'unknown_error', 'x'));
    await expect(fetchAdminUsers({}, null)).rejects.toBeInstanceOf(ApiError);
    expect(lost).not.toHaveBeenCalled();
  });
});

describe('admin session ended', () => {
  it('a 401 on a read raises it — and is not mistaken for a loss of the admin role', async () => {
    mockedFetch.mockRejectedValue(new ApiError(401, 'unauthenticated', 'x'));
    await expect(fetchAdminUsers({}, null)).rejects.toBeInstanceOf(ApiError);
    expect(ended).toHaveBeenCalledTimes(1);
    expect(lost).not.toHaveBeenCalled();
  });

  it('so does a 401 on a mutation, and the caller still gets the error', async () => {
    mockedFetch.mockRejectedValue(new ApiError(401, 'unauthenticated', 'x'));
    await expect(suspendUser('u1', 'reason')).rejects.toBeInstanceOf(ApiError);
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('a 403 is the other loss, not this one', async () => {
    mockedFetch.mockRejectedValue(new ApiError(403, 'forbidden', 'x'));
    await expect(fetchAdminUsers({}, null)).rejects.toBeInstanceOf(ApiError);
    expect(ended).not.toHaveBeenCalled();
    expect(lost).toHaveBeenCalledTimes(1);
  });
});

describe('remembered list windows', () => {
  const remember = () => saveListWindow('/admin/users\n{}', { items: [{ id: 'u1' }], nextCursor: null, pages: 1 }, 0);

  it('a successful mutation forgets them (a restored window must never predate a change)', async () => {
    invalidateAdminLists();
    remember();
    mockedFetch.mockResolvedValue({ ok: true });
    await suspendUser('u1', 'reason');
    expect(readListWindow('/admin/users\n{}')).toBeNull();
  });

  it('a failed mutation changed nothing, so they stay', async () => {
    invalidateAdminLists();
    remember();
    mockedFetch.mockRejectedValue(new ApiError(409, 'last_admin', 'x'));
    await expect(suspendUser('u1', 'reason')).rejects.toBeInstanceOf(ApiError);
    expect(readListWindow('/admin/users\n{}')).not.toBeNull();
  });

  it('a read leaves them alone', async () => {
    invalidateAdminLists();
    remember();
    mockedFetch.mockResolvedValue({ items: [], nextCursor: null });
    await fetchAdminUsers({}, null);
    expect(readListWindow('/admin/users\n{}')).not.toBeNull();
  });
});
