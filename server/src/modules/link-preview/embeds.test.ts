import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectEmbed, extractUrls, firstEmbed } from './embeds.js';

describe('detectEmbed', () => {
  test('reconhece YouTube', () => {
    assert.deepEqual(detectEmbed('https://youtu.be/dQw4w9WgXcQ'), { kind: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ', youtubeId: 'dQw4w9WgXcQ' });
  });

  test('reconhece os 3 formatos de link da Twitch', () => {
    assert.equal(detectEmbed('https://twitch.tv/algumcanal').kind, 'twitch-channel');
    assert.equal(detectEmbed('https://www.twitch.tv/videos/123456').kind, 'twitch-vod');
    assert.equal(detectEmbed('https://clips.twitch.tv/AbCdEf123').kind, 'twitch-clip');
  });

  test('reconhece midia direta por extensao', () => {
    assert.equal(detectEmbed('https://cdn.example.com/v.mp4').kind, 'video');
    assert.equal(detectEmbed('https://cdn.example.com/a.mp3').kind, 'audio');
    assert.equal(detectEmbed('https://cdn.example.com/f.png').kind, 'image');
  });

  test('qualquer link http(s) sem formato conhecido cai no fallback "link" — precisa continuar assim, e o que server/src/modules/media.ts espera pra listar a aba Embeds', () => {
    assert.deepEqual(detectEmbed('https://www.nasa.gov'), { kind: 'link', url: 'https://www.nasa.gov' });
  });

  test('espelha exatamente o mesmo comportamento de web/src/shared/lib/chatEmbeds.ts (mesmos regex, mesma ordem)', () => {
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
  test('extrai todas as URLs de um texto', () => {
    assert.deepEqual(extractUrls('a https://a.com b https://b.com'), ['https://a.com', 'https://b.com']);
  });

  test('sem URL nenhuma, nao ha embed', () => {
    assert.equal(firstEmbed('mensagem sem link'), null);
  });

  test('pega so o primeiro link da mensagem', () => {
    assert.equal(firstEmbed('primeiro https://youtu.be/dQw4w9WgXcQ segundo https://x.com')?.kind, 'youtube');
  });
});
