import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Avatar } from '@/shared/Avatar';
import { Button } from '@/shared/ui/primitives/button';
import { formatFileSize } from '@/shared/lib/formatBytes';
import { useCursorList } from '@/shared/hooks/useCursorList';
import { useRoom } from '@/state/RoomContext';
import { deleteUser, fetchAdminUser, fetchAudit, grantAdmin, reactivateUser, revokeAdmin, revokeUserSessions, suspendUser } from './adminApi';
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

type Dialog = 'suspend' | 'reactivate' | 'revoke' | 'delete' | 'grant-admin' | 'revoke-admin' | null;

const TABS = ['overview', 'groups', 'moderation', 'history'] as const;
type Tab = (typeof TABS)[number];
const QUERY: QuerySchema<'tab'> = { tab: { default: 'overview', allowed: TABS } };

/** Keyed by id: opening another account starts from a clean slate (dialogs,
 * the "deleted" flag), not from the previous account's leftovers. */
export function UserDetailPage() {
  const { id = '' } = useParams();
  return <UserDetail key={id} id={id} />;
}

/** The whole history of the account, by cursor — not just the few rows the
 * detail payload carries. `revision` re-reads it after something changed. */
function UserHistory({ id, revision }: { id: string; revision: string }) {
  const fetchPage = useCallback((cursor: string | null) => fetchAudit({ targetType: 'user', targetId: id }, cursor), [id]);
  const list = useCursorList(fetchPage, id, { getKey: (row) => row.id, revision });
  return (
    <AdminSection title="Histórico completo" description="Tudo o que a administração registrou sobre esta conta, da ação mais recente à mais antiga.">
      <ListChrome list={list} empty="Nenhuma ação registrada sobre esta conta."><AuditList items={list.items} /></ListChrome>
    </AdminSection>
  );
}

