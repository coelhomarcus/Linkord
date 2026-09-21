// Inventory and repair PLANNING for data that predates the social model
// (docs/plano-rede-social.md §12). Everything that decides anything is a pure
// function over plain rows, so it is unit-tested without a database; the only
// SQL is `loadInventory`, written against the few tables that exist at every
// schema level from migration 0011 on — the repair has to run BEFORE the
// migrations that would choke on the data (0020's unique-owner index).

export interface Queryable {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export interface ConversationRow { id: string; type: string; createdBy: string | null; dmKey: string | null }
export interface MemberRow { conversationId: string; userId: string; role: string; joinedAt: Date }

export interface Inventory {
  conversations: ConversationRow[];
  members: MemberRow[];
  /** user id → status, only when `users.status` exists (schema ≥ 0022); otherwise everyone counts as active */
  userStatus: Map<string, string> | null;
  messagesWithoutAuthor: number;
}

export async function loadInventory(db: Queryable): Promise<Inventory> {
  const has = async (table: string, column: string): Promise<boolean> => {
    const { rows } = await db.query('select 1 from information_schema.columns where table_schema = current_schema() and table_name = $1 and column_name = $2', [table, column]);
    return rows.length > 0;
  };
  const conversations = (await db.query<{ id: string; type: string; created_by: string | null; dm_key: string | null }>(
    'select id, type, created_by, dm_key from conversations order by id')).rows
    .map((r) => ({ id: r.id, type: r.type, createdBy: r.created_by, dmKey: r.dm_key }));
  const members = (await db.query<{ conversation_id: string; user_id: string; role: string; joined_at: Date }>(
    'select conversation_id, user_id, role, joined_at from conversation_members order by conversation_id, user_id')).rows
    .map((r) => ({ conversationId: r.conversation_id, userId: r.user_id, role: r.role, joinedAt: new Date(r.joined_at) }));
  let userStatus: Map<string, string> | null = null;
  if (await has('users', 'status')) {
    userStatus = new Map((await db.query<{ id: string; status: string }>('select id, status from users')).rows.map((r) => [r.id, r.status]));
  }
  const { rows } = await db.query<{ n: string }>('select count(*)::text as n from messages where author_id is null');
  return { conversations, members, userStatus, messagesWithoutAuthor: Number(rows[0]?.n ?? 0) };
}

export interface Findings {
  groupsWithoutOwner: string[];
  groupsWithMultipleOwners: string[];
  unexpectedRoles: { conversationId: string; userId: string; role: string }[];
  directWithOwner: string[];
  directIncomplete: string[];
  emptyGroups: string[];
  duplicateDmKeys: string[];
  directWithoutKey: string[];
  messagesWithoutAuthor: number;
  /** what would make a pending migration fail — the server refuses to migrate while any exists */
  blockers: string[];
}

const VALID_ROLES = new Set(['owner', 'member']);

export function classifyInventory(inv: Inventory): Findings {
  const byConversation = new Map<string, MemberRow[]>();
  for (const m of inv.members) {
    const list = byConversation.get(m.conversationId) ?? [];
    list.push(m);
    byConversation.set(m.conversationId, list);
  }
  const f: Findings = {
    groupsWithoutOwner: [], groupsWithMultipleOwners: [], unexpectedRoles: [], directWithOwner: [], directIncomplete: [],
    emptyGroups: [], duplicateDmKeys: [], directWithoutKey: [], messagesWithoutAuthor: inv.messagesWithoutAuthor, blockers: [],
  };
  const keyCount = new Map<string, number>();
  for (const c of inv.conversations) {
    const members = byConversation.get(c.id) ?? [];
    for (const m of members) if (!VALID_ROLES.has(m.role)) f.unexpectedRoles.push({ conversationId: c.id, userId: m.userId, role: m.role });
    const owners = members.filter((m) => m.role === 'owner');
    if (c.type === 'group') {
      if (members.length === 0) f.emptyGroups.push(c.id);
      else if (owners.length === 0) f.groupsWithoutOwner.push(c.id);
      else if (owners.length > 1) f.groupsWithMultipleOwners.push(c.id);
    } else {
      if (owners.length > 0) f.directWithOwner.push(c.id);
      if (members.length !== 2) f.directIncomplete.push(c.id);
      if (c.dmKey) keyCount.set(c.dmKey, (keyCount.get(c.dmKey) ?? 0) + 1); else f.directWithoutKey.push(c.id);
    }
  }
  for (const [key, n] of keyCount) if (n > 1) f.duplicateDmKeys.push(key);
  if (f.groupsWithMultipleOwners.length) f.blockers.push(`${f.groupsWithMultipleOwners.length} grupo(s) com mais de um dono (bloqueia o índice único da migration 0020)`);
  if (f.duplicateDmKeys.length) f.blockers.push(`${f.duplicateDmKeys.length} dm_key duplicada(s) (bloqueia o índice único de conversations)`);
  return f;
}

export type RepairKind = 'normalize_role' | 'demote_extra_owner' | 'demote_direct_owner' | 'assign_owner';

export interface RepairAction {
  kind: RepairKind;
  conversationId: string;
  userId: string;
  before: { role: string };
  after: { role: 'owner' | 'member' };
  note: string;
  /** a judgement call a human should look at (creator not in the group, tie-break by age…) */
  needsReview: boolean;
}

const byAge = (a: MemberRow, b: MemberRow): number => a.joinedAt.getTime() - b.joinedAt.getTime() || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);

