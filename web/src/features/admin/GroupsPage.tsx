import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { Search } from 'lucide-react';
import { Segmented } from '@/features/friends/Segmented';
import { useCursorList } from '@/features/friends/useCursorList';
import { useDebouncedValue } from '@/features/friends/useDebouncedValue';
import { GroupAvatar } from '@/features/conversations/GroupAvatar';
import { fetchAdminGroups } from './adminApi';
import { formatWhen } from './adminFormat';
import { Badge, ListChrome } from './adminUi';

type StatusFilter = 'all' | 'active' | 'suspended' | 'orphan';

export function GroupsPage() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const q = useDebouncedValue(query.trim(), 250);
  const fetchPage = useCallback((cursor: string | null) => fetchAdminGroups({
    q, status: filter === 'active' || filter === 'suspended' ? filter : undefined, orphan: filter === 'orphan',
  }, cursor), [q, filter]);
  const list = useCursorList(fetchPage, `${q}|${filter}`);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-48 flex-1 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3">
          <Search size={15} className="text-text-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nome ou ID" aria-label="Buscar grupos"
            className="h-9 min-w-0 flex-1 bg-transparent text-label outline-none placeholder:text-text-muted" />
        </div>
        <Segmented<StatusFilter> label="Estado" value={filter} onChange={setFilter}
          options={[{ value: 'all', label: 'Todos' }, { value: 'active', label: 'Ativos' }, { value: 'suspended', label: 'Suspensos' }, { value: 'orphan', label: 'Sem dono' }]} />
      </div>
      <ListChrome list={list} empty="Nenhum grupo encontrado.">
        {list.items.map((g) => (
          <Link key={g.id} to={`/admin/groups/${g.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <GroupAvatar title={g.title} avatar={g.avatar} size={36} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-body font-medium text-text-primary">{g.title || 'Grupo sem nome'}</p>
              <p className="truncate text-caption text-text-muted">
                {g.memberCount} membro(s) · dono: {g.ownerUsername ? `@${g.ownerUsername}` : 'nenhum'} · criado em {formatWhen(g.createdAt)}
              </p>
            </div>
            {!g.ownerId && <span className="rounded bg-yellow/15 px-1.5 py-0.5 text-[11px] font-medium text-yellow">sem dono</span>}
            <Badge value={g.status} />
          </Link>
        ))}
      </ListChrome>
    </div>
  );
}
