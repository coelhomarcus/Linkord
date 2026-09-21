import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyInventory, planRepairs, type Inventory, type MemberRow } from '../../../src/modules/migration/legacyInventory.js';

const d = (iso: string) => new Date(iso);
const member = (conversationId: string, userId: string, role: string, joined: string): MemberRow => ({ conversationId, userId, role, joinedAt: d(joined) });
const inv = (over: Partial<Inventory> & Pick<Inventory, 'conversations' | 'members'>): Inventory => ({ userStatus: null, messagesWithoutAuthor: 0, ...over });
const group = (id: string, createdBy: string | null = null) => ({ id, type: 'group', createdBy, dmKey: null });
const direct = (id: string, dmKey: string | null) => ({ id, type: 'direct', createdBy: null, dmKey });

describe('classifyInventory', () => {
  it('grupo saudavel nao gera achado nem bloqueio', () => {
    const f = classifyInventory(inv({ conversations: [group('g')], members: [member('g', 'a', 'owner', '2025-01-01'), member('g', 'b', 'member', '2025-01-02')] }));
    assert.deepEqual([f.groupsWithoutOwner, f.groupsWithMultipleOwners, f.emptyGroups, f.blockers], [[], [], [], []]);
  });

  it('acha sem dono, multi-dono (bloqueia), vazio, papel estranho, DM com dono e DM incompleta', () => {
    const f = classifyInventory(inv({
      conversations: [group('none'), group('multi'), group('empty'), group('odd'), direct('dm1', 'a:b'), direct('dm2', 'c:d')],
      members: [
        member('none', 'a', 'member', '2025-01-01'),
        member('multi', 'a', 'owner', '2025-01-01'), member('multi', 'b', 'owner', '2025-01-02'),
        member('odd', 'a', 'owner', '2025-01-01'), member('odd', 'b', 'admin', '2025-01-02'),
        member('dm1', 'a', 'owner', '2025-01-01'), member('dm1', 'b', 'member', '2025-01-01'),
        member('dm2', 'c', 'member', '2025-01-01'),
      ],
    }));
    assert.deepEqual(f.groupsWithoutOwner, ['none']);
    assert.deepEqual(f.groupsWithMultipleOwners, ['multi']);
    assert.deepEqual(f.emptyGroups, ['empty']);
    assert.equal(f.unexpectedRoles.length, 1);
    assert.deepEqual(f.directWithOwner, ['dm1']);
    assert.deepEqual(f.directIncomplete, ['dm2']);
    assert.equal(f.blockers.length, 1);
    assert.match(f.blockers[0]!, /mais de um dono/);
  });

  it('dm_key duplicada tambem bloqueia', () => {
    const f = classifyInventory(inv({ conversations: [direct('x', 'a:b'), direct('y', 'a:b')], members: [] }));
    assert.deepEqual(f.duplicateDmKeys, ['a:b']);
    assert.equal(f.blockers.length, 1);
  });
});

