import { afterEach, describe, expect, it } from 'vitest';
import { __resetArrivalsForTests, markArrival, takeArrival } from '@/features/chat/arrivals';

describe('arrivals', () => {
  afterEach(() => __resetArrivalsForTests());

  it('uma chegada anima uma vez por superficie', () => {
    markArrival('c:k1', 1000);
    expect(takeArrival('main', 'c:k1', 1100)).toBe(true);
    expect(takeArrival('main', 'c:k1', 1200)).toBe(false);
    expect(takeArrival('call', 'c:k1', 1200)).toBe(true);
  });

  it('o que nao chegou ao vivo (historico, remontagem) nao anima', () => {
    expect(takeArrival('main', '42', 1000)).toBe(false);
  });

  it('chegada antiga (voltou depois de minutos) nao anima', () => {
    markArrival('7', 1000);
    expect(takeArrival('main', '7', 1000 + 60_000)).toBe(false);
  });

  it('rajada: no maximo 4 animacoes em 400 ms', () => {
    for (let i = 0; i < 6; i++) markArrival(String(i), 1000);
    const animated = Array.from({ length: 6 }, (_, i) => takeArrival('main', String(i), 1000 + i));
    expect(animated.filter(Boolean)).toHaveLength(4);
  });
});
