import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Trash2, X } from 'lucide-react';
import { useRoom } from '../../state/RoomContext';
import { Avatar } from '../../shared/Avatar';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import { fetchAdminUsers, type AdminUserRow } from '@/shared/api/api';
import { Button } from '@/shared/ui/primitives/button';

function UserRow({ user, online, isMe, onDeleteRequest }: {
  user: AdminUserRow;
  online: boolean;
  isMe: boolean;
  onDeleteRequest: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-bg-hover">
      <div className="relative flex-none">
        <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={32} />
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-bg-tertiary ${online ? 'bg-green' : 'bg-text-muted'}`}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-medium text-text-primary">
          {user.displayName}
          {user.displayName !== user.username && <span className="ml-1.5 text-label font-normal text-text-muted">@{user.username}</span>}
          {isMe && <span className="ml-1.5 text-label font-normal text-text-muted">(você)</span>}
        </p>
        <p className="select-none text-caption text-text-muted">{online ? 'Online' : 'Offline'}</p>
      </div>
      {user.role === 'admin' && <ShieldCheck size={16} className="flex-none text-primary" />}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Apagar conta de ${user.username}`}
        disabled={isMe}
        onClick={onDeleteRequest}
        className="flex-none text-text-muted hover:bg-red/12 hover:text-red disabled:opacity-30"
      >
        <Trash2 size={14} />
      </Button>
    </div>
  );
}

export function ModerationTab() {
  const { state, deleteUserAccount, moderationError, clearModerationError } = useRoom();
  const [confirmTarget, setConfirmTarget] = useState<AdminUserRow | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');

  // Etapa 7: the socket welcome no longer ships a global directory, so this
  // admin-only listing (needed just to pick who to delete) has its own
  // fetch now instead of reading the room's known-users cache.
  const load = useCallback(() => {
    setStatus('loading');
    fetchAdminUsers()
      .then(({ users: rows }) => {
        setUsers([...rows].sort((a, b) => a.displayName.localeCompare(b.displayName) || a.username.localeCompare(b.username)));
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, []);
  useEffect(() => { load(); }, [load]);

  function handleConfirm() {
    if (confirmTarget) {
      deleteUserAccount(confirmTarget.id);
      setUsers((prev) => prev.filter((u) => u.id !== confirmTarget.id));
    }
    setConfirmTarget(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="select-none text-label text-text-muted">
        Apagar uma conta é definitivo. A pessoa não consegue mais entrar. As mensagens que ela já mandou continuam no histórico do chat.
      </p>

      {status === 'error' && (
        <div className="flex items-center gap-2 rounded-md bg-red/12 px-2.5 py-1.5 text-label text-red-text">
          <span className="min-w-0 flex-1">Não foi possível carregar as contas.</span>
          <button
            type="button"
            onClick={load}
            className="flex-none font-medium text-red-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Tentar de novo
          </button>
        </div>
      )}

      {moderationError && (
        <div className="flex items-center gap-2 rounded-md bg-red/12 px-2.5 py-1.5 text-label text-red-text">
          <span className="min-w-0 flex-1">{moderationError}</span>
          <button
            type="button"
            onClick={clearModerationError}
            aria-label="Dispensar"
            className="flex-none text-red-text/70 transition-colors hover:text-red-text focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {status === 'loading' && <p className="py-4 text-center text-label text-text-muted">Carregando contas…</p>}

      <div className="flex flex-col gap-0.5">
        {users.map((u) => (
          <UserRow
            key={u.id}
            user={u}
            online={u.online}
            isMe={u.id === state.me.userId}
            onDeleteRequest={() => setConfirmTarget(u)}
          />
        ))}
      </div>

      <ConfirmDialog
        open={!!confirmTarget}
        onOpenChange={(open) => { if (!open) setConfirmTarget(null); }}
        title="Apagar conta"
        description={`Isso apaga a conta de "${confirmTarget?.username}" para sempre. As mensagens que ela já mandou continuam no histórico, mas ela não consegue mais entrar.`}
        confirmLabel="Apagar"
        destructive
        onConfirm={handleConfirm}
      />
    </div>
  );
}