describe('planRepairs', () => {
  it('nao mexe em grupo com exatamente um dono', () => {
    assert.deepEqual(planRepairs(inv({ conversations: [group('g', 'a')], members: [member('g', 'a', 'owner', '2025-01-01'), member('g', 'b', 'member', '2025-01-02')] })), []);
  });

  it('sem dono: o criador, se ainda e membro', () => {
    const plan = planRepairs(inv({ conversations: [group('g', 'b')], members: [member('g', 'a', 'member', '2025-01-01'), member('g', 'b', 'member', '2025-02-01')] }));
    assert.equal(plan.length, 1);
    assert.deepEqual([plan[0]!.kind, plan[0]!.userId, plan[0]!.needsReview], ['assign_owner', 'b', false]);
  });

  it('sem dono e criador fora: o membro mais antigo, marcado para revisao', () => {
    const plan = planRepairs(inv({ conversations: [group('g', null)], members: [member('g', 'z', 'member', '2025-03-01'), member('g', 'y', 'member', '2025-01-01')] }));
    assert.deepEqual([plan[0]!.userId, plan[0]!.needsReview], ['y', true]);
  });

  it('empate no joinedAt desempata por id', () => {
    const plan = planRepairs(inv({ conversations: [group('g')], members: [member('g', 'b', 'member', '2025-01-01'), member('g', 'a', 'member', '2025-01-01')] }));
    assert.equal(plan[0]!.userId, 'a');
  });

  it('sem dono: prefere membro ativo quando o status e conhecido', () => {
    const plan = planRepairs(inv({
      conversations: [group('g', null)], members: [member('g', 'old', 'member', '2025-01-01'), member('g', 'new', 'member', '2025-02-01')],
      userStatus: new Map([['old', 'suspended'], ['new', 'active']]),
    }));
    assert.equal(plan[0]!.userId, 'new');
  });

  it('varios donos: fica o criador, os demais viram membro', () => {
    const plan = planRepairs(inv({ conversations: [group('g', 'a')], members: [member('g', 'a', 'owner', '2025-02-01'), member('g', 'b', 'owner', '2025-01-01'), member('g', 'c', 'owner', '2025-03-01')] }));
    assert.deepEqual(plan.map((p) => [p.kind, p.userId]).sort(), [['demote_extra_owner', 'b'], ['demote_extra_owner', 'c']]);
    assert.ok(plan.every((p) => !p.needsReview));
  });

  it('varios donos sem criador entre eles: fica o mais antigo, com revisao', () => {
    const plan = planRepairs(inv({ conversations: [group('g', null)], members: [member('g', 'a', 'owner', '2025-02-01'), member('g', 'b', 'owner', '2025-01-01')] }));
    assert.deepEqual([plan.length, plan[0]!.userId, plan[0]!.needsReview], [1, 'a', true]);
  });

  it('papel inesperado vira membro; se era o unico "dono" possivel, o grupo segue a regra normal', () => {
    const plan = planRepairs(inv({ conversations: [group('g', 'a')], members: [member('g', 'a', 'owner', '2025-01-01'), member('g', 'b', 'admin', '2025-01-02')] }));
    assert.deepEqual(plan.map((p) => [p.kind, p.userId]), [['normalize_role', 'b']]);
  });

  it('DM nunca tem dono', () => {
    const plan = planRepairs(inv({ conversations: [direct('dm', 'a:b')], members: [member('dm', 'a', 'owner', '2025-01-01'), member('dm', 'b', 'member', '2025-01-01')] }));
    assert.deepEqual(plan.map((p) => p.kind), ['demote_direct_owner']);
  });

  it('grupo vazio e DM incompleta nao geram acao (so relatorio)', () => {
    assert.deepEqual(planRepairs(inv({ conversations: [group('g'), direct('dm', 'a:b')], members: [member('dm', 'a', 'member', '2025-01-01')] })), []);
  });

  it('rebaixamentos vem antes de promocoes', () => {
    const plan = planRepairs(inv({
      conversations: [group('x', null), group('y', 'a')],
      members: [member('x', 'p', 'member', '2025-01-01'), member('y', 'a', 'owner', '2025-01-01'), member('y', 'b', 'owner', '2025-01-02')],
    }));
    assert.deepEqual(plan.map((p) => p.after.role), ['member', 'owner']);
  });

  it('e idempotente: aplicar o plano no estado e planejar de novo da vazio', () => {
    const before = inv({
      conversations: [group('a', null), group('b', 'q'), direct('dm', 'x:y')],
      members: [
        member('a', 'u', 'member', '2025-01-01'), member('a', 'v', 'member', '2025-01-02'),
        member('b', 'q', 'owner', '2025-01-01'), member('b', 'r', 'owner', '2025-01-02'), member('b', 's', 'admin', '2025-01-03'),
        member('dm', 'x', 'owner', '2025-01-01'), member('dm', 'y', 'member', '2025-01-01'),
      ],
    });
    const applied: Inventory = { ...before, members: before.members.map((m) => {
      const action = planRepairs(before).find((p) => p.conversationId === m.conversationId && p.userId === m.userId);
      return action ? { ...m, role: action.after.role } : m;
    }) };
    assert.deepEqual(planRepairs(applied), []);
  });
});
