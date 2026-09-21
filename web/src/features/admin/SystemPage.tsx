import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/shared/ui/primitives/button';
import { formatFileSize } from '@/shared/lib/formatBytes';
import { fetchSystem, sweepOrphans } from './adminApi';
import type { SweepResult, SystemInfo } from './adminApi';
import { ReasonDialog } from './ReasonDialog';
import { describeAdminError } from './adminErrors';
import { formatWhen } from './adminFormat';
import { Field, Section } from './adminUi';

function Meter({ used, max, label }: { used: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/10" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={used}>
        <div className={pct >= 90 ? 'h-full rounded-full bg-red' : 'h-full rounded-full bg-primary'} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function SweepSummary({ result }: { result: SweepResult }) {
  return (
    <p className="rounded-lg bg-white/[0.04] p-3 text-label text-text-secondary">
      {result.dryRun ? 'Prévia (nada foi apagado): ' : 'Coleta real: '}
      {result.orphanCount} arquivo(s) órfão(s) ({formatFileSize(result.orphanBytes)}) de {result.scanned} no disco
      {result.dryRun ? '' : `; ${result.deleted} apagado(s), ${result.failed} falha(s)`}.
      {result.recent > 0 ? ` ${result.recent} recente(s) poupado(s) pela carência.` : ''}
      {result.missingFiles > 0 ? ` ${result.missingFiles} registro(s) sem arquivo no disco.` : ''}
      <span className="block text-caption text-text-muted">em {formatWhen(result.at)}</span>
    </p>
  );
}

/** Operational view of the instance — the numbers an administrator acts on.
 * The instance-wide storage figure only exists here (an ordinary account sees
 * its own quota). */
export function SystemPage() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [preview, setPreview] = useState<SweepResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [done, setDone] = useState<SweepResult | null>(null);

  const load = useCallback(() => {
    fetchSystem().then((d) => { setInfo(d); setStatus('ready'); }).catch(() => setStatus('error'));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function runPreview() {
    setPreviewing(true);
    setPreviewError(null);
    try {
      setPreview((await sweepOrphans({ dryRun: true })).result);
      setDone(null);
    } catch (err) {
      setPreviewError(describeAdminError(err));
    } finally {
      setPreviewing(false);
    }
  }

  if (status === 'loading') return <p className="py-8 text-center text-label text-text-muted">Carregando…</p>;
  if (status === 'error' || !info) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <p className="text-body text-text-muted">Não foi possível carregar o sistema.</p>
        <Button type="button" variant="secondary" size="sm" onClick={load}>Tentar de novo</Button>
      </div>
    );
  }

  const { storage, connections, accounts, outbox } = info;
  const lastSweep = done ?? preview ?? info.orphanSweep.last;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end"><Button type="button" variant="ghost" size="sm" onClick={load}>Atualizar</Button></div>

      <Section title="Armazenamento da instância">
        <Meter used={storage.usedBytes} max={storage.maxBytes} label="Armazenamento da instância" />
        <p className="text-label text-text-secondary">{formatFileSize(storage.usedBytes)} de {formatFileSize(storage.maxBytes)} em {storage.files} arquivo(s) de anexos.</p>
      </Section>

      <Section title="Conexões e cadastros">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Conexões ao vivo">{connections.live} de {connections.max} (até {connections.perAccountMax} por conta)</Field>
          <Field label="Contas online">{connections.onlineAccounts}</Field>
          <Field label="Contas novas na última hora">{accounts.newLastHour} de {accounts.newPerHourCap} (limite do disjuntor)</Field>
          <Field label="Contas">{accounts.total} ({accounts.suspended} suspensa(s), {accounts.activeAdmins} admin(s) ativo(s))</Field>
        </dl>
        {accounts.newLastHour >= accounts.newPerHourCap && <p role="alert" className="text-label text-red-text">Cadastros pausados: o limite por hora foi atingido.</p>}
      </Section>

      <Section title="Serviços">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Chamadas (LiveKit)">{info.livekit.configured ? 'configurado' : 'NÃO configurado'}</Field>
          <Field label="Fila de eventos (outbox)">{outbox.pending} pendente(s), {outbox.failed} falha(s)</Field>
          <Field label="Notificações não lidas">{info.notifications.unread}</Field>
        </dl>
        {outbox.failed > 0 && <p role="alert" className="text-label text-red-text">Há eventos que esgotaram as tentativas de entrega.</p>}
      </Section>

      <Section title="Arquivos órfãos">
        <p className="text-label text-text-muted">
          Arquivos no disco sem registro no banco (uma exclusão que falhou no meio, por exemplo). A varredura diária só relata
          {info.orphanSweep.dryRunByDefault ? '' : ' e também apaga'}; só arquivos com mais de 24 h são considerados.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" disabled={previewing} onClick={() => void runPreview()}>{previewing ? 'Verificando…' : 'Ver órfãos (prévia)'}</Button>
          <Button type="button" size="sm" variant="destructive" disabled={!preview || preview.orphanCount === 0} onClick={() => setConfirmOpen(true)}>Apagar órfãos</Button>
        </div>
        {previewError && <p role="alert" className="text-label text-red-text">{previewError}</p>}
        {lastSweep && <SweepSummary result={lastSweep} />}
      </Section>

      <ReasonDialog open={confirmOpen} onOpenChange={setConfirmOpen} title="Apagar arquivos órfãos"
        description={`${preview?.orphanCount ?? 0} arquivo(s) (${formatFileSize(preview?.orphanBytes ?? 0)}) sem registro serão apagados do disco. Não há como desfazer.`}
        confirmLabel="Apagar" destructive
        onSubmit={async (reason) => { setDone((await sweepOrphans({ dryRun: false, reason })).result); setPreview(null); load(); }} />
    </div>
  );
}
