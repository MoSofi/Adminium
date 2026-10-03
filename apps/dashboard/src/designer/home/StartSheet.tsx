// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The sheet a card of "Start with an app" opens (Designer Pieces, piece 1).
 *
 * Two ways to start with a published app:
 *
 *   Install as it is   first, and selected. The app is installed unchanged
 *                      and keeps its updates. It is Studio's own install,
 *                      with its plan to read: the sheet takes the person
 *                      there, on that app.
 *   Make it yours      the app's source is copied into the project under a
 *                      key and a name the person gives, and the Designer can
 *                      change anything in it. It gets no more updates.
 *
 * A copy builds its screens with the app's own build. That is a command, so
 * the sheet shows its exact words and nothing is fetched until the person
 * has ticked that it may run. The licence line says what AGPL-3.0 asks of
 * someone who serves people with a copy, in plain words.
 *
 * While it copies, the form gives way to three rows; a failure names its
 * step, keeps the form's answers, and offers "Try again".
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Check, CircleAlert, GitFork, LoaderCircle, PackageCheck, RotateCw, Scale, Sparkles } from 'lucide-react';
import { Input, RadioCard, RadioGroup, Sheet, SheetBody, SheetFooter, SheetHeader } from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { designerApi, type CatalogApp, type StartJob } from '../api.js';

type Mode = 'as-is' | 'yours';

/** `Online Ordering` → `online-ordering`: a first guess at a key, for the person to change. */
export function keyFromAppName(name: string): string {
  const base = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 36);
  return base.length >= 2 ? `my-${base}`.slice(0, 40) : 'my-app';
}

function stepName(id: StartJob['steps'][number]['id'], mode: 'copy'): string {
  void mode;
  switch (id) {
    case 'get':
      return t('designer:sheet.stepGet', 'Getting the app');
    case 'make':
      return t('designer:sheet.stepMake', 'Making it yours');
    case 'build':
      return t('designer:sheet.stepBuild', 'Building and applying');
  }
}

