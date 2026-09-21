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
  it('remove as conexoes conhecidas e as que o SFU lista para a mesma conta', async () => {
    const { api, removed } = fakeApi({ live: [{ identity: 'tab-2', metadata: 'user-1' }, { identity: 'other', metadata: 'user-2' }] });
    await evictFromCall('user-1', 'conv-1', ['tab-1'], api, noSleep);
    assert.deepEqual(removed.sort(), ['tab-1', 'tab-2']);
  });

  it('tenta de novo quando o SFU falha, sem lancar', async () => {
    const { api, removed } = fakeApi({ failTimes: 2 });
    await evictFromCall('user-1', 'conv-1', ['tab-1'], api, noSleep);
    assert.deepEqual(removed, ['tab-1']);
  });

  it('desiste depois das tentativas e nao lanca (remocao nunca e desfeita por falha externa)', async () => {
    const { api, removed } = fakeApi({ failTimes: 99 });
    await assert.doesNotReject(evictFromCall('user-1', 'conv-1', ['tab-1'], api, noSleep));
    assert.deepEqual(removed, []);
  });

  it('"nao encontrado" conta como ja removido, sem repetir', async () => {
    let calls = 0;
    const api = { listParticipants: async () => [], removeParticipant: async () => { calls++; throw new Error('participant does not exist'); } };
    await evictFromCall('user-1', 'conv-1', ['tab-1'], api, noSleep);
    assert.equal(calls, 1);
  });

  it('sem LiveKit configurado nao faz nada', async () => {
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
  it('sala inexistente ou SFU fora do ar ainda devolve as identidades conhecidas', async () => {
    const api = { listParticipants: async () => { throw new Error('room not found'); } };
    assert.deepEqual(await findIdentitiesToEvict(api, 'room', 'user-1', ['tab-1']), ['tab-1']);
  });
});
