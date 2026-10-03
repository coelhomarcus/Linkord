import { describe, expect, it } from 'vitest';
import { detectEmbed, extractUrls, firstEmbed } from '@/shared/lib/chatEmbeds';

describe('detectEmbed', () => {
  it('recognizes YouTube in several URL formats', () => {
    expect(detectEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({ kind: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', youtubeId: 'dQw4w9WgXcQ' });
    expect(detectEmbed('https://youtu.be/dQw4w9WgXcQ')?.youtubeId).toBe('dQw4w9WgXcQ');
    expect(detectEmbed('https://www.youtube.com/shorts/dQw4w9WgXcQ')?.youtubeId).toBe('dQw4w9WgXcQ');
    expect(detectEmbed('https://www.youtube.com/watch?list=abc&v=dQw4w9WgXcQ')?.youtubeId).toBe('dQw4w9WgXcQ');
  });

  it('distinguishes the 3 Twitch link formats', () => {
    expect(detectEmbed('https://twitch.tv/somechannel')).toEqual({ kind: 'twitch-channel', url: 'https://twitch.tv/somechannel', twitchChannel: 'somechannel' });
    expect(detectEmbed('https://www.twitch.tv/videos/123456')).toEqual({ kind: 'twitch-vod', url: 'https://www.twitch.tv/videos/123456', twitchVideoId: '123456' });
    expect(detectEmbed('https://clips.twitch.tv/AbCdEf123')).toEqual({ kind: 'twitch-clip', url: 'https://clips.twitch.tv/AbCdEf123', twitchClipSlug: 'AbCdEf123' });
  });

  it('recognizes direct media by extension', () => {
    expect(detectEmbed('https://cdn.example.com/video.mp4')?.kind).toBe('video');
    expect(detectEmbed('https://cdn.example.com/audio.mp3')?.kind).toBe('audio');
    expect(detectEmbed('https://cdn.example.com/photo.png')?.kind).toBe('image');
    expect(detectEmbed('https://cdn.example.com/photo.png?w=200')?.kind).toBe('image');
  });

  it('any http(s) link with no known format falls back to "link" (Open Graph)', () => {
    expect(detectEmbed('https://www.nasa.gov')).toEqual({ kind: 'link', url: 'https://www.nasa.gov' });
    expect(detectEmbed('https://github.com/anthropics/claude-code')).toEqual({ kind: 'link', url: 'https://github.com/anthropics/claude-code' });
  });
});

describe('extractUrls / firstEmbed', () => {
  it('extracts every URL from a text', () => {
    expect(extractUrls('check this out https://a.com and also https://b.com')).toEqual(['https://a.com', 'https://b.com']);
  });

  it('has no embed when the text has no URL at all', () => {
    expect(firstEmbed('some message with no link at all')).toBeNull();
  });

  it('picks only the FIRST embeddable link in the message', () => {
    const embed = firstEmbed('first https://youtu.be/dQw4w9WgXcQ second https://example.com/other');
    expect(embed?.kind).toBe('youtube');
  });
});
