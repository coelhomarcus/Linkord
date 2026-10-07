import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from '@/shared/api/api';
import { subscribeAdminAccessLost } from '@/features/admin/adminAccess';
import { fetchAdminUsers, suspendUser } from '@/features/admin/adminApi';

vi.mock('@/shared/api/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/shared/api/api')>()), apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const lost = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  subscribeAdminAccessLost(lost);
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
