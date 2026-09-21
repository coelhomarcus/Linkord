import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react';
import type { Area } from 'react-easy-crop';
import { motion } from 'motion/react';
import { Camera, Check, Crown, Flag, Link2, LogOut, Pencil, Trash2, Upload, UserPlus } from 'lucide-react';
import { CloseButton } from '@/shared/ui/primitives/close-button';
import { useAnimatedSidebar } from '@/shared/ui/motion/animated-sidebar';
import { Drawer } from '@/shared/ui/motion/drawer';
import { Button } from '@/shared/ui/primitives/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/primitives/dropdown-menu';
import { Input } from '@/shared/ui/primitives/input';
import { ImageCropDialog } from '@/features/settings/ImageCropDialog';
import { Avatar } from '@/shared/Avatar';
import { ConfirmDialog } from '@/shared/ConfirmDialog';
import { ImageUrlDialog } from '@/shared/ImageUrlDialog';
import { UploadProgressBar } from '@/shared/UploadProgressBar';
import { formatMB } from '@/shared/lib/formatBytes';
import { SPRING_LAYOUT } from '@/shared/lib/ease';
import { uploadWithProgress } from '@/shared/lib/uploadWithProgress';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '@/state/RoomContext';
import { AVATAR_MIME_TYPES, MAX_AVATAR_BYTES } from '@/shared/types/protocol';
import { GroupAvatar } from './GroupAvatar';
import { FriendPicker } from './FriendPicker';
import { describeInviteOutcome } from './inviteOutcome';
import { useFriends } from '@/features/friends/FriendsContext';
import { useCursorList } from '@/features/friends/useCursorList';
import { ReportDialog } from '@/features/reports/ReportDialog';
import { fetchGroupInvitations, fetchGroupMembers, inviteToGroup, revokeInvitation } from '@/shared/api/api';
import type { SocialUser } from '@/shared/api/api';

const PANEL_WIDTH = 360;

const fetchNothing = () => Promise.resolve({ items: [], nextCursor: null });

interface GroupDetailsPanelProps {
  conversationId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenProfile: (userId: string) => void;
}

