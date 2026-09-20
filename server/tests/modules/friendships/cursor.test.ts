import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decodeTimeCursor, decodeUsernameCursor, encodeTimeCursor, escapeLike, normalizeSearchQuery, MAX_SEARCH_LEN,
} from '../../../src/modules/friendships/cursor.js';

const TS = '2026-09-18T18:16:13.592123Z';
const ID = '9a26e8d3-7b27-4d77-aa4b-4aeea422fc7d';

describe('cursor de tempo (solicitações/bloqueios)', () => {
  it('ida e volta preserva o timestamp com microssegundos', () => {
    assert.deepEqual(decodeTimeCursor(encodeTimeCursor(TS, ID)), { ts: TS, id: ID });
  });

  it('rejeita lixo em vez de adivinhar', () => {
    for (const bad of ['', 'abc', `${TS}`, `_${ID}`, `${TS}_`, `2026-09-18_${ID}`, `${TS}_ id com espaço`, `${TS}_'; drop table users;--`]) {
      assert.equal(decodeTimeCursor(bad), null, bad);
    }
  });

  it('rejeita timestamp sem 6 casas (só milissegundos perderia linhas na paginação)', () => {
    assert.equal(decodeTimeCursor(`2026-09-18T18:16:13.592Z_${ID}`), null);
  });
});

describe('cursor de username (amigos)', () => {
  it('normaliza para minúsculas', () => {
    assert.equal(decodeUsernameCursor('Lune_99'), 'lune_99');
  });

  it('rejeita caracteres fora do alfabeto de usernames e tamanhos absurdos', () => {
    assert.equal(decodeUsernameCursor(''), null);
    assert.equal(decodeUsernameCursor('a b'), null);
    assert.equal(decodeUsernameCursor("x'--"), null);
    assert.equal(decodeUsernameCursor('a'.repeat(33)), null);
  });
});

describe('escapeLike / normalizeSearchQuery', () => {
  it('escapa %, _ e \\ para casar literalmente', () => {
    assert.equal(escapeLike('50%_off\\'), '50\\%\\_off\\\\');
  });

  it('busca é aparada, em minúsculas e limitada', () => {
    assert.equal(normalizeSearchQuery('  LuNe '), 'lune');
    assert.equal(normalizeSearchQuery(undefined), '');
    assert.equal(normalizeSearchQuery('x'.repeat(500)).length, MAX_SEARCH_LEN);
  });
});
