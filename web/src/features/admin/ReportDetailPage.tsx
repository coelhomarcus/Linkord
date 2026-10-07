import { useState } from 'react';
import { Flag } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { Button } from '@/shared/ui/primitives/button';
import { categoryLabel } from '@/features/reports/reportCategories';
import { claimReport, fetchAdminReport, resolveReport } from './adminApi';
import type { ReportAction } from './adminApi';
import { AdminEntityHeader } from './AdminEntityHeader';
import { AdminActionRow, AdminFieldRow, AdminFields, AdminSection } from './AdminSection';
import { ReasonDialog } from './ReasonDialog';
import { REPORT_RESOLUTION_LABEL, REPORT_TARGET_LABEL, formatWhen } from './adminFormat';
import { AuditList, Badge, DetailStatusView, RefreshFailedNotice } from './adminUi';
import { RESTORE_LIST, useAdminBack } from './useAdminBack';
import { useAdminDetail } from './useAdminDetail';

/** What the admin picked in the decision form: close with an action on the
 * target, close without one, or dismiss. */
type OutcomeId = ReportAction | 'no_action' | 'dismiss';
type Dialog = { kind: 'claim' } | { kind: 'decide'; outcome: OutcomeId } | null;

interface Outcome { id: OutcomeId; label: string; effect: string; destructive: boolean }

const ACTION_OUTCOMES: Record<ReportAction, Outcome> = {
  suspend_user: { id: 'suspend_user', label: 'Suspender a conta', effect: 'A conta perde a sessão agora e não consegue entrar até ser reativada.', destructive: true },
  suspend_group: { id: 'suspend_group', label: 'Suspender o grupo', effect: 'Os membros deixam de ler, escrever e entrar em chamada até a reativação.', destructive: true },
  delete_message: { id: 'delete_message', label: 'Apagar a mensagem', effect: 'A mensagem é removida para todos; o snapshot da denúncia permanece.', destructive: true },
};
const NO_ACTION: Outcome = { id: 'no_action', label: 'Resolver sem ação', effect: 'Encerra como resolvida, sem nenhuma ação sobre o alvo.', destructive: false };
const DISMISS: Outcome = { id: 'dismiss', label: 'Dispensar', effect: 'Encerra a denúncia como improcedente, sem nenhuma ação sobre o alvo.', destructive: false };

/** Only what the product allows for this kind of target. A message report can
 * also suspend its AUTHOR — never its group, which is another target. */
function outcomesFor(targetType: string): Outcome[] {
  const actions: ReportAction[] = targetType === 'user' ? ['suspend_user'] : targetType === 'group' ? ['suspend_group'] : ['delete_message', 'suspend_user'];
  return [...actions.map((action) => ACTION_OUTCOMES[action]), NO_ACTION, DISMISS];
}

const outcomeText = (outcome: Outcome) => (outcome.id === 'suspend_user' || outcome.id === 'suspend_group' || outcome.id === 'delete_message'
  ? `${outcome.effect} A denúncia é encerrada.` : outcome.effect);

/** Keyed by id so a different report never inherits a half-made decision. */
export function ReportDetailPage() {
  const { id = '' } = useParams();
  return <ReportDetail key={id} id={id} />;
}

/** Opening this page is what fetches — and audits — the evidence. The reporter
 * is shown to administrators only; nothing on the reported account's side can
 * reach this. The evidence is the stored snapshot, shown as inert text: no
 * links are followed, nothing is previewed, the live conversation is not read. */