export function GroupDetailsPanel({ conversationId, open, onOpenChange, onOpenProfile }: GroupDetailsPanelProps) {
  const {
    state, conversations, onlineUserIds,
    updateGroupTitle, updateGroupAvatar, removeGroupMember, deleteGroup, transferGroupOwnership,
    groupActionError, clearGroupActionError,
  } = useRoom();
  const { isMobile } = useAnimatedSidebar();
  const conversation = conversationId ? conversations.find((c) => c.id === conversationId) ?? null : null;
  // real per-group ownership, not the account's global instance role — see
  // conversationsRepository.ts#canManageGroup on the server.
  const isOwner = conversation?.myRole === 'owner';
  const memberIds = useMemo(() => new Set(conversation?.memberIds ?? []), [conversation?.memberIds]);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addSelected, setAddSelected] = useState<Map<string, SocialUser>>(new Map());
  const [inviting, setInviting] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<SocialUser | null>(null);
  const [transferTarget, setTransferTarget] = useState<SocialUser | null>(null);
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
  const [cropTarget, setCropTarget] = useState<{ kind: 'file'; file: File; src: string } | null>(null);
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarUploadProgress, setAvatarUploadProgress] = useState(0);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  // the group can disappear out from under an open panel (deleted, or the
  // viewer got removed) — conversation just becomes undefined in the list.
  useEffect(() => {
    if (open && conversationId && !conversation) onOpenChange(false);
  }, [open, conversationId, conversation, onOpenChange]);

  useEffect(() => {
    if (open) return;
    setEditingTitle(false);
    setAddOpen(false);
    setAddSelected(new Map());
    setInviteMessage(null);
    setAvatarError(null);
    setUrlDialogOpen(false);
    setTransferTarget(null);
    clearGroupActionError();
    setCropTarget((prev) => {
      if (prev?.kind === 'file') URL.revokeObjectURL(prev.src);
      return null;
    });
  }, [open, clearGroupActionError]);

  // Paged from the server (§6.3). The membership snapshot in the summary is
  // only used as a reset key: any join/leave/ownership change alters it.
  const membersKey = `${conversation?.id}|${conversation?.ownerId}|${conversation?.memberIds.join(',')}`;
  const fetchMembers = useCallback((cursor: string | null) => (
    conversationId ? fetchGroupMembers(conversationId, cursor) : Promise.resolve({ items: [], nextCursor: null })
  ), [conversationId]);
  const memberList = useCursorList(open && conversation ? fetchMembers : fetchNothing, `${membersKey}|${open}`);
  const { revision, bump } = useFriends();
  const fetchSent = useCallback((cursor: string | null) => (
    conversationId ? fetchGroupInvitations(conversationId, cursor) : Promise.resolve({ items: [], nextCursor: null })
  ), [conversationId]);
  // Pending invitees can't be invited again; only the owner may see (or fetch) them.
  const sent = useCursorList(isOwner && open ? fetchSent : fetchNothing, `${conversationId}|${isOwner && open}|${revision}`);
  const pendingIds = useMemo(() => new Set(sent.items.map((entry) => entry.invitee.id)), [sent.items]);
  const excludeIds = useMemo(() => new Set([...memberIds, ...pendingIds]), [memberIds, pendingIds]);

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

  function toggleAddCandidate(user: SocialUser) {
    setAddSelected((prev) => {
      const next = new Map(prev);
      if (next.has(user.id)) next.delete(user.id); else next.set(user.id, user);
      return next;
    });
  }

  async function confirmInvite() {
    if (!conversation || addSelected.size === 0 || inviting) return;
    setInviting(true);
    setInviteMessage(null);
    try {
      const { results } = await inviteToGroup(conversation.id, [...addSelected.keys()]);
      const failed = results.filter((r) => r.outcome !== 'sent');
      setInviteMessage(failed.length === 0
        ? 'Convites enviados.'
        : failed.map((r) => `${addSelected.get(r.userId)?.displayName ?? 'Usuário'}: ${describeInviteOutcome(r.outcome)}`).join(' · '));
      setAddSelected(new Map());
      if (failed.length === 0) setAddOpen(false);
      bump();
    } catch {
      setInviteMessage('Não foi possível enviar os convites. Tente de novo.');
    } finally {
      setInviting(false);
    }
  }

  async function handleRevoke(invitationId: string) {
    if (revokingId) return;
    setRevokingId(invitationId);
    try {
      await revokeInvitation(invitationId);
    } catch {
      setInviteMessage('Não foi possível revogar o convite.');
    } finally {
      bump();
      setRevokingId(null);
    }
  }

  function handleLeave() {
    if (!conversation || !state.me.userId) return;
    removeGroupMember(conversation.id, state.me.userId);
    // Don't close here — the owner leaving a group with other members gets
    // rejected (conflict, see groupActionError above) and needs the panel
    // to stay open to see why. On a successful leave, the conversation
    // disappears from `conversations` and the effect above closes this
    // panel on its own.
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

  function handleTransferOwnership() {
    if (!conversation || !transferTarget) return;
    transferGroupOwnership(conversation.id, transferTarget.id);
    setTransferTarget(null);
  }

  function handleAvatarFilePicked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError(`Arquivo muito grande (máximo ${formatMB(MAX_AVATAR_BYTES)}).`);
      return;
    }
    setAvatarError(null);
    setCropTarget({ kind: 'file', file, src: URL.createObjectURL(file) });
  }

  function handleAvatarUrlPicked(url: string) {
    if (!conversation) return;
    setAvatarError(null);
    updateGroupAvatar(conversation.id, url);
    setUrlDialogOpen(false);
  }

  function closeCropDialog() {
    setCropTarget((prev) => {
      if (prev?.kind === 'file') URL.revokeObjectURL(prev.src);
      return null;
    });
  }

  async function handleAvatarCropConfirm(crop: Area) {
    if (!conversation || !cropTarget) return;
    const conversationId = conversation.id;
    const target = cropTarget;
    setAvatarError(null);
    setAvatarUploadProgress(0);
    setUploadingAvatar(true);
    closeCropDialog();
    try {
      const body = await uploadWithProgress<{ avatar: string }>({
        url: `/api/avatar?crop=${encodeURIComponent(JSON.stringify(crop))}`,
        file: target.file,
        headers: { 'Content-Type': target.file.type || 'application/octet-stream' },
        onProgress: setAvatarUploadProgress,
      });
      updateGroupAvatar(conversationId, body.avatar);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Falha ao enviar a foto.');
    } finally {
      setUploadingAvatar(false);
    }
  }

  const content: ReactNode = conversation && (
    <>
      <div className="flex flex-none items-center gap-2 border-b border-white/10 px-5 py-4">
        <h2 className="flex-1 text-title font-semibold">Detalhes do grupo</h2>
        <CloseButton onClick={() => onOpenChange(false)} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
        {groupActionError && (
          <div className="flex items-center gap-2 rounded-md bg-red/12 px-2.5 py-1.5 text-label text-red-text">
            <span className="min-w-0 flex-1">{groupActionError}</span>
            <CloseButton size="xs" label="Dispensar" onClick={clearGroupActionError} />
          </div>
        )}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="relative">
            <GroupAvatar title={conversation.title || 'Grupo'} avatar={conversation.avatar} size={64} />
            {isOwner && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  disabled={uploadingAvatar}
                  render={
                    <button
                      type="button"
                      aria-label="Trocar foto do grupo"
                      className="absolute -bottom-1 -right-1 grid size-6 place-items-center rounded-full border border-white/10 bg-[rgb(20_20_22)] text-text-secondary transition-colors hover:text-text-primary disabled:opacity-50"
                    />
                  }
                >
                  <Camera size={12} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center">
                  <DropdownMenuItem onClick={() => avatarFileInputRef.current?.click()}>
                    <Upload size={14} />
                    <span>Enviar do computador</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setUrlDialogOpen(true)}>
                    <Link2 size={14} />
                    <span>Usar URL</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {isOwner && (
            <input
              ref={avatarFileInputRef}
              type="file"
              accept={AVATAR_MIME_TYPES.join(',')}
              hidden
              aria-label="Selecionar foto do grupo"
              onChange={handleAvatarFilePicked}
            />
          )}
          {uploadingAvatar && (
            <div className="flex w-full max-w-40 items-center gap-2">
              <UploadProgressBar progress={avatarUploadProgress} />
              <span className="flex-none text-caption tabular-nums text-text-muted">{Math.round(avatarUploadProgress * 100)}%</span>
            </div>
          )}
          {avatarError && <p className="text-label text-red">{avatarError}</p>}
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
              onClick={isOwner ? startEditTitle : undefined}
              className={cn(
                'flex items-center gap-1.5 text-title font-semibold',
                isOwner && 'transition-colors hover:text-primary'
              )}
            >
              {conversation.title || 'Grupo'}
              {isOwner && <Pencil size={13} className="text-text-muted" />}
            </button>
          )}
          <p className="text-caption text-text-muted">{conversation.memberCount} {conversation.memberCount === 1 ? 'membro' : 'membros'}</p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-label font-medium text-text-secondary">Membros</h3>
            {isOwner && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setAddOpen((v) => !v)} className="gap-1.5 text-text-muted hover:text-text-primary">
                <UserPlus size={14} />
                Convidar amigos
              </Button>
            )}
          </div>

          {addOpen && (
            <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2">
              <p className="px-1 text-caption text-text-muted">Só entram no grupo ao aceitar o convite.</p>
              <FriendPicker selected={addSelected} onToggle={toggleAddCandidate} excludeIds={excludeIds} maxHeightClass="max-h-48" />
              <Button type="button" size="sm" onClick={() => void confirmInvite()} disabled={addSelected.size === 0 || inviting} className="mt-1">
                {inviting ? 'Enviando…' : `Convidar ${addSelected.size > 0 ? `(${addSelected.size})` : ''}`}
              </Button>
            </div>
          )}
          {inviteMessage && <p role="status" className="px-1 text-caption text-text-muted">{inviteMessage}</p>}

          <div className="flex flex-col gap-1">
            {memberList.items.map(({ user: member, role }) => {
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
                      <span className="block truncate text-label font-medium">
                        {member.displayName}{isMe ? ' (você)' : ''}
                        {role === 'owner' && <span className="ml-1.5 rounded bg-primary/15 px-1 py-px align-middle text-[10px] font-medium text-primary">dono</span>}
                      </span>
                      <span className="block truncate text-caption text-text-muted">@{member.username}</span>
                    </span>
                  </button>
                  {isOwner && !isMe && (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Transferir propriedade para ${member.displayName}`}
                        onClick={() => setTransferTarget(member)}
                        className="flex-none text-text-muted opacity-0 transition-opacity hover:text-primary group-hover:opacity-100"
                      >
                        <Crown size={14} />
                      </Button>
                      <CloseButton
                        variant="danger"
                        size="xs"
                        label={`Remover ${member.displayName}`}
                        onClick={() => setRemoveTarget(member)}
                        className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                      />
                    </>
                  )}
                </div>
              );
            })}
            {memberList.status === 'loading' && memberList.items.length === 0 && (
              <p className="px-2 py-3 text-center text-caption text-text-muted">Carregando membros…</p>
            )}
            {memberList.status === 'error' && (
              <div className="flex flex-col items-center gap-2 px-2 py-3">
                <p className="text-caption text-text-muted">Não foi possível carregar os membros.</p>
                <Button type="button" variant="secondary" size="sm" onClick={memberList.retry}>Tentar de novo</Button>
              </div>
            )}
            {memberList.hasMore && (
              <Button type="button" variant="ghost" size="sm" className="self-center" disabled={memberList.loadingMore} onClick={memberList.loadMore}>
                {memberList.loadingMore ? 'Carregando…' : 'Carregar mais'}
              </Button>
            )}
          </div>
        </div>

        {isOwner && sent.items.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-label font-medium text-text-secondary">Convites enviados</h3>
            <div className="flex flex-col gap-1">
              {sent.items.map((entry) => (
                <div key={entry.id} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-white/[0.04]">
                  <Avatar id={entry.invitee.id} name={entry.invitee.displayName} avatar={entry.invitee.avatar} avatarColor={entry.invitee.avatarColor} size={34} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-label font-medium">{entry.invitee.displayName}</span>
                    <span className="block truncate text-caption text-text-muted">
                      enviado em {new Date(entry.at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                    </span>
                  </span>
                  <Button type="button" variant="ghost" size="xs" disabled={revokingId === entry.id} onClick={() => void handleRevoke(entry.id)}>
                    Revogar
                  </Button>
                </div>
              ))}
            </div>
            {sent.hasMore && (
              <Button type="button" variant="ghost" size="sm" className="self-center" disabled={sent.loadingMore} onClick={sent.loadMore}>
                {sent.loadingMore ? 'Carregando…' : 'Carregar mais'}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-none flex-col gap-2 border-t border-white/10 px-5 py-4">
        <Button type="button" variant="ghost" onClick={() => setConfirmLeave(true)} className="justify-start gap-2 text-text-secondary hover:text-text-primary">
          <LogOut size={15} />
          Sair do grupo
        </Button>
        <Button type="button" variant="ghost" onClick={() => setReportOpen(true)} className="justify-start gap-2 text-text-muted hover:text-text-primary">
          <Flag size={15} />
          Denunciar grupo
        </Button>
        {isOwner && (
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
          className="flex-none overflow-hidden bg-bg-primary text-text-primary will-change-[width]"
        >
          <div className="flex h-full flex-col" style={{ width: PANEL_WIDTH }}>
            {content}
          </div>
        </motion.aside>
      )}

      <ImageCropDialog
        open={!!cropTarget}
        imageSrc={cropTarget?.src ?? null}
        aspect={1}
        cropShape="rect"
        title="Recortar foto do grupo"
        onCancel={closeCropDialog}
        onConfirm={handleAvatarCropConfirm}
      />

      <ImageUrlDialog
        open={urlDialogOpen}
        title="URL da foto do grupo"
        onOpenChange={setUrlDialogOpen}
        onConfirm={handleAvatarUrlPicked}
      />

      {conversation && (
        <ReportDialog target={{ type: 'group', id: conversation.id, label: conversation.title || 'grupo' }} open={reportOpen} onOpenChange={setReportOpen} />
      )}
      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="Sair do grupo"
        description={`Você vai sair de "${conversation?.title || 'grupo'}" e parar de receber as mensagens dele.`}
        confirmLabel="Sair"
        destructive
        onConfirm={handleLeave}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Excluir grupo"
        description={`Isso apaga "${conversation?.title || 'grupo'}" e TODAS as mensagens dele para todo mundo, para sempre. Essa ação não pode ser desfeita.`}
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
      <ConfirmDialog
        open={!!transferTarget}
        onOpenChange={(next) => { if (!next) setTransferTarget(null); }}
        title="Transferir propriedade"
        description={`${transferTarget?.displayName ?? ''} passa a ser o dono de "${conversation?.title || 'grupo'}" — você perde os controles de gestão do grupo.`}
        confirmLabel="Transferir"
        destructive
        onConfirm={handleTransferOwnership}
      />
    </>
  );
}