export function StartSheet({
  app,
  model,
  onClose,
}: {
  app: CatalogApp | null;
  /** The model a session on the copy starts with; null when none is chosen yet. */
  model: { connectionId: string; model: string } | null;
  onClose: () => void;
}): ReactNode {
  const navigate = useNavigate();
  const ids = { name: useId(), key: useId(), keyHint: useId(), keyError: useId(), approve: useId() };
  const [mode, setMode] = useState<Mode>('as-is');
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [approved, setApproved] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  // A new app in the sheet: its own name and a first key, nothing ticked, nothing running.
  useEffect(() => {
    if (app === null) return;
    setMode('as-is');
    setName(app.name);
    setKey(keyFromAppName(app.name));
    setApproved(false);
    setJobId(null);
    setRefused(null);
  }, [app]);

  const yours = mode === 'yours';
  const check = useQuery({
    queryKey: ['designer', 'start-check', key] as const,
    queryFn: () => designerApi.startCheck(key),
    enabled: app !== null && yours && key !== '' && jobId === null,
    staleTime: 0,
    retry: false,
  });
  // A key changed is a build changed: the tick is for the words that were shown.
  useEffect(() => setApproved(false), [key]);

  const job = useQuery({
    queryKey: ['designer', 'start-job', jobId] as const,
    queryFn: () => designerApi.startStatus(jobId as string),
    enabled: jobId !== null,
    refetchInterval: (query) => (query.state.status !== 'error' && (query.state.data?.state === 'running' || query.state.data === undefined) ? 1000 : false),
    retry: false,
  });
  const running = jobId !== null && (job.data === undefined || job.data.state === 'running');
  const failed = job.data?.state === 'failed';
  const done = job.data?.state === 'done' ? job.data : null;
  // The copy can no longer be asked about (the server restarted, or the Designer was switched off): the sheet is let go, with why.
  useEffect(() => {
    if (jobId === null || !job.isError) return;
    setRefused(job.error instanceof ApiError ? job.error.message : t('designer:sheet.startFailed', 'The copy could not be started.'));
    setJobId(null);
  }, [jobId, job.isError, job.error]);
  useEffect(() => {
    if (done?.sessionId == null) return;
    void navigate({ to: '/design/$sessionId', params: { sessionId: done.sessionId } });
  }, [done, navigate]);

  if (app === null) return null;
  const keyProblem = yours && key !== '' ? (check.data?.problem ?? null) : null;
  const build = check.data?.build ?? null;
  const canStart = yours ? name.trim() !== '' && build !== null && approved && model !== null && !starting && !running : true;

  const start = async (): Promise<void> => {
    if (!yours) {
      // Studio's own install, on this app: its plan is read there.
      window.location.assign(`/studio/apps#app=${encodeURIComponent(app.key)}`);
      return;
    }
    if (build === null || model === null) return;
    setStarting(true);
    setRefused(null);
    try {
      const started = await designerApi.start({ key: app.key, newKey: key, name: name.trim(), approve: build.fingerprint, connectionId: model.connectionId, model: model.model });
      setJobId(started.id);
    } catch (error) {
      setRefused(error instanceof ApiError ? error.message : t('designer:sheet.startFailed', 'The copy could not be started.'));
    } finally {
      setStarting(false);
    }
  };

  const working = running || failed;
  return (
    <Sheet
      open
      maxWidth={520}
      onOpenChange={(open) => {
        if (!open && !running) onClose();
      }}
    >
      <SheetHeader icon={<Sparkles />} title={t('designer:sheet.title', 'Start with {name}', { name: app.name })} subtitle={app.tagline} closeLabel={t('designer:sheet.close', 'Close')} />
      <SheetBody className="flex flex-col gap-4 p-5">
        {working ? (
          <div role="status" aria-live="polite" className="overflow-hidden rounded-xl border border-border">
            {(job.data?.steps ?? []).map((step) => (
              <div key={step.id} className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0">
                <span aria-hidden="true" className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
                  {step.state === 'done' ? (
                    <Check className="size-4 text-success" />
                  ) : step.state === 'running' ? (
                    <LoaderCircle className="size-4 animate-spin text-accent motion-reduce:animate-none" />
                  ) : step.state === 'failed' ? (
                    <CircleAlert className="size-4 text-danger" />
                  ) : (
                    <span className="size-2 rounded-full bg-border-strong" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-[13.5px] font-bold ${step.state === 'waiting' ? 'text-fg-subtle' : 'text-fg'}`}>{stepName(step.id, 'copy')}</span>
                  {step.state === 'failed' && step.detail !== undefined ? (
                    <code dir="ltr" className="adm-always-dark mt-2 block whitespace-pre-wrap break-words rounded-[10px] bg-bg px-3 py-2.5 text-start font-mono text-xs leading-normal text-danger">
                      {step.detail}
                    </code>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <>
            <RadioGroup aria-label={t('designer:sheet.how', 'How to start')} value={mode} onValueChange={(next) => setMode(next as Mode)} className="flex flex-col gap-2.5">
              <RadioCard
                value="as-is"
                icon={<PackageCheck />}
                title={t('designer:sheet.asIs', 'Install as it is')}
                description={t('designer:sheet.asIsLine', 'Installs the app unchanged. It keeps receiving updates. The Designer can build around it, not inside it.')}
              />
              <RadioCard
                value="yours"
                disabled={!app.copyable}
                icon={<GitFork />}
                title={t('designer:sheet.yours', 'Make it yours')}
                description={
                  app.copyable
                    ? t('designer:sheet.yoursLine', 'Copies the app into your folder so the Designer can change anything. It will no longer receive updates from Adminium.')
                    : t('designer:sheet.yoursNoSource', 'The list does not say where this app’s source is, so it cannot be copied.')
                }
              />
            </RadioGroup>

            {yours ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={ids.name} className="text-[12.5px] font-bold text-fg">
                    {t('designer:sheet.name', 'Name')}
                  </label>
                  <Input id={ids.name} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={ids.key} className="text-[12.5px] font-bold text-fg">
                    {t('designer:sheet.key', 'Key')}
                  </label>
                  <Input
                    id={ids.key}
                    dir="ltr"
                    value={key}
                    maxLength={40}
                    spellCheck={false}
                    autoCapitalize="none"
                    aria-invalid={keyProblem !== null}
                    aria-describedby={keyProblem === null ? ids.keyHint : `${ids.keyError} ${ids.keyHint}`}
                    onChange={(event) => setKey(event.target.value.toLowerCase())}
                    className="font-mono"
                  />
                  {keyProblem !== null ? (
                    <div id={ids.keyError} className="flex items-center gap-1.5 text-xs font-semibold text-danger">
                      <CircleAlert aria-hidden="true" className="size-[13px] shrink-0" />
                      {keyProblem}
                    </div>
                  ) : null}
                  <div id={ids.keyHint} className="text-[11.5px] leading-normal text-fg-subtle">
                    {t('designer:sheet.keyHint', 'Used in addresses and table names. Cannot be changed later.')}
                  </div>
                </div>

                {build !== null ? (
                  <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-3.5">
                    <div className="text-[12.5px] font-bold text-fg">{t('designer:sheet.buildTitle', 'This app builds its screens with its own commands')}</div>
                    <p className="m-0 text-xs leading-normal text-fg-muted">
                      {t('designer:sheet.buildLine', 'They run on this machine, in the app’s folder, each time the app is built. Read them before you say yes.')}
                    </p>
                    <code dir="ltr" className="adm-always-dark block whitespace-pre-wrap break-all rounded-[10px] bg-bg px-3 py-2.5 text-start font-mono text-[11.5px] leading-normal text-fg">
                      {`${build.install}\n${build.command}`}
                    </code>
                    <label htmlFor={ids.approve} className="flex cursor-pointer items-start gap-2 text-[12.5px] font-semibold text-fg">
                      <input id={ids.approve} type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
                      {t('designer:sheet.approve', 'These commands may run')}
                    </label>
                  </div>
                ) : null}

                <div className="flex items-start gap-2 text-xs leading-normal text-fg-subtle">
                  <Scale aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                  <span>
                    {t(
                      'designer:sheet.licence',
                      'This app’s source is licensed AGPL-3.0, and your copy keeps that licence. If people use your copy over a network (your customers, on your site), the licence asks you to offer them the source of your version, changes included.',
                    )}
                  </span>
                </div>
                {model === null ? <p className="m-0 text-xs font-semibold text-danger">{t('designer:sheet.needsModel', 'Add a model first: the Designer opens on your copy.')}</p> : null}
              </>
            ) : null}
            {refused !== null ? (
              <p role="alert" className="m-0 text-xs font-semibold text-danger">
                {refused}
              </p>
            ) : null}
          </>
        )}
      </SheetBody>
      <SheetFooter className="flex items-center justify-end gap-2.5">
        <button type="button" disabled={running} onClick={onClose} className="rounded-[10px] border border-border-strong bg-surface px-3.5 py-2 text-[13px] font-bold text-fg hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50">
          {t('designer:sheet.cancel', 'Cancel')}
        </button>
        {failed ? (
          <button
            type="button"
            onClick={() => {
              setJobId(null);
              void start();
            }}
            className="inline-flex items-center gap-1.5 rounded-[10px] bg-accent px-3.5 py-2 text-[13px] font-bold text-accent-fg hover:brightness-105"
          >
            <RotateCw aria-hidden="true" className="size-[15px]" />
            {t('designer:sheet.retry', 'Try again')}
          </button>
        ) : (
          <button
            type="button"
            disabled={!canStart}
            onClick={() => void start()}
            className="inline-flex items-center gap-1.5 rounded-[10px] bg-accent px-3.5 py-2 text-[13px] font-bold text-accent-fg hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {starting || running ? <LoaderCircle aria-hidden="true" className="size-[15px] animate-spin motion-reduce:animate-none" /> : null}
            {yours ? t('designer:sheet.start', 'Start') : t('designer:sheet.openInstall', 'Open its install')}
          </button>
        )}
      </SheetFooter>
    </Sheet>
  );
}
