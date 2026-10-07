import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Avatar } from '@/shared/Avatar';
import { Button } from '@/shared/ui/primitives/button';
import { useCursorList } from '@/shared/hooks/useCursorList';
import { GroupAvatar } from '@/features/conversations/GroupAvatar';
import { assignGroupOwner, deleteGroup, fetchAdminGroup, fetchAudit, reactivateGroup, suspendGroup } from './adminApi';
import type { AdminGroupDetail, AdminGroupMember } from './adminApi';
import { AdminDetailTabs } from './AdminDetailTabs';
import { AdminEntityHeader } from './AdminEntityHeader';
import { AdminActionRow, AdminFieldRow, AdminFields, AdminSection } from './AdminSection';
import { ReasonDialog } from './ReasonDialog';
import { formatWhen } from './adminFormat';
import { AuditList, Badge, DetailStatusView, ListChrome, RefreshFailedNotice } from './adminUi';
import { RESTORE_LIST, useAdminBack } from './useAdminBack';
import { useAdminDetail } from './useAdminDetail';
import { useAdminQuery } from './useAdminQuery';
import type { QuerySchema } from './useAdminQuery';

type Dialog = 'suspend' | 'reactivate' | 'delete' | { owner: AdminGroupMember } | null;

const TABS = ['overview', 'members', 'moderation', 'history'] as const;
type Tab = (typeof TABS)[number];
const QUERY: QuerySchema<'tab'> = { tab: { default: 'overview', allowed: TABS } };

/** Members fetched beyond the first page, tied to the detail they were fetched
 * against: after a refresh (a new `detail`) they are dropped with it instead of
 * hanging off a cursor that no longer matches. */
interface MoreMembers { base: AdminGroupDetail; items: AdminGroupMember[]; cursor: string | null }

/** Keyed by id so a different group never inherits dialogs or loaded members. */
export function GroupDetailPage() {
  const { id = '' } = useParams();
  return <GroupDetail key={id} id={id} />;
}

/** The whole audit trail of the group, by cursor. `revision` re-reads it after something changed. */
function GroupHistory({ id, revision }: { id: string; revision: string }) {
  const fetchPage = useCallback((cursor: string | null) => fetchAudit({ targetType: 'group', targetId: id }, cursor), [id]);
  const list = useCursorList(fetchPage, id, { getKey: (row) => row.id, revision });
  return (
    <AdminSection title="Histórico completo" description="Tudo o que a administração registrou sobre este grupo, da ação mais recente à mais antiga.">
      <ListChrome list={list} empty="Nenhuma ação registrada sobre este grupo."><AuditList items={list.items} /></ListChrome>
    </AdminSection>
  );
}

/** Administrative detail of a group. Deliberately offers no way to open the
 * conversation: an admin sees who is in it and acts on it, without joining. */
