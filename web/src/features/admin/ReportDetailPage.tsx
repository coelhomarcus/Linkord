import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button } from '@/shared/ui/primitives/button';
import { claimReport, fetchAdminReport, resolveReport } from './adminApi';
import type { AdminReportDetail, ReportAction } from './adminApi';
import { ReasonDialog } from './ReasonDialog';
import { formatWhen } from './adminFormat';
import { AuditList, Badge, Field, Section } from './adminUi';
import { categoryLabel } from '@/features/reports/reportCategories';

type Dialog = { kind: 'claim' } | { kind: 'dismiss' } | { kind: 'resolve'; action: ReportAction | null } | null;

const ACTION_TEXT: Record<ReportAction, { label: string; description: string; destructive: boolean }> = {
  suspend_user: { label: 'Suspender a conta', description: 'A conta perde a sessão agora e não consegue entrar até ser reativada.', destructive: true },
  suspend_group: { label: 'Suspender o grupo', description: 'Os membros deixam de ler, escrever e entrar em chamada até a reativação.', destructive: true },
  delete_message: { label: 'Apagar a mensagem', description: 'A mensagem é removida para todos; o snapshot da denúncia permanece.', destructive: true },
};

function actionsFor(targetType: string): ReportAction[] {
  return targetType === 'user' ? ['suspend_user'] : targetType === 'group' ? ['suspend_group'] : ['delete_message', 'suspend_user'];
}

/** Opening this page is what fetches — and audits — the evidence. The reporter
 * is shown to administrators only; nothing on the reported account's side can
 * reach this. */
export function ReportDetailPage() {
  const { id = '' } = useParams();
  const [detail, setDetail] = useState<AdminReportDetail | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'missing' | 'ready'>('loading');
  const [dialog, setDialog] = useState<Dialog>(null);

  const load = useCallback(() => {
    fetchAdminReport(id)
      .then((d) => { setDetail(d); setStatus('ready'); })
      .catch((err: { status?: number }) => setStatus(err?.status === 404 ? 'missing' : 'error'));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (status === 'loading') return <p className="py-8 text-center text-label text-text-muted">Carregando…</p>;
  if (status === 'missing') return <p className="py-8 text-center text-label text-text-muted">Denúncia não encontrada. <Link to="/admin/reports" className="underline">Voltar</Link></p>;
  if (status === 'error' || !detail) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <p className="text-body text-text-muted">Não foi possível carregar a denúncia.</p>
        <Button type="button" variant="secondary" size="sm" onClick={load}>Tentar de novo</Button>
      </div>
    );
  }

  const { report, history } = detail;
  const closed = report.status === 'resolved' || report.status === 'dismissed';
  const snapshotText = typeof report.snapshot.text === 'string' ? report.snapshot.text : null;
  const done = async () => { load(); };

  return (
    <div className="flex flex-col gap-4">
      <Link to="/admin/reports" className="w-fit text-caption text-text-muted underline">← Denúncias</Link>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-title font-semibold text-text-primary">{report.targetLabel || report.targetId}</h2>
          <p className="text-label text-text-muted">{categoryLabel(report.category)}</p>
        </div>
        <Badge value={report.status} />
      </div>

      {!closed && (
        <div className="flex flex-wrap gap-2">
          {report.status === 'open' && <Button type="button" size="sm" variant="secondary" onClick={() => setDialog({ kind: 'claim' })}>Assumir análise</Button>}
          {actionsFor(report.targetType).map((action) => (
            <Button key={action} type="button" size="sm" variant="destructive" onClick={() => setDialog({ kind: 'resolve', action })}>{ACTION_TEXT[action].label}</Button>
          ))}
          <Button type="button" size="sm" variant="secondary" onClick={() => setDialog({ kind: 'resolve', action: null })}>Resolver sem ação</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setDialog({ kind: 'dismiss' })}>Dispensar</Button>
        </div>
      )}

      <Section title="Denúncia">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Denunciante (visível só à administração)">{report.reporter ? `@${report.reporter}` : 'conta apagada'}</Field>
          <Field label="Enviada em">{formatWhen(report.createdAt)}</Field>
          <Field label="Responsável">{report.assignee ? `@${report.assignee}` : '—'}</Field>
          {closed && <Field label="Desfecho">{report.resolution || 'sem ação'} — “{report.resolutionNote}”</Field>}
        </dl>
        {report.details && <p className="whitespace-pre-wrap rounded-lg bg-white/[0.04] p-3 text-label text-text-secondary">{report.details}</p>}
      </Section>

      {report.targetType === 'message' && (
        <Section title="Evidência (texto no momento da denúncia)">
          <p className="whitespace-pre-wrap rounded-lg bg-black/30 p-3 text-label text-text-primary">{snapshotText ?? '—'}</p>
          <p className="text-caption text-text-muted">
            autor: {String(report.snapshot.authorUsername ?? 'conta apagada')} · conversa: {String(report.snapshot.conversationTitle ?? '—')} · enviada em {formatWhen(String(report.snapshot.sentAt ?? ''))}
            {report.snapshot.truncated === true ? ' · texto truncado' : ''}
          </p>
        </Section>
      )}

      <Section title="Histórico"><AuditList items={history} /></Section>

      <ReasonDialog open={dialog?.kind === 'claim'} onOpenChange={(o) => !o && setDialog(null)} title="Assumir análise"
        description="A denúncia passa para “Em análise” com você como responsável." confirmLabel="Assumir"
        onSubmit={async (reason) => { await claimReport(report.id, reason); await done(); }} />
      <ReasonDialog open={dialog?.kind === 'dismiss'} onOpenChange={(o) => !o && setDialog(null)} title="Dispensar denúncia"
        description="Encerra sem nenhuma ação sobre o alvo." confirmLabel="Dispensar"
        onSubmit={async (reason) => { await resolveReport(report.id, { reason, action: null, dismiss: true }); await done(); }} />
      <ReasonDialog open={dialog?.kind === 'resolve'} onOpenChange={(o) => !o && setDialog(null)}
        title={dialog?.kind === 'resolve' && dialog.action ? ACTION_TEXT[dialog.action].label : 'Resolver sem ação'}
        description={dialog?.kind === 'resolve' && dialog.action ? `${ACTION_TEXT[dialog.action].description} A denúncia é encerrada.` : 'Encerra a denúncia como resolvida, sem ação sobre o alvo.'}
        confirmLabel="Confirmar" destructive={dialog?.kind === 'resolve' && !!dialog.action}
        onSubmit={async (reason) => { await resolveReport(report.id, { reason, action: dialog?.kind === 'resolve' ? dialog.action : null, dismiss: false }); await done(); }} />
    </div>
  );
}
