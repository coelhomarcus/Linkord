import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { motion } from 'motion/react';
import { Check, LogOut, Pencil, Search, Trash2, UserPlus, X } from 'lucide-react';
import { useAnimatedSidebar } from '@/components/motion/animated-sidebar';
import { Drawer } from '@/components/motion/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar } from '@/shared/Avatar';
import { ConfirmDialog } from '@/shared/ConfirmDialog';
import { SPRING_LAYOUT } from '@/shared/lib/ease';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '@/state/RoomContext';
import type { PublicUser } from '@/types/protocol';
import { conversationInitials, groupMembers } from './conversationUtils';

const PANEL_WIDTH = 360;

interface GroupDetailsPanelProps {
  conversationId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenProfile: (userId: string) => void;
}

export function GroupDetailsPanel({ conversationId, open, onOpenChange, onOpenProfile }: GroupDetailsPanelProps) {
  const {
    state, conversations, allUsers, onlineUserIds,
    updateGroupTitle, addGroupMembers, removeGroupMember, deleteGroup,
  } = useRoom();
  const { isMobile } = useAnimatedSidebar();
  const conversation = conversationId ? conversations.find((c) => c.id === conversationId) ?? null : null;
  const isAdmin = state.me.role === 'admin';
  const members = useMemo(() => groupMembers(conversation, allUsers), [conversation, allUsers]);
  const memberIds = useMemo(() => new Set(members.map((m) => m.id)), [members]);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set());
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<PublicUser | null>(null);

  // the group can disappear out from under an open panel (deleted, or the
  // viewer got removed) — conversation just becomes undefined in the list.
  useEffect(() => {
    if (open && conversationId && !conversation) onOpenChange(false);
  }, [open, conversationId, conversation, onOpenChange]);

  useEffect(() => {
    if (open) return;
    setEditingTitle(false);
    setAddOpen(false);
    setAddQuery('');
    setAddSelected(new Set());
  }, [open]);

  const addCandidates = useMemo(() => {
    const normalized = addQuery.trim().toLowerCase();
    return [...allUsers.values()]
      .filter((user) => !memberIds.has(user.id))
      .filter((user) => !normalized || user.displayName.toLowerCase().includes(normalized) || user.username.toLowerCase().includes(normalized))
      .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.username.localeCompare(b.username));
  }, [allUsers, addQuery, memberIds]);

  function startEditTitle() {
    if (!conversation) return;
    setTitleDraft(conversation.title || '');
    setEditingTitle(true);
  }

  function saveTitle() {
    if (!conversation) return;
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== conversation.title) updateGroupTitle(conversation.id, trimmed);
    setEditingTitle(false);
  }

  function onTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') saveTitle();
    if (event.key === 'Escape') setEditingTitle(false);
  }

  function toggleAddCandidate(userId: string) {
    setAddSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  }

  function confirmAddMembers() {
    if (!conversation || addSelected.size === 0) return;
    addGroupMembers(conversation.id, [...addSelected]);
    setAddOpen(false);
    setAddQuery('');
    setAddSelected(new Set());
  }

  function handleLeave() {
    if (!conversation || !state.me.userId) return;
    removeGroupMember(conversation.id, state.me.userId);
    onOpenChange(false);
  }

  function handleDelete() {
    if (!conversation) return;
    deleteGroup(conversation.id);
    onOpenChange(false);
  }

  function handleRemoveMember() {
    if (!conversation || !removeTarget) return;
    removeGroupMember(conversation.id, removeTarget.id);
    setRemoveTarget(null);
  }

  const content: ReactNode = conversation && (
    <>
      <div className="flex flex-none items-center gap-2 border-b border-white/10 px-5 py-4">
        <h2 className="flex-1 text-title font-semibold">Detalhes do grupo</h2>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Fechar" onClick={() => onOpenChange(false)}>
          <X size={16} />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="grid size-16 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-title font-semibold text-text-secondary">
            {conversationInitials(conversation.title || 'Grupo')}
          </div>
          {editingTitle ? (
            <div className="flex w-full items-center gap-2">
              <Input
                autoFocus
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onKeyDown={onTitleKeyDown}
                maxLength={80}
                className="border-white/10 bg-white/[0.04] text-center"
              />
              <Button type="button" size="icon-sm" aria-label="Salvar nome" onClick={saveTitle} disabled={!titleDraft.trim()}>
                <Check size={14} />
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={isAdmin ? startEditTitle : undefined}
              className={cn(
                'flex items-center gap-1.5 text-title font-semibold',
                isAdmin && 'transition-colors hover:text-primary'
              )}
            >
              {conversation.title || 'Grupo'}
              {isAdmin && <Pencil size={13} className="text-text-muted" />}
            </button>
          )}
          <p className="text-caption text-text-muted">{members.length} membros</p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-label font-medium text-text-secondary">Membros</h3>
            {isAdmin && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setAddOpen((v) => !v)} className="gap-1.5 text-text-muted hover:text-text-primary">
                <UserPlus size={14} />
                Adicionar
              </Button>
            )}
          </div>

          {addOpen && (
            <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2">
              <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3">
                <Search size={14} className="text-text-muted" />
                <input
                  autoFocus
                  value={addQuery}
                  onChange={(event) => setAddQuery(event.target.value)}
                  placeholder="Buscar pessoas"
                  className="h-9 min-w-0 flex-1 bg-transparent text-label outline-none placeholder:text-text-muted"
                />
              </div>
              <div className="max-h-48 overflow-y-auto">
                {addCandidates.length === 0 ? (
                  <p className="px-2 py-4 text-center text-caption text-text-muted">Ninguem encontrado.</p>
                ) : addCandidates.map((user) => {
                  const checked = addSelected.has(user.id);
                  return (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => toggleAddCandidate(user.id)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors',
                        checked ? 'bg-primary/12 text-text-primary' : 'text-text-secondary hover:bg-white/[0.05]'
                      )}
                    >
                      <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={28} />
                      <span className="min-w-0 flex-1 truncate text-label">{user.displayName}</span>
                      <span className={cn(
                        'grid size-4.5 flex-none place-items-center rounded-full border text-[10px]',
                        checked ? 'border-primary bg-primary text-primary-foreground' : 'border-white/15'
                      )}>
                        {checked ? <Check size={11} /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
              <Button type="button" size="sm" onClick={confirmAddMembers} disabled={addSelected.size === 0} className="mt-1">
                Adicionar {addSelected.size > 0 ? `(${addSelected.size})` : ''}
              </Button>
            </div>
          )}

          <div className="flex flex-col gap-1">
            {members.map((member) => {
              const online = onlineUserIds.has(member.id);
              const isMe = member.id === state.me.userId;
              return (
                <div key={member.id} className="group flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-white/[0.04]">
                  <button type="button" onClick={() => onOpenProfile(member.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                    <div className="relative flex-none">
                      <Avatar id={member.id} name={member.displayName} avatar={member.avatar} avatarColor={member.avatarColor} size={34} />
                      <span className={cn('absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-[rgb(14_14_16)]', online ? 'bg-green' : 'bg-text-muted')} />
                    </div>
                    <span className="min-w-0">
                      <span className="block truncate text-label font-medium">{member.displayName}{isMe ? ' (voce)' : ''}</span>
                      <span className="block truncate text-caption text-text-muted">@{member.username}</span>
                    </span>
                  </button>
                  {isAdmin && !isMe && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remover ${member.displayName}`}
                      onClick={() => setRemoveTarget(member)}
                      className="flex-none text-text-muted opacity-0 transition-opacity hover:text-red-text group-hover:opacity-100"
                    >
                      <X size={14} />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex flex-none flex-col gap-2 border-t border-white/10 px-5 py-4">
        <Button type="button" variant="ghost" onClick={() => setConfirmLeave(true)} className="justify-start gap-2 text-text-secondary hover:text-text-primary">
          <LogOut size={15} />
          Sair do grupo
        </Button>
        {isAdmin && (
          <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)} className="justify-start gap-2 text-red-text hover:bg-red/10 hover:text-red-text">
            <Trash2 size={15} />
            Excluir grupo
          </Button>
        )}
      </div>
    </>
  );

  return (
    <>
      {isMobile ? (
        <Drawer
          open={open && !!conversation}
          onOpenChange={onOpenChange}
          ariaLabel="Detalhes do grupo"
          className="flex w-96 flex-col border-white/10 bg-[rgb(14_14_16)] text-text-primary"
        >
          {content}
        </Drawer>
      ) : (
        <motion.aside
          aria-label="Detalhes do grupo"
          aria-hidden={!open || !conversation}
          initial={false}
          animate={{ width: open && conversation ? PANEL_WIDTH : 0, opacity: open && conversation ? 1 : 0 }}
          transition={SPRING_LAYOUT}
          className="my-2 mr-2 flex-none overflow-hidden rounded-2xl border border-white/10 bg-[rgb(14_14_16)] text-text-primary will-change-[width]"
        >
          <div className="flex h-full flex-col" style={{ width: PANEL_WIDTH }}>
            {content}
          </div>
        </motion.aside>
      )}

      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="Sair do grupo"
        description={`Voce vai sair de "${conversation?.title || 'grupo'}" e parar de receber as mensagens dele.`}
        confirmLabel="Sair"
        destructive
        onConfirm={handleLeave}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Excluir grupo"
        description={`Isso apaga "${conversation?.title || 'grupo'}" e TODAS as mensagens dele para todo mundo, para sempre. Essa acao nao pode ser desfeita.`}
        confirmLabel="Excluir"
        destructive
        onConfirm={handleDelete}
      />
      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(next) => { if (!next) setRemoveTarget(null); }}
        title="Remover do grupo"
        description={`Remover ${removeTarget?.displayName ?? ''} de "${conversation?.title || 'grupo'}"?`}
        confirmLabel="Remover"
        destructive
        onConfirm={handleRemoveMember}
      />
    </>
  );
}
