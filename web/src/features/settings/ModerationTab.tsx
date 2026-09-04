import { useMemo, useState } from 'react';
import { ShieldCheck, Trash2, X } from 'lucide-react';
import { useRoom } from '../../state/RoomContext';
import { Avatar } from '../../shared/Avatar';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import type { PublicUser } from '../../types/protocol';
import { Button } from '@/components/ui/button';

function UserRow({ user, online, isMe, onDeleteRequest }: {
  user: PublicUser;
  online: boolean;
  isMe: boolean;
  onDeleteRequest: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-bg-hover">
      <div className="relative flex-none">
        <Avatar id={user.id} name={user.username} avatar={user.avatar} size={32} />
        {/* mesma linguagem do UserDirectory (chat): verde preenchido = online,
            cinza solido = offline. */}
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-bg-tertiary ${online ? 'bg-green' : 'bg-text-muted'}`}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-medium text-text-primary">
          {user.username}
          {isMe && <span className="ml-1.5 text-label font-normal text-text-muted">(voce)</span>}
        </p>
        <p className="select-none text-caption text-text-muted">{online ? 'Online' : 'Offline'}</p>
      </div>
      {user.role === 'admin' && <ShieldCheck size={16} className="flex-none text-blurple" />}
      {/* apagar a propria conta por aqui fica bloqueado tanto na UI (disabled)
          quanto no servidor (server/moderation.js revalida de novo) — a UI
          so evita o clique inutil, nunca e a unica trava. */}
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

/** Aba "Moderacao" dos Ajustes — admin-only (SettingsModal so mostra a
 * TabsTrigger quando state.me.role==='admin', e o servidor revalida de
 * novo em cada acao, nunca confia so no botao escondido). Hoje faz uma
 * coisa: apagar conta. Reaproveita o mesmo `allUsers`/`onlineUserIds` que
 * ja alimenta o UserDirectory do chat — nao busca nada novo, so lista o
 * que o app ja tem em memoria. */
export function ModerationTab() {
  const { state, allUsers, onlineUserIds, deleteUserAccount, moderationError, clearModerationError } = useRoom();
  const [confirmTarget, setConfirmTarget] = useState<PublicUser | null>(null);

  const users = useMemo(
    () => [...allUsers.values()].sort((a, b) => a.username.localeCompare(b.username)),
    [allUsers]
  );

  function handleConfirm() {
    if (confirmTarget) deleteUserAccount(confirmTarget.id);
    setConfirmTarget(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="select-none text-label text-text-muted">
        Apagar uma conta e definitivo. A pessoa nao consegue mais entrar. As mensagens que ela ja mandou continuam no historico do chat.
      </p>

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

      <div className="flex flex-col gap-0.5">
        {users.map((u) => (
          <UserRow
            key={u.id}
            user={u}
            online={onlineUserIds.has(u.id)}
            isMe={u.id === state.me.userId}
            onDeleteRequest={() => setConfirmTarget(u)}
          />
        ))}
      </div>

      <ConfirmDialog
        open={!!confirmTarget}
        onOpenChange={(open) => { if (!open) setConfirmTarget(null); }}
        title="Apagar conta"
        description={`Isso apaga a conta de "${confirmTarget?.username}" pra sempre. As mensagens que ela ja mandou continuam no historico, mas ela nao consegue mais entrar.`}
        confirmLabel="Apagar"
        destructive
        onConfirm={handleConfirm}
      />
    </div>
  );
}