function GroupDetail({ id }: { id: string }) {
  const back = useAdminBack('/admin/groups');
  const { filters } = useAdminQuery(QUERY);
  const tab = filters.tab as Tab;
  const { data: detail, status, refresh, mutate, refreshing, refreshFailed, reload } = useAdminDetail(id, (groupId) => fetchAdminGroup(groupId));
  const [dialog, setDialog] = useState<Dialog>(null);
  const [deleted, setDeleted] = useState(false);
  const [more, setMore] = useState<MoreMembers | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);

  async function loadMoreMembers() {
    if (!detail || loadingMore) return;
    const base = detail;
    const cursor = more?.base === base ? more.cursor : base.members.nextCursor;
    if (!cursor) return;
    setLoadingMore(true);
    setLoadMoreError(false);
    try {
      const page = await fetchAdminGroup(id, cursor);
      setMore((prev) => ({ base, items: [...(prev?.base === base ? prev.items : []), ...page.members.items], cursor: page.members.nextCursor }));
    } catch {
      setLoadMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  if (deleted) return <p className="py-8 text-center text-label text-text-muted">Grupo excluído. <Link to={back} className="underline">Voltar à lista</Link></p>;
  if (!detail) return <DetailStatusView status={status} missing="Grupo não encontrado." failed="Não foi possível carregar o grupo." backTo={back} backLabel="Voltar" onRetry={reload} />;

  const { group } = detail;
  const extra = more?.base === detail ? more : null;
  const members = [...detail.members.items, ...(extra?.items ?? [])];
  const nextCursor = extra ? extra.cursor : detail.members.nextCursor;
  const suspended = group.status === 'suspended';
  const name = group.title || 'Grupo sem nome';
  const ownerDialog = typeof dialog === 'object' && dialog !== null ? dialog.owner : null;

  return (
    <div className="flex flex-col gap-5">
      <Link to={back} state={RESTORE_LIST} className="w-fit text-caption text-text-muted underline">← Grupos</Link>
      {refreshFailed && <RefreshFailedNotice refreshing={refreshing} onRetry={() => void refresh()} />}

      <AdminEntityHeader
        avatar={<GroupAvatar title={group.title} avatar={group.avatar} size={64} />}
        title={name}
        id={group.id}
        badges={<>{!group.ownerId && <span className="inline-flex rounded bg-yellow/15 px-1.5 py-0.5 text-[11px] font-medium text-yellow">Sem dono</span>}<Badge value={group.status} /></>}
      />

      <AdminDetailTabs<Tab>
        label="Seções do grupo"
        active={tab}
        defaultTab="overview"
        tabs={[
          { id: 'overview', label: 'Resumo' },
          { id: 'members', label: `Membros (${group.memberCount})` },
          { id: 'moderation', label: 'Moderação' },
          { id: 'history', label: 'Histórico' },
        ]}
      />

      {tab === 'overview' && (
        <AdminSection title="Grupo">
          <AdminFields>
            <AdminFieldRow label="Dono atual">
              {group.ownerId ? <Link to={`/admin/users/${group.ownerId}`} className="hover:underline">@{group.ownerUsername}</Link> : 'nenhum (grupo sem dono)'}
            </AdminFieldRow>
            <AdminFieldRow label="Situação">{suspended ? `Suspenso — “${group.statusReason}”` : 'Ativo'}</AdminFieldRow>
            <AdminFieldRow label="Criado em">{formatWhen(group.createdAt)}</AdminFieldRow>
            <AdminFieldRow label="Membros">{group.memberCount}</AdminFieldRow>
            <AdminFieldRow label="Última mensagem">{group.lastMessageAt ? formatWhen(new Date(group.lastMessageAt).toISOString()) : '—'}</AdminFieldRow>
          </AdminFields>
        </AdminSection>
      )}

      {tab === 'members' && (
        <AdminSection title="Membros" description="Quem participa do grupo. Você consulta e administra sem entrar na conversa.">
          <ul className="flex flex-col divide-y divide-white/5">
            {members.map((m) => (
              <li key={m.user.id} className="flex items-center gap-3 py-2.5">
                <Avatar id={m.user.id} name={m.user.displayName} avatar={m.user.avatar} avatarColor={m.user.avatarColor} size={32} />
                <Link to={`/admin/users/${m.user.id}`} className="min-w-0 flex-1 truncate text-label text-text-primary hover:underline">
                  {m.user.displayName} <span className="text-text-muted">@{m.user.username}</span>
                </Link>
                {m.role === 'owner'
                  ? <span className="text-caption text-primary">dono</span>
                  : <Button type="button" variant="ghost" size="xs" onClick={() => setDialog({ owner: m })}>Atribuir dono</Button>}
              </li>
            ))}
          </ul>
          {loadMoreError && <p role="alert" className="text-center text-caption text-red-text">Não foi possível carregar mais membros.</p>}
          {nextCursor && (
            <Button type="button" variant="ghost" size="sm" className="self-center" disabled={loadingMore} onClick={() => void loadMoreMembers()}>
              {loadingMore ? 'Carregando…' : loadMoreError ? 'Tentar de novo' : 'Carregar mais'}
            </Button>
          )}
        </AdminSection>
      )}

      {tab === 'moderation' && (
        <>
          <AdminSection title="Acesso ao grupo" description="Toda ação pede um motivo e fica registrada.">
            {suspended ? (
              <AdminActionRow title="Grupo suspenso" description={`Motivo: “${group.statusReason}”. Ninguém lê, escreve, baixa mídia ou entra em chamada.`}>
                <Button type="button" size="sm" onClick={() => setDialog('reactivate')}>Reativar grupo</Button>
              </AdminActionRow>
            ) : (
              <AdminActionRow
                title="Suspender o grupo"
                description="Os membros continuam vendo o grupo na lista, mas ninguém lê, escreve, baixa mídia ou entra em chamada. Chamadas em andamento são encerradas."
              >
                <Button type="button" size="sm" variant="secondary" onClick={() => setDialog('suspend')}>Suspender grupo</Button>
              </AdminActionRow>
            )}
          </AdminSection>
          <AdminSection danger title="Zona de perigo" description="Ações que não têm volta.">
            <AdminActionRow title="Excluir o grupo" description="Definitivo: apaga o grupo, as mensagens e os arquivos. Não há como desfazer.">
              <Button type="button" size="sm" variant="destructive" onClick={() => setDialog('delete')}>Excluir grupo</Button>
            </AdminActionRow>
          </AdminSection>
        </>
      )}

      {tab === 'history' && <GroupHistory id={group.id} revision={detail.history[0]?.id ?? ''} />}

      <ReasonDialog open={dialog === 'suspend'} onOpenChange={(o) => !o && setDialog(null)} title="Suspender grupo"
        description="Os membros continuam vendo o grupo na lista, mas ninguém lê, escreve, baixa mídia ou entra em chamada. Chamadas em andamento são encerradas."
        confirmLabel="Suspender" destructive onSubmit={(reason) => mutate(() => suspendGroup(group.id, reason))} />
      <ReasonDialog open={dialog === 'reactivate'} onOpenChange={(o) => !o && setDialog(null)} title="Reativar grupo"
        description="O acesso dos membros é restaurado." confirmLabel="Reativar" onSubmit={(reason) => mutate(() => reactivateGroup(group.id, reason))} />
      <ReasonDialog open={dialog === 'delete'} onOpenChange={(o) => !o && setDialog(null)} title="Excluir grupo"
        description="Definitivo: apaga o grupo, as mensagens e os arquivos. Não há como desfazer." confirmLabel="Excluir para sempre" destructive
        confirmText={group.title || group.id} onSubmit={async (reason) => { await deleteGroup(group.id, reason); setDeleted(true); }} />
      <ReasonDialog open={ownerDialog !== null} onOpenChange={(o) => !o && setDialog(null)} title="Atribuir dono"
        description={ownerDialog
          ? `${group.ownerUsername ? `Dono atual: @${group.ownerUsername}.` : 'O grupo está sem dono.'} Novo dono: @${ownerDialog.user.username}. Quem era dono passa a membro. Você não entra no grupo.`
          : ''}
        confirmLabel="Atribuir" onSubmit={(reason) => (ownerDialog ? mutate(() => assignGroupOwner(group.id, ownerDialog.user.id, reason)) : Promise.resolve())} />
    </div>
  );
}