function UserDetail({ id }: { id: string }) {
  const { state } = useRoom();
  const back = useAdminBack('/admin/users');
  const { filters } = useAdminQuery(QUERY);
  const tab = filters.tab as Tab;
  const { data: detail, status, refresh, refreshing, refreshFailed, reload } = useAdminDetail(id, fetchAdminUser);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [deleted, setDeleted] = useState(false);
  const [ownSessionsEnded, setOwnSessionsEnded] = useState(false);

  if (deleted) return <p className="py-8 text-center text-label text-text-muted">Conta excluída. <Link to={back} className="underline">Voltar à lista</Link></p>;
  if (!detail) return <DetailStatusView status={status} missing="Conta não encontrada." failed="Não foi possível carregar a conta." backTo={back} backLabel="Voltar" onRetry={reload} />;

  const { user, groups, storage } = detail;
  const isSelf = user.id === state.me.userId;
  const suspended = user.status === 'suspended';
  const isAdmin = user.role === 'admin';
  const run = (action: () => Promise<unknown>) => async () => { await action(); void refresh(); };
  // revoking your own sessions ends this very session: the re-read would fail, and that is the expected outcome
  const revokeSessions = async (reason: string) => {
    await revokeUserSessions(user.id, reason);
    if (isSelf) setOwnSessionsEnded(true);
    else void refresh();
  };

  return (
    <div className="flex flex-col gap-5">
      <Link to={back} state={RESTORE_LIST} className="w-fit text-caption text-text-muted underline">← Usuários</Link>
      {refreshFailed && <RefreshFailedNotice refreshing={refreshing} onRetry={() => void refresh()} />}
      {ownSessionsEnded && (
        <p role="status" className="rounded-lg border border-yellow/30 bg-yellow/10 px-3 py-2 text-label text-text-primary">
          Suas sessões foram encerradas. Entre de novo para continuar.
        </p>
      )}

      <AdminEntityHeader
        avatar={<Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={64} />}
        title={user.displayName}
        subtitle={`@${user.username}`}
        id={user.id}
        badges={<><Badge value={user.role} /><Badge value={user.status} /></>}
      />

      <AdminDetailTabs<Tab>
        label="Seções da conta"
        active={tab}
        defaultTab="overview"
        tabs={[
          { id: 'overview', label: 'Resumo' },
          { id: 'groups', label: `Grupos (${groups.length})` },
          { id: 'moderation', label: 'Moderação' },
          { id: 'history', label: 'Histórico' },
        ]}
      />

      {tab === 'overview' && (
        <AdminSection title="Conta">
          <AdminFields>
            <AdminFieldRow label="E-mail">{user.email ?? '—'}</AdminFieldRow>
            <AdminFieldRow label="Criada em">{formatWhen(user.createdAt)}</AdminFieldRow>
            <AdminFieldRow label="Situação">
              {suspended ? `Suspensa em ${formatWhen(user.statusChangedAt)} — “${user.statusReason}”` : 'Ativa'}
            </AdminFieldRow>
            <AdminFieldRow label="Papel">{isAdmin ? 'Administradora' : 'Conta comum'}</AdminFieldRow>
            <AdminFieldRow label="Armazenamento atribuível">{formatFileSize(storage.bytes)} em {storage.files} arquivo(s)</AdminFieldRow>
            <AdminFieldRow label="Grupos">
              {groups.length === 0 ? 'Não participa de nenhum grupo.' : <Link to={{ search: '?tab=groups' }} className="underline">Ver os {groups.length} grupo(s)</Link>}
            </AdminFieldRow>
            <AdminFieldRow label="Histórico"><Link to={{ search: '?tab=history' }} className="underline">Ver ações registradas sobre esta conta</Link></AdminFieldRow>
          </AdminFields>
        </AdminSection>
      )}

      {tab === 'groups' && (
        <AdminSection title="Grupos" description="Os grupos de que a conta participa e o papel dela em cada um.">
          {groups.length === 0 ? <p className="text-label text-text-muted">Não participa de nenhum grupo.</p> : (
            <ul className="flex flex-col divide-y divide-white/5">
              {groups.map((g) => (
                <li key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <Link to={`/admin/groups/${g.id}`} className="min-w-0 flex-1 basis-48 truncate text-body text-text-primary hover:underline">{g.title || 'Grupo sem nome'}</Link>
                  <span className="text-caption text-text-muted">{g.role === 'owner' ? 'Dona do grupo' : 'Membro'}</span>
                  <Badge value={g.status} />
                </li>
              ))}
            </ul>
          )}
        </AdminSection>
      )}

      {tab === 'moderation' && (
        <>
          <AdminSection title="Acesso" description="O que a conta consegue fazer na instância. Toda ação pede um motivo e fica registrada.">
            <div className="flex flex-col divide-y divide-white/5">
              {suspended ? (
                <AdminActionRow title="Conta suspensa" description={`Suspensa em ${formatWhen(user.statusChangedAt)} — “${user.statusReason}”. Não consegue entrar.`}>
                  <Button type="button" size="sm" onClick={() => setDialog('reactivate')}>Reativar conta</Button>
                </AdminActionRow>
              ) : (
                <AdminActionRow
                  title="Suspender a conta"
                  description="A conta perde a sessão agora e não consegue entrar até ser reativada."
                  note={isSelf ? 'Você não pode suspender a própria conta.' : undefined}
                >
                  <Button type="button" size="sm" variant="secondary" disabled={isSelf} onClick={() => setDialog('suspend')}>Suspender</Button>
                </AdminActionRow>
              )}
              <AdminActionRow
                title="Encerrar sessões"
                description="Desconecta a conta de todos os dispositivos. Ela continua ativa e pode entrar de novo."
                note={isSelf ? 'Isso encerra a sua própria sessão: você precisará entrar de novo.' : undefined}
              >
                <Button type="button" size="sm" variant="secondary" onClick={() => setDialog('revoke')}>Revogar sessões</Button>
              </AdminActionRow>
            </div>
          </AdminSection>

          <AdminSection title="Administração" description="Quem pode ver e operar toda a instância: usuários, grupos, denúncias e auditoria.">
            {isAdmin ? (
              <AdminActionRow
                title="Esta conta é administradora"
                description="Remover o papel a torna uma conta comum. O último administrador ativo não pode ser removido."
                note={isSelf ? 'Você não pode remover a própria administração.' : undefined}
              >
                <Button type="button" size="sm" variant="secondary" disabled={isSelf} onClick={() => setDialog('revoke-admin')}>Remover admin</Button>
              </AdminActionRow>
            ) : (
              <AdminActionRow
                title="Conceder administração"
                description="Faça isso só para quem você confia: a conta passa a operar toda a instância."
                note={suspended ? 'Só uma conta ativa pode virar administradora.' : undefined}
              >
                <Button type="button" size="sm" variant="secondary" disabled={suspended} onClick={() => setDialog('grant-admin')}>Conceder admin</Button>
              </AdminActionRow>
            )}
          </AdminSection>

          <AdminSection danger title="Zona de perigo" description="Ações que não têm volta.">
            <AdminActionRow
              title="Excluir a conta"
              description="Definitivo. Grupos que ela possui passam ao membro mais antigo; grupos sem outros membros são apagados. As mensagens já enviadas continuam no histórico."
              note={isSelf ? 'Você não pode excluir a própria conta.' : undefined}
            >
              <Button type="button" size="sm" variant="destructive" disabled={isSelf} onClick={() => setDialog('delete')}>Excluir conta</Button>
            </AdminActionRow>
          </AdminSection>
        </>
      )}

      {tab === 'history' && <UserHistory id={user.id} revision={detail.history[0]?.id ?? ''} />}

      <ReasonDialog open={dialog === 'suspend'} onOpenChange={(o) => !o && setDialog(null)} title="Suspender conta"
        description={`@${user.username} perde a sessão agora e não consegue entrar até ser reativada.`} confirmLabel="Suspender" destructive
        onSubmit={(reason) => run(() => suspendUser(user.id, reason))()} />
      <ReasonDialog open={dialog === 'reactivate'} onOpenChange={(o) => !o && setDialog(null)} title="Reativar conta"
        description={`@${user.username} volta a poder entrar.`} confirmLabel="Reativar"
        onSubmit={(reason) => run(() => reactivateUser(user.id, reason))()} />
      <ReasonDialog open={dialog === 'revoke'} onOpenChange={(o) => !o && setDialog(null)} title="Revogar sessões"
        description={`Encerra todas as sessões e conexões de @${user.username}. A conta continua ativa.`} confirmLabel="Revogar"
        onSubmit={revokeSessions} />
      <ReasonDialog open={dialog === 'grant-admin'} onOpenChange={(o) => !o && setDialog(null)} title="Conceder administração"
        description={`@${user.username} passa a ver e operar toda a instância: usuários, grupos, denúncias e auditoria. Faça isso só para quem você confia.`}
        confirmLabel="Conceder admin" confirmText={user.username} onSubmit={(reason) => run(() => grantAdmin(user.id, reason))()} />
      <ReasonDialog open={dialog === 'revoke-admin'} onOpenChange={(o) => !o && setDialog(null)} title="Remover administração"
        description={`@${user.username} volta a ser uma conta comum. Não é possível remover o último administrador ativo.`}
        confirmLabel="Remover admin" destructive confirmText={user.username} onSubmit={(reason) => run(() => revokeAdmin(user.id, reason))()} />
      <ReasonDialog open={dialog === 'delete'} onOpenChange={(o) => !o && setDialog(null)} title="Excluir conta"
        description="Definitivo. Grupos que ela possui passam ao membro mais antigo; grupos sem outros membros são apagados. As mensagens já enviadas continuam no histórico."
        confirmLabel="Excluir para sempre" destructive confirmText={user.username}
        onSubmit={async (reason, confirm) => { await deleteUser(user.id, reason, confirm); setDeleted(true); }} />
    </div>
  );
}
