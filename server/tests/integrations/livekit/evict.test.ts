import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { config } from '../../../src/config/env.js';
import { evictFromCall, findIdentitiesToEvict } from '../../../src/integrations/livekit/livekit.js';

const noSleep = async () => {};

function fakeApi(opts: { live?: { identity: string; metadata?: string }[]; failTimes?: number; notFound?: boolean } = {}) {
  const removed: string[] = [];
  let failures = opts.failTimes ?? 0;
  return {
    removed,
    api: {
      listParticipants: async () => opts.live ?? [],
      removeParticipant: async (_room: string, identity: string) => {
        if (opts.notFound) throw new Error('requested participant does not exist');
        if (failures > 0) { failures--; throw new Error('sfu unreachable'); }
        removed.push(identity);
      },
    },
  };
}

const original = { url: config.LIVEKIT_URL, key: config.LIVEKIT_API_KEY };
before(() => { config.LIVEKIT_URL = 'wss://sfu.test'; config.LIVEKIT_API_KEY = 'key'; });
after(() => { config.LIVEKIT_URL = original.url; config.LIVEKIT_API_KEY = original.key; });

describe('evictFromCall', () => {
  it('removes the known connections and the ones the SFU lists for the same account', async () => {
    const { api, removed } = fakeApi({ live: [{ identity: 'tab-2', metadata: 'user-1' }, { identity: 'other', metadata: 'user-2' }] });
    await evictFromCall('user-1', 'conv-1', ['tab-1'], api, noSleep);
    assert.deepEqual(removed.sort(), ['tab-1', 'tab-2']);
  });

  it('retries when the SFU fails, without throwing', async () => {
    const { api, removed } = fakeApi({ failTimes: 2 });
    await evictFromCall('user-1', 'conv-1', ['tab-1'], api, noSleep);
    assert.deepEqual(removed, ['tab-1']);
  });

  it('gives up after the retries and does not throw (removal is never undone by an external failure)', async () => {
    const { api, removed } = fakeApi({ failTimes: 99 });
    await assert.doesNotReject(evictFromCall('user-1', 'conv-1', ['tab-1'], api, noSleep));
    assert.deepEqual(removed, []);
  });

  it('"not found" counts as already removed, without retrying', async () => {
    let calls = 0;
    const api = { listParticipants: async () => [], removeParticipant: async () => { calls++; throw new Error('participant does not exist'); } };
    await evictFromCall('user-1', 'conv-1', ['tab-1'], api, noSleep);
    assert.equal(calls, 1);
  });

  it('does nothing when LiveKit is not configured', async () => {
    config.LIVEKIT_URL = '';
    try {
      const { api, removed } = fakeApi();
      await evictFromCall('user-1', 'conv-1', ['tab-1'], api, noSleep);
      assert.deepEqual(removed, []);
    } finally {
      config.LIVEKIT_URL = original.url;
    }
  });
});

describe('findIdentitiesToEvict', () => {
  it('a nonexistent room or an SFU that is down still returns the known identities', async () => {
    const api = { listParticipants: async () => { throw new Error('room not found'); } };
    assert.deepEqual(await findIdentitiesToEvict(api, 'room', 'user-1', ['tab-1']), ['tab-1']);
  });
});
