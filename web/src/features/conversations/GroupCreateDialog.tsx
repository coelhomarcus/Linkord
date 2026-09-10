import { useMemo, useState } from 'react';
import { Check, Search, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar } from '@/shared/Avatar';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '@/state/RoomContext';

interface GroupCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GroupCreateDialog({ open, onOpenChange }: GroupCreateDialogProps) {
  const { state, allUsers, createGroup } = useRoom();
  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const users = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return [...allUsers.values()]
      .filter((user) => user.id !== state.me.userId)
      .filter((user) => !normalized || user.displayName.toLowerCase().includes(normalized) || user.username.toLowerCase().includes(normalized))
      .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.username.localeCompare(b.username));
  }, [allUsers, query, state.me.userId]);

  function toggle(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function handleSubmit() {
    const name = title.trim();
    if (!name) return;
    createGroup(name, [...selected]);
    setTitle('');
    setQuery('');
    setSelected(new Set());
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-white/10 bg-[rgb(18_18_20)] p-0 text-text-primary">
        <DialogHeader className="border-b border-white/10 px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-title">
            <UsersRound size={18} />
            Novo grupo
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="group-title" className="text-label text-text-muted">Nome</Label>
            <Input
              id="group-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={80}
              placeholder="Ex: Produto, familia, squad"
              className="border-white/10 bg-white/[0.04]"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="group-users" className="text-label text-text-muted">Adicionar pessoas</Label>
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3">
              <Search size={15} className="text-text-muted" />
              <input
                id="group-users"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar usuarios"
                className="h-9 min-w-0 flex-1 bg-transparent text-label outline-none placeholder:text-text-muted"
              />
            </div>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-1">
              {users.length === 0 ? (
                <p className="px-3 py-8 text-center text-label text-text-muted">Nenhum usuario encontrado.</p>
              ) : users.map((user) => {
                const checked = selected.has(user.id);
                return (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => toggle(user.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors',
                      checked ? 'bg-primary/12 text-text-primary' : 'text-text-secondary hover:bg-white/[0.05]'
                    )}
                  >
                    <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-label font-medium">{user.displayName}</span>
                      <span className="block truncate text-caption text-text-muted">@{user.username}</span>
                    </span>
                    <span className={cn(
                      'grid size-5 place-items-center rounded-full border text-[11px]',
                      checked ? 'border-primary bg-primary text-primary-foreground' : 'border-white/15'
                    )}>
                      {checked ? <Check size={12} /> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <DialogFooter className="border-t border-white/10 px-5 py-4">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" onClick={handleSubmit} disabled={!title.trim()}>
            Criar grupo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
