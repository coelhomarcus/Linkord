import { test, beforeEach, afterEach, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../db/client.js';
import {
  isLegacyProfileImageUrl,
  migrateLegacyProfileImages,
  type LegacyProfileImageUser,
} from './legacyProfileImageMigration.js';

let candidates: LegacyProfileImageUser[] = [];
let updates: Array<Record<string, string>> = [];
let cleaned: string[] = [];

beforeEach(() => {
  candidates = [];
  updates = [];
  cleaned = [];
  mock.method(db, 'select', () => ({
    from: () => ({ where: async () => candidates }),
  }) as never);
  mock.method(db, 'update', () => ({
    set: (values: Record<string, string>) => ({
      where: () => ({ returning: async () => { updates.push(values); return [{ id: 'updated' }]; } }),
    }),
  }) as never);
});

afterEach(() => {
  mock.restoreAll();
});

function user(overrides: Partial<LegacyProfileImageUser> = {}): LegacyProfileImageUser {
  return { id: `user-${Math.random()}`, avatar: '', banner: '', ...overrides };
}

describe('isLegacyProfileImageUrl', () => {
  test('reconhece URLs HTTP e HTTPS externas', () => {
    assert.equal(isLegacyProfileImageUrl('http://example.com/avatar.png'), true);
    assert.equal(isLegacyProfileImageUrl('https://example.com/avatar.png'), true);
  });

  test('rejeita vazio, upload interno e valores que nao sao URL', () => {
    assert.equal(isLegacyProfileImageUrl(''), false);
    assert.equal(isLegacyProfileImageUrl('/uploads/0123456789abcdef0123456789abcdef'), false);
    assert.equal(isLegacyProfileImageUrl('data:image/png;base64,abc'), false);
    assert.equal(isLegacyProfileImageUrl(null), false);
  });
});

describe('migrateLegacyProfileImages', () => {
  test('migra avatar e banner independentemente', async () => {
    candidates = [user({ avatar: 'https://example.com/avatar.png', banner: 'https://example.com/banner.png' })];
    const fetched: string[] = [];

    await migrateLegacyProfileImages({
      fetchImage: async (url) => { fetched.push(url); return { buffer: Buffer.from(url) }; },
      encodeAndStore: async (buffer) => ({ avatar: `/uploads/${buffer.toString()}`, avatarPoster: undefined }),
      removeStoredImage: async () => {},
    });

    assert.deepEqual(fetched, ['https://example.com/avatar.png', 'https://example.com/banner.png']);
    assert.deepEqual(updates, [
      { avatar: '/uploads/https://example.com/avatar.png', avatarPoster: '' },
      { banner: '/uploads/https://example.com/banner.png', bannerPoster: '' },
    ]);
  });

  test('falha no avatar nao impede a migracao do banner', async () => {
    candidates = [user({ avatar: 'https://example.com/dead.png', banner: 'https://example.com/banner.png' })];

    const result = await migrateLegacyProfileImages({
      fetchImage: async (url) => url.includes('dead')
        ? { error: 'fetch_failed', message: 'link morto' }
        : { buffer: Buffer.from('banner') },
      encodeAndStore: async () => ({ avatar: '/uploads/banner-id', avatarPoster: undefined }),
      removeStoredImage: async () => {},
    });

    assert.deepEqual(updates, [{ banner: '/uploads/banner-id', bannerPoster: '' }]);
    assert.equal(result, undefined);
  });

  test('limita a tres usuarios processados simultaneamente', async () => {
    candidates = Array.from({ length: 8 }, (_, index) => user({ id: `user-${index}`, avatar: `https://example.com/${index}.png` }));
    let active = 0;
    let maxActive = 0;

    await migrateLegacyProfileImages({
      fetchImage: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return { buffer: Buffer.from('image') };
      },
      encodeAndStore: async () => ({ avatar: '/uploads/id', avatarPoster: undefined }),
      removeStoredImage: async () => {},
    });

    assert.equal(maxActive, 3);
  });

  test('mantem o valor antigo e limpa o arquivo quando o update falha', async () => {
    candidates = [user({ avatar: 'https://example.com/avatar.png' })];
    mock.restoreAll();
    mock.method(db, 'select', () => ({
      from: () => ({ where: async () => candidates }),
    }) as never);
    mock.method(db, 'update', () => ({
      set: () => ({ where: () => ({ returning: async () => { throw new Error('db offline'); } }) }),
    }) as never);

    await migrateLegacyProfileImages({
      fetchImage: async () => ({ buffer: Buffer.from('image') }),
      encodeAndStore: async () => ({ avatar: '/uploads/new-id', avatarPoster: '/uploads/poster-id' }),
      removeStoredImage: async (stored) => { cleaned.push(stored.avatar, stored.avatarPoster!); },
    });

    assert.deepEqual(cleaned, ['/uploads/new-id', '/uploads/poster-id']);
    assert.deepEqual(updates, []);
  });
});
