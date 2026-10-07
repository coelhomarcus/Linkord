import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Avatar } from '@/shared/Avatar';
import { Button } from '@/shared/ui/primitives/button';
import { formatFileSize } from '@/shared/lib/formatBytes';
import { useRoom } from '@/state/RoomContext';
import { deleteUser, fetchAdminUser, grantAdmin, reactivateUser, revokeAdmin, revokeUserSessions, suspendUser } from './adminApi';
import { ReasonDialog } from './ReasonDialog';
import { formatWhen } from './adminFormat';
import { AuditList, Badge, DetailStatusView, Field, RefreshFailedNotice, Section } from './adminUi';
import { useAdminBack } from './useAdminBack';
import { useAdminDetail } from './useAdminDetail';

type Dialog = 'suspend' | 'reactivate' | 'revoke' | 'delete' | 'grant-admin' | 'revoke-admin' | null;

/** Keyed by id: opening another account starts from a clean slate (dialogs,
 * the "deleted" flag), not from the previous account's leftovers. */
export function UserDetailPage() {
  const { id = '' } = useParams();
  return <UserDetail key={id} id={id} />;
}

function UserDetail({ id }: { id: string }) {
  const back = useAdminBack('/admin/users');
  const { state } = useRoom();
  const { data: detail, status, refresh, refreshing, refreshFailed, reload } = useAdminDetail(id, fetchAdminUser);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [deleted, setDeleted] = useState(false);

  if (deleted) return <p className="py-8 text-center text-label text-text-muted">Conta excluída. <Link to={back} className="underline">Voltar à lista</Link></p>;
  if (!detail) return <DetailStatusView status={status} missing="Conta não encontrada." failed="Não foi possível carregar a conta." backTo={back} backLabel="Voltar" onRetry={reload} />;

  const { user, groups, storage, history } = detail;
  const isSelf = user.id === state.me.userId;
  const suspended = user.status === 'suspended';
  const run = (action: () => Promise<unknown>) => async () => { await action(); void refresh(); };

  return (
    <div className="flex flex-col gap-4">
      <Link to={back} className="w-fit text-caption text-text-muted underline">← Usuários</Link>
      {refreshFailed && <RefreshFailedNotice refreshing={refreshing} onRetry={() => void refresh()} />}
      <div className="flex items-center gap-3">
        <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={56} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-title font-semibold text-text-primary">{user.displayName}</h2>
          <p className="truncate text-label text-text-muted">@{user.username}</p>
        </div>
        {user.role === 'admin' && <Badge value="admin" />}
        <Badge value={user.status} />
      </div>

      <div className="flex flex-wrap gap-2">
        {suspended
          ? <Button type="button" size="sm" onClick={() => setDialog('reactivate')}>Reativar conta</Button>
          : <Button type="button" size="sm" variant="secondary" disabled={isSelf} onClick={() => setDialog('suspend')}>Suspender</Button>}
        <Button type="button" size="sm" variant="secondary" onClick={() => setDialog('revoke')}>Revogar sessões</Button>
        {user.role === 'admin'
          ? <Button type="button" size="sm" variant="secondary" disabled={isSelf} onClick={() => setDialog('revoke-admin')}>Remover admin</Button>
          : <Button type="button" size="sm" variant="secondary" disabled={suspended} onClick={() => setDialog('grant-admin')}>Conceder admin</Button>}
        <Button type="button" size="sm" variant="destructive" disabled={isSelf} onClick={() => setDialog('delete')}>Excluir conta</Button>
        {isSelf && <p className="self-center text-caption text-text-muted">Não é possível suspender ou excluir a própria conta.</p>}
      </div>

      <Section title="Conta">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="E-mail">{user.email ?? '—'}</Field>
          <Field label="Criada em">{formatWhen(user.createdAt)}</Field>
          <Field label="Armazenamento atribuível">{formatFileSize(storage.bytes)} em {storage.files} arquivo(s)</Field>
          {suspended && <Field label="Suspensa em">{formatWhen(user.statusChangedAt)} — “{user.statusReason}”</Field>}
        </dl>
      </Section>

      <Section title={`Grupos (${groups.length})`}>
        {groups.length === 0 ? <p className="text-label text-text-muted">Não participa de nenhum grupo.</p> : (
          <ul className="flex flex-col divide-y divide-white/5">
            {groups.map((g) => (
              <li key={g.id} className="flex items-center gap-2 py-2">
                <Link to={`/admin/groups/${g.id}`} className="min-w-0 flex-1 truncate text-label text-text-primary hover:underline">{g.title || 'Grupo sem nome'}</Link>
                {g.role === 'owner' && <span className="text-caption text-primary">dono</span>}
                {g.status === 'suspended' && <Badge value="suspended" />}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Histórico de ações sobre esta conta"><AuditList items={history} /></Section>

      <ReasonDialog open={dialog === 'suspend'} onOpenChange={(o) => !o && setDialog(null)} title="Suspender conta"
        description={`@${user.username} perde a sessão agora e não consegue entrar até ser reativada.`} confirmLabel="Suspender" destructive
        onSubmit={(reason) => run(() => suspendUser(user.id, reason))()} />
      <ReasonDialog open={dialog === 'reactivate'} onOpenChange={(o) => !o && setDialog(null)} title="Reativar conta"
        description={`@${user.username} volta a poder entrar.`} confirmLabel="Reativar"
        onSubmit={(reason) => run(() => reactivateUser(user.id, reason))()} />
      <ReasonDialog open={dialog === 'revoke'} onOpenChange={(o) => !o && setDialog(null)} title="Revogar sessões"
        description={`Encerra todas as sessões e conexões de @${user.username}. A conta continua ativa.`} confirmLabel="Revogar"
        onSubmit={(reason) => run(() => revokeUserSessions(user.id, reason))()} />
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