function ReportDetail({ id }: { id: string }) {
  const back = useAdminBack('/admin/reports');
  const { data: detail, status, refresh, mutate, refreshing, refreshFailed, reload } = useAdminDetail(id, fetchAdminReport);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [selected, setSelected] = useState<OutcomeId | null>(null);

  if (!detail) return <DetailStatusView status={status} missing="Denúncia não encontrada." failed="Não foi possível carregar a denúncia." backTo={back} backLabel="Voltar" onRetry={reload} />;

  const { report, history } = detail;
  const closed = report.status === 'resolved' || report.status === 'dismissed';
  const snapshot = report.snapshot;
  const snapshotText = typeof snapshot.text === 'string' ? snapshot.text : null;
  const authorId = typeof snapshot.authorId === 'string' && snapshot.authorId ? snapshot.authorId : null;
  const targetHref = report.targetType === 'user' ? `/admin/users/${report.targetId}` : report.targetType === 'group' ? `/admin/groups/${report.targetId}` : null;
  const outcomes = outcomesFor(report.targetType);
  const chosen = outcomes.find((o) => o.id === selected) ?? null;
  const deciding = dialog?.kind === 'decide' ? outcomes.find((o) => o.id === dialog.outcome) ?? null : null;

  const decide = (outcome: Outcome, reason: string) => mutate(() => resolveReport(report.id, {
    reason, dismiss: outcome.id === 'dismiss',
    action: outcome.id === 'dismiss' || outcome.id === 'no_action' ? null : outcome.id,
  }));

  return (
    <div className="flex flex-col gap-5">
      <Link to={back} state={RESTORE_LIST} className="w-fit text-caption text-text-muted underline">← Denúncias</Link>
      {refreshFailed && <RefreshFailedNotice refreshing={refreshing} onRetry={() => void refresh()} />}

      <AdminEntityHeader
        avatar={<span className="flex size-16 items-center justify-center rounded-full bg-white/10 text-text-muted"><Flag size={26} aria-hidden /></span>}
        title={report.targetLabel || report.targetId}
        subtitle={`${REPORT_TARGET_LABEL[report.targetType]} · ${categoryLabel(report.category)}`}
        id={report.id}
        badges={<Badge value={report.status} />}
      />

      {report.targetType === 'message' ? (
        <AdminSection title="Evidência" description="O texto como estava quando a denúncia foi enviada — não é a conversa atual.">
          <p className="whitespace-pre-wrap break-words rounded-lg bg-black/30 p-3 text-label text-text-primary">{snapshotText ?? '—'}</p>
          {snapshot.truncated === true && (
            <p className="text-caption text-yellow">O texto foi truncado ao ser guardado; o original completo não está disponível aqui.</p>
          )}
          <AdminFields>
            <AdminFieldRow label="Autor">
              {authorId ? <Link to={`/admin/users/${authorId}`} className="hover:underline">@{String(snapshot.authorUsername ?? authorId)}</Link> : 'conta apagada'}
            </AdminFieldRow>
            <AdminFieldRow label="Conversa">{String(snapshot.conversationTitle ?? '—')}</AdminFieldRow>
            <AdminFieldRow label="Enviada em">{formatWhen(String(snapshot.sentAt ?? ''))}</AdminFieldRow>
          </AdminFields>
        </AdminSection>
      ) : (
        <AdminSection title="Alvo" description="Esta denúncia não guarda conteúdo: o alvo é identificado pelo nome e pelo ID.">
          <AdminFields>
            <AdminFieldRow label="Tipo">{REPORT_TARGET_LABEL[report.targetType]}</AdminFieldRow>
            <AdminFieldRow label="Nome">{report.targetLabel || '—'}</AdminFieldRow>
            <AdminFieldRow label="ID"><span className="break-all font-mono text-caption">{report.targetId}</span></AdminFieldRow>
            {targetHref && <AdminFieldRow label="Administração"><Link to={targetHref} className="underline">Abrir no admin</Link></AdminFieldRow>}
          </AdminFields>
        </AdminSection>
      )}

      <AdminSection title="Denúncia">
        <AdminFields>
          <AdminFieldRow label="Relato">{report.details ? <span className="whitespace-pre-wrap">{report.details}</span> : 'Sem relato.'}</AdminFieldRow>
          <AdminFieldRow label="Denunciante (só a administração vê)">{report.reporter ? `@${report.reporter}` : 'conta apagada'}</AdminFieldRow>
          <AdminFieldRow label="Enviada em">{formatWhen(report.createdAt)}</AdminFieldRow>
          <AdminFieldRow label="Responsável">{report.assignee ? `@${report.assignee}` : '—'}</AdminFieldRow>
        </AdminFields>
      </AdminSection>

      {closed ? (
        <AdminSection title="Desfecho">
          <AdminFields>
            <AdminFieldRow label="Resultado">{report.status === 'dismissed' ? 'Dispensada' : REPORT_RESOLUTION_LABEL[report.resolution] ?? (report.resolution || 'Resolvida')}</AdminFieldRow>
            <AdminFieldRow label="Motivo">“{report.resolutionNote}”</AdminFieldRow>
            <AdminFieldRow label="Encerrada em">{formatWhen(report.resolvedAt)}</AdminFieldRow>
          </AdminFields>
        </AdminSection>
      ) : (
        <AdminSection title="Decisão" description="Escolha o desfecho, confira o efeito e confirme com um motivo. Nada acontece antes da confirmação.">
          {report.status === 'open' && (
            <AdminActionRow title="Assumir análise" description="Você passa a constar como responsável e a denúncia vai para “Em análise”. Isso não impede que outra pessoa decida.">
              <Button type="button" size="sm" variant="secondary" onClick={() => setDialog({ kind: 'claim' })}>Assumir análise</Button>
            </AdminActionRow>
          )}
          <fieldset className="flex flex-col gap-1 py-2">
            <legend className="mb-1 text-body font-medium text-text-primary">Desfecho</legend>
            {outcomes.map((outcome) => (
              <label key={outcome.id} className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-white/5 has-[:checked]:bg-white/[0.06] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                <input type="radio" name="outcome" value={outcome.id} checked={selected === outcome.id} onChange={() => setSelected(outcome.id)} className="mt-1" />
                <span className="min-w-0">
                  <span className="block text-label font-medium text-text-primary">{outcome.label}</span>
                  <span className="block text-caption text-text-muted">{outcomeText(outcome)}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="flex justify-end">
            <Button type="button" variant={chosen?.destructive ? 'destructive' : 'default'} disabled={!chosen} onClick={() => chosen && setDialog({ kind: 'decide', outcome: chosen.id })}>
              {chosen ? `Continuar: ${chosen.label}` : 'Escolha um desfecho'}
            </Button>
          </div>
        </AdminSection>
      )}

      <AdminSection title="Histórico" description="Análise, resolução e a ação aplicada, da mais recente à mais antiga.">
        <AuditList items={history} />
      </AdminSection>

      <ReasonDialog open={dialog?.kind === 'claim'} onOpenChange={(o) => !o && setDialog(null)} title="Assumir análise"
        description="A denúncia passa para “Em análise” com você como responsável." confirmLabel="Assumir"
        onSubmit={(reason) => mutate(() => claimReport(report.id, reason))} />
      <ReasonDialog open={deciding !== null} onOpenChange={(o) => !o && setDialog(null)}
        title={deciding?.label ?? ''} description={deciding ? outcomeText(deciding) : ''}
        confirmLabel={deciding?.id === 'dismiss' ? 'Dispensar' : 'Confirmar'} destructive={deciding?.destructive}
        onSubmit={(reason) => (deciding ? decide(deciding, reason) : Promise.resolve())} />
    </div>
  );
}
