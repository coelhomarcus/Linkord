import { describe, expect, it } from 'vitest';
import { detectEmbed, extractUrls, firstEmbed } from './chatEmbeds';

describe('detectEmbed', () => {
  it('reconhece YouTube em varios formatos de URL', () => {
    expect(detectEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({ kind: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', youtubeId: 'dQw4w9WgXcQ' });
    expect(detectEmbed('https://youtu.be/dQw4w9WgXcQ')?.youtubeId).toBe('dQw4w9WgXcQ');
    expect(detectEmbed('https://www.youtube.com/shorts/dQw4w9WgXcQ')?.youtubeId).toBe('dQw4w9WgXcQ');
    // v= no meio de outros parametros de query
    expect(detectEmbed('https://www.youtube.com/watch?list=abc&v=dQw4w9WgXcQ')?.youtubeId).toBe('dQw4w9WgXcQ');
  });

  it('distingue os 3 formatos de link da Twitch', () => {
    expect(detectEmbed('https://twitch.tv/algumcanal')).toEqual({ kind: 'twitch-channel', url: 'https://twitch.tv/algumcanal', twitchChannel: 'algumcanal' });
    expect(detectEmbed('https://www.twitch.tv/videos/123456')).toEqual({ kind: 'twitch-vod', url: 'https://www.twitch.tv/videos/123456', twitchVideoId: '123456' });
    expect(detectEmbed('https://clips.twitch.tv/AbCdEf123')).toEqual({ kind: 'twitch-clip', url: 'https://clips.twitch.tv/AbCdEf123', twitchClipSlug: 'AbCdEf123' });
  });

  it('reconhece midia direta por extensao', () => {
    expect(detectEmbed('https://cdn.example.com/video.mp4')?.kind).toBe('video');
    expect(detectEmbed('https://cdn.example.com/audio.mp3')?.kind).toBe('audio');
    expect(detectEmbed('https://cdn.example.com/foto.png')?.kind).toBe('image');
    expect(detectEmbed('https://cdn.example.com/foto.png?w=200')?.kind).toBe('image'); // extensao antes da query string
  });

  it('qualquer link http(s) sem formato conhecido cai no fallback "link" (Open Graph)', () => {
    expect(detectEmbed('https://www.nasa.gov')).toEqual({ kind: 'link', url: 'https://www.nasa.gov' });
    expect(detectEmbed('https://github.com/anthropics/claude-code')).toEqual({ kind: 'link', url: 'https://github.com/anthropics/claude-code' });
  });
});

describe('extractUrls / firstEmbed', () => {
  it('extrai todas as URLs de um texto', () => {
    expect(extractUrls('olha isso https://a.com e tambem https://b.com')).toEqual(['https://a.com', 'https://b.com']);
  });

  it('sem nenhuma URL no texto, nao ha embed', () => {
    expect(firstEmbed('mensagem qualquer sem link nenhum')).toBeNull();
  });

  it('pega so o PRIMEIRO link embutivel da mensagem', () => {
    const embed = firstEmbed('primeiro https://youtu.be/dQw4w9WgXcQ segundo https://example.com/outro');
    expect(embed?.kind).toBe('youtube');
  });
});
