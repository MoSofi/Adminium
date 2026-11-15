// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Payments → Card readers: the readers paired for the tills. Someone who
 * manages payments pairs one (a name, then the code the reader shows typed in
 * — or, for a service that pairs the other way, the code shown here typed on
 * the reader), renames it and unpairs it. Each till picks its reader in its
 * own settings. A reader's last word (online, last seen) is the service's.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { CreditCard } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, IconTile, Input, Modal, ModalBody, ModalFooter, ModalHeader } from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { READERS_QUERY_KEY, finishPairing, readersQuery, startPairing, unpairReader, type PairingView, type ReaderView } from './paymentsApi.js';

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : t('studio:payments.error.unknown', 'That did not work. Try again.');
}

function PairDialog({ services, onClose }: { services: { key: string; name: string }[]; onClose: () => void }): ReactNode {
  const client = useQueryClient();
  const ids = useId();
  const [service, setService] = useState(services[0]?.key ?? '');
  const [mode, setMode] = useState<'test' | 'live'>('test');
  const [label, setLabel] = useState('');
  const [code, setCode] = useState('');
  const [pairing, setPairing] = useState<PairingView | null>(null);
  const start = useMutation({ mutationFn: () => startPairing({ provider: service, mode, label: label.trim() }), onSuccess: setPairing });
  const finish = useMutation({
    mutationFn: () => finishPairing({ provider: service, mode, label: label.trim(), pairing: pairing!.pairing, code: pairing!.way === 'enter' ? code.trim() : null }),
    onSuccess: async (data) => {
      if (data.state !== 'paired') return;
      await client.invalidateQueries({ queryKey: READERS_QUERY_KEY });
      onClose();
    },
  });
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (pairing === null) start.mutate();
    else finish.mutate();
  };
  const problem = start.error ?? finish.error;
  return (
    <Modal open onOpenChange={(open) => (open ? null : onClose())}>
      <form onSubmit={submit}>
        <ModalHeader title={t('studio:payments.readers.pairTitle', 'Pair a card reader')} closeLabel={t('studio:payments.close', 'Close')} />
        <ModalBody className="flex flex-col gap-3">
          {pairing === null ? (
            <>
              <label className="flex flex-col gap-1 text-[12.5px] font-semibold" htmlFor={`${ids}-service`}>
                {t('studio:payments.readers.service', 'Service')}
                <select id={`${ids}-service`} className="h-9 rounded-[8px] border border-border bg-surface px-2" value={service} onChange={(event) => setService(event.target.value)} data-testid="readers-pair-service">
                  {services.map((one) => (
                    <option key={one.key} value={one.key}>
                      {one.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[12.5px] font-semibold" htmlFor={`${ids}-mode`}>
                {t('studio:payments.readers.mode', 'Mode')}
                <select id={`${ids}-mode`} className="h-9 rounded-[8px] border border-border bg-surface px-2" value={mode} onChange={(event) => setMode(event.target.value as 'test' | 'live')}>
                  <option value="test">{t('studio:payments.readers.test', 'Test')}</option>
                  <option value="live">{t('studio:payments.readers.live', 'Live')}</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[12.5px] font-semibold" htmlFor={`${ids}-label`}>
                {t('studio:payments.readers.name', 'Name')}
                <Input id={`${ids}-label`} value={label} onChange={(event) => setLabel(event.target.value)} placeholder={t('studio:payments.readers.namePh', 'Front counter')} data-testid="readers-pair-label" />
              </label>
            </>
          ) : pairing.way === 'enter' ? (
            <label className="flex flex-col gap-1 text-[12.5px] font-semibold" htmlFor={`${ids}-code`}>
              {t('studio:payments.readers.enterCode', 'Type the code the reader shows')}
              <Input id={`${ids}-code`} value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="off" data-testid="readers-pair-code" />
            </label>
          ) : (
            <p className="text-[13px]" data-testid="readers-pair-show">
              {t('studio:payments.readers.showCode', 'Type this code on the reader, then press Done: {code}', { code: pairing.code ?? '' })}
            </p>
          )}
          {problem === null ? null : <Alert tone="danger" role="alert" title={errorText(problem)} />}
          {finish.data?.state === 'waiting' ? <p role="status" className="text-[12.5px] text-fg-muted">{t('studio:payments.readers.waiting', 'The reader has not taken the code yet.')}</p> : null}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('studio:payments.apps.cancel', 'Cancel')}
          </Button>
          <Button type="submit" disabled={label.trim() === '' || service === '' || start.isPending || finish.isPending || (pairing?.way === 'enter' && code.trim() === '')} data-testid="readers-pair-next">
            {pairing === null ? t('studio:payments.readers.next', 'Next') : t('studio:payments.readers.done', 'Done')}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

function ReaderRow({ reader, canManage }: { reader: ReaderView; canManage: boolean }): ReactNode {
  const client = useQueryClient();
  const unpair = useMutation({ mutationFn: () => unpairReader(reader.id), onSuccess: () => client.invalidateQueries({ queryKey: READERS_QUERY_KEY }) });
  const seen = reader.lastSeenAt === null ? null : new Date(reader.lastSeenAt).toLocaleString();
  return (
    <div className="flex flex-wrap items-center gap-4 border-t border-border px-[var(--card-pad,20px)] py-3 first:border-t-0" data-testid={`reader-${reader.id}`}>
      <IconTile icon={<CreditCard />} />
      <div className="flex min-w-[200px] flex-1 flex-col">
        <span className="text-[14px] font-bold">{reader.label}</span>
        <span className="text-[12.5px] text-fg-muted">
          {[reader.model, reader.locationName, seen === null ? null : t('studio:payments.readers.lastSeen', 'Last seen {when}', { when: seen })].filter((part) => part !== null).join(' · ')}
        </span>
      </div>
      <Badge tone={reader.online ? 'pos' : 'neutral'}>{reader.online ? t('studio:payments.readers.online', 'Online') : t('studio:payments.readers.offline', 'Offline')}</Badge>
      {reader.mode === 'test' ? <Badge tone="warn">{t('studio:payments.readers.test', 'Test')}</Badge> : null}
      {canManage ? (
        <Button size="sm" variant="ghost" disabled={unpair.isPending} onClick={() => unpair.mutate()} data-testid={`reader-unpair-${reader.id}`}>
          {t('studio:payments.readers.unpair', 'Unpair')}
        </Button>
      ) : null}
    </div>
  );
}

export function ReadersTab({ canManage }: { canManage: boolean }): ReactNode {
  const list = useQuery({ ...readersQuery(), enabled: canManage });
  const [pairing, setPairing] = useState(false);
  if (!canManage) return <Alert tone="info" title={t('studio:payments.readers.viewOnly', 'Pairing card readers needs the “Set up payments” permission.')} />;
  if (list.isPending) return <p className="text-[13px] text-fg-muted">{t('studio:payments.loading', 'Loading…')}</p>;
  if (list.isError) return <Alert tone="danger" role="alert" title={errorText(list.error)} />;
  const titleId = 'payments-readers-title';
  return (
    <div className="flex flex-col gap-4" data-testid="payments-readers">
      <Card aria-labelledby={titleId}>
        <CardHeader className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="text-[14.5px] font-bold">
              {t('studio:payments.readers.title', 'Card readers')}
            </h2>
            <p className="mt-0.5 text-[12.5px] leading-normal text-fg-muted">{t('studio:payments.readers.sub', 'Readers at your counter. Each till picks its reader in its own settings.')}</p>
          </div>
          <Button size="sm" disabled={list.data.services.length === 0} onClick={() => setPairing(true)} data-testid="readers-pair">
            {t('studio:payments.readers.pair', 'Pair a reader')}
          </Button>
        </CardHeader>
        {list.data.readers.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 px-6 py-11 text-center" data-testid="payments-readers-empty">
            <IconTile icon={<CreditCard />} />
            <p className="text-[14px] font-bold">{t('studio:payments.readers.empty', 'No card reader is paired yet.')}</p>
          </div>
        ) : (
          list.data.readers.map((reader) => <ReaderRow key={reader.id} reader={reader} canManage={canManage} />)
        )}
      </Card>
      {pairing ? <PairDialog services={list.data.services} onClose={() => setPairing(false)} /> : null}
    </div>
  );
}
