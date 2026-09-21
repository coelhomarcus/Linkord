import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Avatar } from '@/shared/Avatar';
import { Button } from '@/shared/ui/primitives/button';
import { GroupAvatar } from '@/features/conversations/GroupAvatar';
import { assignGroupOwner, deleteGroup, fetchAdminGroup, reactivateGroup, suspendGroup } from './adminApi';
import type { AdminGroupDetail, AdminGroupMember } from './adminApi';
import { ReasonDialog } from './ReasonDialog';
import { formatWhen } from './adminFormat';
import { AuditList, Badge, Field, Section } from './adminUi';

type Dialog = 'suspend' | 'reactivate' | 'delete' | { owner: AdminGroupMember } | null;

/** Administrative detail of a group. Deliberately offers no way to open the
 * conversation: an admin sees who is in it and acts on it, without joining. */
export function GroupDetailPage() {
  const { id = '' } = useParams();
  const [detail, setDetail] = useState<AdminGroupDetail | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'missing' | 'ready'>('loading');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [deleted, setDeleted] = useState(false);
  const [moreMembers, setMoreMembers] = useState<AdminGroupMember[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(() => {
    fetchAdminGroup(id)
      .then((d) => { setDetail(d); setNextCursor(d.members.nextCursor); setMoreMembers([]); setStatus('ready'); })
      .catch((err: { status?: number }) => setStatus(err?.status === 404 ? 'missing' : 'error'));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function loadMoreMembers() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchAdminGroup(id, nextCursor);
      setMoreMembers((prev) => [...prev, ...page.members.items]);
      setNextCursor(page.members.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  if (deleted) return <p className="py-8 text-center text-label text-text-muted">Grupo excluído. <Link to="/admin/groups" className="underline">Voltar à lista</Link></p>;
  if (status === 'loading') return <p className="py-8 text-center text-label text-text-muted">Carregando…</p>;
  if (status === 'missing') return <p className="py-8 text-center text-label text-text-muted">Grupo não encontrado. <Link to="/admin/groups" className="underline">Voltar</Link></p>;
  if (status === 'error' || !detail) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <p className="text-body text-text-muted">Não foi possível carregar o grupo.</p>
        <Button type="button" variant="secondary" size="sm" onClick={load}>Tentar de novo</Button>
      </div>
    );
  }

  const { group, history } = detail;
  const members = [...detail.members.items, ...moreMembers];
  const suspended = group.status === 'suspended';
  const run = (action: () => Promise<unknown>) => async () => { await action(); load(); };

  return (
    <div className="flex flex-col gap-4">
      <Link to="/admin/groups" className="w-fit text-caption text-text-muted underline">← Grupos</Link>
      <div className="flex items-center gap-3">
        <GroupAvatar title={group.title} avatar={group.avatar} size={56} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-title font-semibold text-text-primary">{group.title || 'Grupo sem nome'}</h2>
          <p className="truncate text-caption text-text-muted">{group.id}</p>
        </div>
        <Badge value={group.status} />
      </div>

      <div className="flex flex-wrap gap-2">
        {suspended
          ? <Button type="button" size="sm" onClick={() => setDialog('reactivate')}>Reativar grupo</Button>
          : <Button type="button" size="sm" variant="secondary" onClick={() => setDialog('suspend')}>Suspender grupo</Button>}
        <Button type="button" size="sm" variant="destructive" onClick={() => setDialog('delete')}>Excluir grupo</Button>
      </div>

      <Section title="Grupo">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Dono atual">{group.ownerUsername ? `@${group.ownerUsername}` : 'nenhum (grupo sem dono)'}</Field>
          <Field label="Criado em">{formatWhen(group.createdAt)}</Field>
          <Field label="Membros">{group.memberCount}</Field>
          <Field label="Última mensagem">{group.lastMessageAt ? formatWhen(new Date(group.lastMessageAt).toISOString()) : '—'}</Field>
          {suspended && <Field label="Motivo da suspensão">{group.statusReason}</Field>}
        </dl>
      </Section>

      <Section title="Membros">
        <ul className="flex flex-col divide-y divide-white/5">
          {members.map((m) => (
            <li key={m.user.id} className="flex items-center gap-3 py-2">
              <Avatar id={m.user.id} name={m.user.displayName} avatar={m.user.avatar} avatarColor={m.user.avatarColor} size={32} />
              <Link to={`/admin/users/${m.user.id}`} className="min-w-0 flex-1 truncate text-label text-text-primary hover:underline">
                {m.user.displayName} <span className="text-text-muted">@{m.user.username}</span>
              </Link>
              {m.role === 'owner'
                ? <span className="text-caption text-primary">dono</span>
                : <Button type="button" variant="ghost" size="xs" onClick={() => setDialog({ owner: m })}>Tornar dono</Button>}
            </li>
          ))}
        </ul>
        {nextCursor && (
          <Button type="button" variant="ghost" size="sm" className="self-center" disabled={loadingMore} onClick={() => void loadMoreMembers()}>
            {loadingMore ? 'Carregando…' : 'Carregar mais'}
          </Button>
        )}
      </Section>

      <Section title="Histórico de ações sobre este grupo"><AuditList items={history} /></Section>

      <ReasonDialog open={dialog === 'suspend'} onOpenChange={(o) => !o && setDialog(null)} title="Suspender grupo"
        description="Os membros continuam vendo o grupo na lista, mas ninguém lê, escreve, baixa mídia ou entra em chamada. Chamadas em andamento são encerradas."
        confirmLabel="Suspender" destructive onSubmit={(reason) => run(() => suspendGroup(group.id, reason))()} />
      <ReasonDialog open={dialog === 'reactivate'} onOpenChange={(o) => !o && setDialog(null)} title="Reativar grupo"
        description="O acesso dos membros é restaurado." confirmLabel="Reativar" onSubmit={(reason) => run(() => reactivateGroup(group.id, reason))()} />
      <ReasonDialog open={dialog === 'delete'} onOpenChange={(o) => !o && setDialog(null)} title="Excluir grupo"
        description="Definitivo: apaga o grupo, as mensagens e os arquivos. Não há como desfazer." confirmLabel="Excluir para sempre" destructive
        confirmText={group.title || group.id} onSubmit={async (reason) => { await deleteGroup(group.id, reason); setDeleted(true); }} />
      <ReasonDialog open={typeof dialog === 'object' && dialog !== null} onOpenChange={(o) => !o && setDialog(null)} title="Atribuir dono"
        description={typeof dialog === 'object' && dialog ? `@${dialog.owner.user.username} passa a ser o dono do grupo; quem era dono deixa de ser. Você não entra no grupo.` : ''}
        confirmLabel="Atribuir" onSubmit={(reason) => { const target = typeof dialog === 'object' && dialog ? dialog.owner.user.id : ''; return run(() => assignGroupOwner(group.id, target, reason))(); }} />
    </div>
  );
}