/** The §12.2 rules. A valid group keeps its owner. An invalid one prefers the
 * creator if still a member (and active, when that is knowable), then the
 * oldest eligible member, tie broken by id. A direct conversation never has an
 * owner. Empty groups and incomplete DMs are only reported — never deleted.
 * Applying the plan and running this again yields no actions. */
export function planRepairs(inv: Inventory): RepairAction[] {
  const actions: RepairAction[] = [];
  const byConversation = new Map<string, MemberRow[]>();
  for (const m of inv.members) {
    const list = byConversation.get(m.conversationId) ?? [];
    list.push(m);
    byConversation.set(m.conversationId, list);
  }
  const isActive = (userId: string) => !inv.userStatus || (inv.userStatus.get(userId) ?? 'active') === 'active';

  for (const c of inv.conversations) {
    const members = byConversation.get(c.id) ?? [];
    // 1. roles outside owner|member become plain members
    const normalized = members.map((m) => {
      if (VALID_ROLES.has(m.role)) return m;
      actions.push({ kind: 'normalize_role', conversationId: c.id, userId: m.userId, before: { role: m.role }, after: { role: 'member' }, note: `papel inesperado "${m.role}"`, needsReview: false });
      return { ...m, role: 'member' };
    });

    if (c.type !== 'group') {
      for (const m of normalized) {
        if (m.role === 'owner') actions.push({ kind: 'demote_direct_owner', conversationId: c.id, userId: m.userId, before: { role: 'owner' }, after: { role: 'member' }, note: 'conversa direta não tem dono', needsReview: false });
      }
      continue;
    }
    if (normalized.length === 0) continue;

    const owners = normalized.filter((m) => m.role === 'owner');
    if (owners.length === 1) continue;

    if (owners.length === 0) {
      const creator = normalized.find((m) => m.userId === c.createdBy && isActive(m.userId));
      const eligible = normalized.filter((m) => isActive(m.userId));
      const pick = creator ?? [...(eligible.length ? eligible : normalized)].sort(byAge)[0]!;
      actions.push({
        kind: 'assign_owner', conversationId: c.id, userId: pick.userId, before: { role: pick.role }, after: { role: 'owner' },
        note: creator ? 'grupo sem dono: o criador ainda é membro' : 'grupo sem dono: membro mais antigo (o criador não está mais no grupo)',
        needsReview: !creator,
      });
      continue;
    }

    const creatorOwner = owners.find((m) => m.userId === c.createdBy);
    const keep = creatorOwner ?? [...owners].sort(byAge)[0]!;
    for (const other of owners) {
      if (other.userId === keep.userId) continue;
      actions.push({
        kind: 'demote_extra_owner', conversationId: c.id, userId: other.userId, before: { role: 'owner' }, after: { role: 'member' },
        note: creatorOwner ? 'donos em excesso: fica o criador' : 'donos em excesso: fica o dono mais antigo (o criador não é dono)',
        needsReview: !creatorOwner,
      });
    }
  }
  // demotions first, so a promotion never coexists with a second owner
  const rank = (a: RepairAction) => (a.after.role === 'member' ? 0 : 1);
  return actions.sort((a, b) => rank(a) - rank(b));
}

export function formatFindings(f: Findings): string {
  const line = (label: string, n: number) => `  ${n === 0 ? '✓' : '•'} ${label}: ${n}`;
  return [
    'Inventário de dados legados',
    line('grupos sem dono', f.groupsWithoutOwner.length),
    line('grupos com mais de um dono', f.groupsWithMultipleOwners.length),
    line('papéis fora de owner/member', f.unexpectedRoles.length),
    line('DMs com dono', f.directWithOwner.length),
    line('DMs com associação incompleta (conta apagada)', f.directIncomplete.length),
    line('grupos vazios (só relatados)', f.emptyGroups.length),
    line('dm_key duplicada', f.duplicateDmKeys.length),
    line('DMs sem dm_key', f.directWithoutKey.length),
    line('mensagens sem autor (conta apagada)', f.messagesWithoutAuthor),
    f.blockers.length ? `\nBLOQUEIA a migração:\n${f.blockers.map((b) => `  ✗ ${b}`).join('\n')}` : '\nNenhum bloqueador.',
  ].join('\n');
}
