import { ShieldCheck } from 'lucide-react';
import { useRoom } from '../../state/RoomContext';
import { Avatar } from '../../shared/Avatar';
import { sectionLabelClass } from '../../shared/SectionLabel';
import type { PublicUser } from '../../types/protocol';

function UserRow({ user, online }: { user: PublicUser; online: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-bg-hover">
      <div className="relative flex-none">
        <Avatar id={user.id} name={user.username} avatar={user.avatar} size={44} />
        {/* bolinha de status — verde preenchido = online, cinza SOLIDO =
            offline (era bg-text-muted/40 — a opacidade sobre fundo escuro
            lia como quase transparente, nao como uma bolinha cinza de
            verdade). */}
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-bg-secondary ${online ? 'bg-green' : 'bg-text-muted'}`}
        />
      </div>
      <span className={`min-w-0 flex-1 truncate text-body ${online ? 'text-text-secondary' : 'text-text-muted'}`}>{user.username}</span>
      {user.role === 'admin' && <ShieldCheck size={16} className="flex-none text-blurple" />}
    </div>
  );
}

/** Diretorio de TODAS as contas cadastradas, agrupado online/offline — igual
 * a lista de membros do Discord. So aparece na pagina de Chat (pedido
 * explicito), nao em Chamada/Quadro. */
export function UserDirectory() {
  const { allUsers, onlineUserIds } = useRoom();

  const users = [...allUsers.values()].sort((a, b) => a.username.localeCompare(b.username));
  const online = users.filter((u) => onlineUserIds.has(u.id));
  const offline = users.filter((u) => !onlineUserIds.has(u.id));

  return (
    // bg-bg-secondary (nao bg-bg-panel, usado pelo conteudo principal do
    // Chat) de proposito — o Discord real diferencia sutilmente a coluna de
    // membros da area de mensagens (ver kit "Discord UI - Free UI Kit").
    <aside className="flex w-60 flex-none flex-col overflow-y-auto border-l border-subtle bg-bg-secondary p-2">
      {online.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <p className={`${sectionLabelClass} px-2 pb-1 pt-2 first:pt-1`}>Online ({online.length})</p>
          {online.map((u) => <UserRow key={u.id} user={u} online />)}
        </div>
      )}
      {offline.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <p className={`${sectionLabelClass} px-2 pb-1 pt-2`}>Offline ({offline.length})</p>
          {offline.map((u) => <UserRow key={u.id} user={u} online={false} />)}
        </div>
      )}
    </aside>
  );
}
