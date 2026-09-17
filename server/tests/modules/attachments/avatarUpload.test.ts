import { test, beforeEach, afterEach, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../../../src/config/env.js';
import { db } from '../../../src/db/client.js';
import { filePathFor } from '../../../src/modules/attachments/attachmentStorage.js';
import { encodeAndStoreProfileImage } from '../../../src/modules/attachments/avatarUpload.js';

let uploadDir: string;
let previousUploadDir: string;

beforeEach(async () => {
  previousUploadDir = config.UPLOAD_DIR;
  uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'linkord-avatar-test-'));
  config.UPLOAD_DIR = uploadDir;
  mock.method(db, 'insert', () => ({ values: async () => undefined }) as never);
});

afterEach(async () => {
  mock.restoreAll();
  config.UPLOAD_DIR = previousUploadDir;
  await fs.rm(uploadDir, { recursive: true, force: true });
});

async function staticPng(): Promise<Buffer> {
  return sharp({
    create: { width: 8, height: 5, channels: 3, background: { r: 80, g: 140, b: 220 } },
  }).png().toBuffer();
}

// Two 2x2 frames with a short delay, kept inline so this test does not need
// another fixture or image dependency.
function animatedGif(): Buffer {
  return Buffer.from(
    'R0lGODlhAgACAPcfMQAAACQAAEgAAGwAAJAAALQAANgAAPwAAAAkACQkAEgkAGwkAJAkALQkANgkAPwkAABIACRIAEhIAGxIAJBIALRIANhIAPxIAABsACRsAEhsAGxsAJBsALRsANhsAPxsAACQACSQAEiQAGyQAJCQALSQANiQAPyQAAC0ACS0AEi0AGyQAJC0ALSQANi0APy0AADYACTYAEjYAGzYAJDYALTYANjYAPzYAAD8ACT8AEj8AGz8AJD8ALT8ANj8APz8AAAAVSQAVUgAVWwAVZAAVbQAVdgAVfwAVQAkVSQkVUgkVWwkVZAkVbQkVdgkVfwkVQBIVSRIVUhIVWxIVZBIVbRIVdhIVfxIVQBsVSRsVUhsVWxsVZBsVbRsVdhsVfxsVQCQVSSQVUiQVWyQVZCQVbSQVdiQVfyQVQC0VSS0VUi0VWy0VZC0VbS0Vdi0Vfy0VQDYVSTYVUjYVWzYVZDYVbTYVdjYVfzYVQD8VST8VUj8VWz8VZD8VbT8Vdj8Vfz8VQAAqiQAqkgAqmwAqpAAqrQAqtgAqvwAqgAkqiQkqkgkqmwkqpAkqrQkqtgkqvwkqgBIqiRIqkhIqmxIqpBIqrRIqthIqvxIqgBsqiRsqkhsqmxsqpBsqrRsqthsqvxsqgCQqiSQqkiQqmyQqpCQqrSQqtiQqvyQqgC0qiS0qki0qmy0qpC0qrS0qti0qvy0qgDYqiTYqkjYqmzYqpDYqrTYqtjYqvzYqgD8qiT8qkj8qmz8qpDYqrTYqtjYqvzYqgAA/yQA/0gA/2wA/5AA/7QA/9gA//wA/wAk/yQk/0gk/2wk/5Ak/7Qk/9gk//wk/wBI/yRI/0hI/2xI/5BI/7RI/9hI//xI/wBs/yRs/0hs/2xs/5Bs/7Rs/9hs//xs/wCQ/ySQ/0iQ/2yQ/5CQ/7SQ/9iQ//yQ/wC0/yS0/0i0/2yQ/5C0/7S0/9i0//y0/wDY/yTY/0jY/2zY/5DY/7TY/9jY//zY/wD8/yT8/0j8/2z8/5D8/7T8/9j8//z8/yH/C05FVFNDQVBFMi4wAwEAAAAh+QQEMgAfACwAAAAAAgACAAAIBgAPCDwQEAAh+QQFMgAAACwAAAAAAgACAAAIBgCBCQQWEAA7',
    'base64',
  );
}

describe('encodeAndStoreProfileImage', () => {
  test('recorta a imagem inteira e preserva as dimensoes em JPEG', async () => {
    const result = await encodeAndStoreProfileImage(await staticPng(), { left: 0, top: 0, width: 8, height: 5 });
    const id = result.avatar.split('/').pop()!;
    const metadata = await sharp(await fs.readFile(filePathFor(id))).metadata();

    assert.equal(metadata.format, 'jpeg');
    assert.equal(metadata.width, 8);
    assert.equal(metadata.height, 5);
    assert.equal(result.avatarPoster, undefined);
  });

  test('mantem GIF animado e gera poster JPEG', async () => {
    const result = await encodeAndStoreProfileImage(animatedGif(), { left: 0, top: 0, width: 2, height: 2 });
    const imageId = result.avatar.split('/').pop()!;
    const posterId = result.avatarPoster?.split('/').pop();
    const imageMetadata = await sharp(await fs.readFile(filePathFor(imageId)), { animated: true }).metadata();
    const posterMetadata = await sharp(await fs.readFile(filePathFor(posterId!))).metadata();

    assert.equal(imageMetadata.format, 'gif');
    assert.equal(imageMetadata.pages, 2);
    assert.equal(posterMetadata.format, 'jpeg');
    assert.equal(posterMetadata.width, 2);
    assert.equal(posterMetadata.height, 2);
  });

  test('rejeita um recorte fora dos limites da imagem', async () => {
    const input = await staticPng();
    await assert.rejects(
      () => encodeAndStoreProfileImage(input, { left: 0, top: 0, width: 999, height: 999 }),
      /Recorte fora dos limites/,
    );
  });

  test('remove o arquivo principal se a gravação do attachment falhar', async () => {
    mock.restoreAll();
    mock.method(db, 'insert', () => ({ values: async () => { throw new Error('db offline'); } }) as never);

    const input = await staticPng();
    await assert.rejects(() => encodeAndStoreProfileImage(input, { left: 0, top: 0, width: 8, height: 5 }), /db offline/);
    assert.deepEqual(await fs.readdir(uploadDir), []);
  });
});
