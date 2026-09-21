import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideUserAction, normalizeReason, pickSuccessor } from '../../../src/modules/admin/adminPolicy.js';

const base = { actorId: 'admin-1', targetId: 'user-1', targetRole: 'user', targetStatus: 'active', activeAdminCount: 2 };

describe('decideUserAction', () => {
  it('suspende e exclui uma conta comum', () => {
    assert.equal(decideUserAction({ ...base, action: 'suspend' }), 'allow');
    assert.equal(decideUserAction({ ...base, action: 'delete' }), 'allow');
  });

  it('ninguem suspende ou exclui a si mesmo', () => {
    assert.equal(decideUserAction({ ...base, action: 'suspend', targetId: 'admin-1', targetRole: 'admin' }), 'self');
    assert.equal(decideUserAction({ ...base, action: 'delete', targetId: 'admin-1', targetRole: 'admin' }), 'self');
  });

  it('protege o ultimo administrador ativo', () => {
    const lastAdmin = { ...base, targetRole: 'admin', activeAdminCount: 1 };
    assert.equal(decideUserAction({ ...lastAdmin, action: 'suspend' }), 'last_admin');
    assert.equal(decideUserAction({ ...lastAdmin, action: 'delete' }), 'last_admin');
  });

  it('com outro admin ativo, um admin pode ser suspenso', () => {
    assert.equal(decideUserAction({ ...base, action: 'suspend', targetRole: 'admin', activeAdminCount: 2 }), 'allow');
  });

  it('excluir um admin JA suspenso nao reduz os ativos, entao nao conta como ultimo', () => {
    assert.equal(decideUserAction({ ...base, action: 'delete', targetRole: 'admin', targetStatus: 'suspended', activeAdminCount: 1 }), 'allow');
  });

  it('suspender de novo uma conta suspensa, e reativar uma ativa, sao recusados', () => {
    assert.equal(decideUserAction({ ...base, action: 'suspend', targetStatus: 'suspended' }), 'already_suspended');
    assert.equal(decideUserAction({ ...base, action: 'reactivate' }), 'not_suspended');
    assert.equal(decideUserAction({ ...base, action: 'reactivate', targetStatus: 'suspended' }), 'allow');
  });
});

describe('pickSuccessor', () => {
  const at = (iso: string) => new Date(iso);

  it('escolhe o membro mais antigo, sem o dono que sai', () => {
    const members = [
      { userId: 'owner', joinedAt: at('2026-01-01') },
      { userId: 'b', joinedAt: at('2026-03-01') },
      { userId: 'c', joinedAt: at('2026-02-01') },
    ];
    assert.equal(pickSuccessor(members, 'owner'), 'c');
  });

  it('empate no joinedAt desempata por id', () => {
    const same = at('2026-02-01');
    assert.equal(pickSuccessor([{ userId: 'z', joinedAt: same }, { userId: 'a', joinedAt: same }, { userId: 'owner', joinedAt: at('2025-01-01') }], 'owner'), 'a');
  });

  it('sem outros membros nao ha sucessor', () => {
    assert.equal(pickSuccessor([{ userId: 'owner', joinedAt: at('2026-01-01') }], 'owner'), null);
    assert.equal(pickSuccessor([], 'owner'), null);
  });
});

describe('normalizeReason', () => {
  it('aceita e normaliza espacos', () => {
    assert.equal(normalizeReason('  spam   em   massa '), 'spam em massa');
  });

  it('recusa vazio, curto demais e longo demais', () => {
    assert.equal(normalizeReason(''), null);
    assert.equal(normalizeReason('  ab '), null);
    assert.equal(normalizeReason(undefined), null);
    assert.equal(normalizeReason('x'.repeat(501)), null);
    assert.equal(normalizeReason('x'.repeat(500)), 'x'.repeat(500));
  });
});
