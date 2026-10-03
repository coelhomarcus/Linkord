import { afterEach, describe, expect, it } from 'vitest';
import { __resetArrivalsForTests, markArrival, takeArrival } from '@/features/chat/arrivals';

describe('arrivals', () => {
  afterEach(() => __resetArrivalsForTests());

  it('an arrival animates once per surface', () => {
    markArrival('c:k1', 1000);
    expect(takeArrival('main', 'c:k1', 1100)).toBe(true);
    expect(takeArrival('main', 'c:k1', 1200)).toBe(false);
    expect(takeArrival('call', 'c:k1', 1200)).toBe(true);
  });

  it("what didn't arrive live (history, remount) doesn't animate", () => {
    expect(takeArrival('main', '42', 1000)).toBe(false);
  });

  it("an old arrival (came back after minutes) doesn't animate", () => {
    markArrival('7', 1000);
    expect(takeArrival('main', '7', 1000 + 60_000)).toBe(false);
  });

  it('burst: at most 4 animations in 400 ms', () => {
    for (let i = 0; i < 6; i++) markArrival(String(i), 1000);
    const animated = Array.from({ length: 6 }, (_, i) => takeArrival('main', String(i), 1000 + i));
    expect(animated.filter(Boolean)).toHaveLength(4);
  });
});
