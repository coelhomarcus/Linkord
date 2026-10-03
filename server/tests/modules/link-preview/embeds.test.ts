import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectEmbed, extractUrls, firstEmbed } from '../../../src/modules/link-preview/embeds.js';

describe('detectEmbed', () => {
  test('recognizes YouTube', () => {
    assert.deepEqual(detectEmbed('https://youtu.be/dQw4w9WgXcQ'), { kind: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ', youtubeId: 'dQw4w9WgXcQ' });
  });

  test('recognizes the 3 Twitch link formats', () => {
    assert.equal(detectEmbed('https://twitch.tv/algumcanal').kind, 'twitch-channel');
    assert.equal(detectEmbed('https://www.twitch.tv/videos/123456').kind, 'twitch-vod');
    assert.equal(detectEmbed('https://clips.twitch.tv/AbCdEf123').kind, 'twitch-clip');
  });

  test('recognizes direct media by extension', () => {
    assert.equal(detectEmbed('https://cdn.example.com/v.mp4').kind, 'video');
    assert.equal(detectEmbed('https://cdn.example.com/a.mp3').kind, 'audio');
    assert.equal(detectEmbed('https://cdn.example.com/f.png').kind, 'image');
  });

  test('any http(s) link with no known format falls back to "link" — must keep behaving this way, since server/src/modules/media.ts relies on it to list the Embeds tab', () => {
    assert.deepEqual(detectEmbed('https://www.nasa.gov'), { kind: 'link', url: 'https://www.nasa.gov' });
  });

  test('mirrors exactly the same behavior as web/src/shared/lib/chatEmbeds.ts (same regexes, same order)', () => {
    const urls = [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://twitch.tv/algumcanal',
      'https://cdn.example.com/v.mp4',
      'https://qualquer-outro-site.com/pagina',
    ];
    const kinds = urls.map((u) => detectEmbed(u).kind);
    assert.deepEqual(kinds, ['youtube', 'twitch-channel', 'video', 'link']);
  });
});

describe('extractUrls / firstEmbed', () => {
  test('extracts all URLs from a text', () => {
    assert.deepEqual(extractUrls('a https://a.com b https://b.com'), ['https://a.com', 'https://b.com']);
  });

  test('with no URL at all, there is no embed', () => {
    assert.equal(firstEmbed('mensagem sem link'), null);
  });

  test('picks only the first link in the message', () => {
    assert.equal(firstEmbed('primeiro https://youtu.be/dQw4w9WgXcQ segundo https://x.com')?.kind, 'youtube');
  });
});
