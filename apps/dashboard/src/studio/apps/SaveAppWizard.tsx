// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SAVE AS APP: the wizard, ported from `Save As App.dc.html` (boards 3a–3e).
 *
 * Five steps in the install wizard's shell (`InstallAppWizard`: a `Stepper`
 * header, one step body, a sticky footer that says "Step n of 5 · <key>"):
 *
 *  1. Database — every database once, with its workspace chips; while the
 *     server shows workspaces one at a time, the current one's come first.
 *  2. What to include — `SaveAppInclude`.
 *  3. About the app — name, key, the version (the next by default), the
 *     description and where it was made.
 *  4. Check — `SaveAppCheck`; Save is here.
 *  5. Download — the file and its fingerprint, with Copy.
 *
 * Departures, each forced:
 *  - The key and version refusals are said beside their fields, from the saves
 *    this page lists, before the server would refuse them.
 */
import { Check, Copy, Database, Download, Package } from 'lucide-react';
import { getFormatters } from '@adminium/i18n';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  FormField,
  IconTile,
  Input,
  MonoText,
  RadioCard,
  RadioGroup,
  Spinner,
  Stepper,
  Textarea,
  cn,
  type Step,
} from '@adminium/ui';

import { getI18nInstance, t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import type { SaveFlowShared } from './saveAppShared.js';
import { SaveAppCheck, checkFooterNote } from './SaveAppCheck.js';
import { SaveAppInclude } from './SaveAppInclude.js';
import { downloadSavedFile } from './saveAppApi.js';
import { AppIconPicker } from './saveAppIcons.js';
import { aboutProblems, nextVersionFor, savesOf } from './saveAppAbout.js';
import { monoSentence } from './saveAppWords.js';

export type WizardStep = 0 | 1 | 2 | 3 | 4;

export interface SaveAppWizardProps extends SaveFlowShared {
  step: WizardStep;
  onStep: (step: WizardStep) => void;
  onConnection: (connectionId: string) => void;
}

function formatters() {
  return getFormatters(getI18nInstance()?.language ?? 'en-US');
}

export function SaveAppWizard(props: SaveAppWizardProps) {
  const { step, onStep, draft, connectionId, saved, saving, onClose } = props;
  const toasts = useAppToasts();
  const steps: Step[] = [
    { id: 'database', label: t('studio:saveApp.step.database', 'Database') },
    { id: 'include', label: t('studio:saveApp.step.include', 'What to include') },
    { id: 'about', label: t('studio:saveApp.step.about', 'About the app') },
    { id: 'check', label: t('studio:saveApp.step.check', 'Check') },
    { id: 'download', label: t('studio:saveApp.step.download', 'Download') },
  ].map((one, index) => ({ ...one, state: index < step || (index === 4 && saved !== null) ? 'done' : index === step ? 'active' : 'pending' }));
  const problems = draft === null ? null : aboutProblems(draft, props.saves, connectionId, props.catalogKeys);
  const canContinue = step === 0 ? connectionId !== null && props.inventory !== undefined : step === 1 ? draft !== null : step === 2 ? problems === null : false;
  const note = step === 3 ? checkFooterNote(props) : null;

  return (
    <section className="flex min-h-full flex-col gap-6 leading-[normal]">
      <header>
        <Stepper
          steps={steps}
          activeIndex={step}
          label={t('studio:saveApp.progress', 'Save as app progress')}
          onStepClick={(index) => {
            // Back only, and never out of a finished save.
            if (saved === null && index < step) onStep(index as WizardStep);
          }}
        />
      </header>

      {step === 0 ? <SaveDatabaseChoice databases={props.databases} connectionId={connectionId} onConnection={props.onConnection} /> : null}
      {step === 1 && draft !== null && props.inventory !== undefined ? (
        <SaveAppInclude inventory={props.inventory} draft={draft} setDraft={props.setDraft} />
      ) : null}
      {step === 2 && draft !== null ? <AboutStep {...props} problems={problems} /> : null}
      {step === 3 ? <SaveAppCheck {...props} onBackToInclude={() => onStep(1)} /> : null}
      {step === 4 && saved !== null ? <DownloadStep {...props} /> : null}
      {step > 0 && step < 4 && draft === null ? (
        <p className="inline-flex items-center gap-2 text-[13px] text-fg-muted">
          <Spinner size="sm" />
          {t('studio:saveApp.loading', 'Reading the database…')}
        </p>
      ) : null}

      <footer className="sticky bottom-0 -mx-6 mt-auto flex flex-col gap-3 border-t border-border bg-surface px-6 py-3.5 sm:flex-row sm:items-center">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-fg-subtle">
          {note !== null ? (
            <span data-part="save-note" id="save-app-note" className="font-semibold text-danger">
              {note}
            </span>
          ) : (
            <span>
              {draft === null || draft.key === ''
                ? t('studio:saveApp.footerStep', 'Step {n} of {total}', { n: step + 1, total: 5 })
                : monoSentence((m) => t('studio:saveApp.footerStepKey', 'Step {n} of {total} · {key}', { n: step + 1, total: 5, key: m['key']! }), { key: draft.key })}
            </span>
          )}
          {step === 1 ? <span>{t('studio:saveApp.include.nothingChanges', 'Saving changes nothing on this server.')}</span> : null}
        </span>
        <span className="flex flex-col-reverse gap-2 sm:ms-auto sm:flex-row sm:items-center">
          {step === 4 ? (
            <>
              <Button variant="secondary" onClick={onClose}>
                {t('studio:saveApp.done', 'Done')}
              </Button>
              <Button
                onClick={() => {
                  if (saved === null) return;
                  void downloadSavedFile(saved.id).then(
                    (name) => toasts.push({ variant: 'success', title: t('studio:saveApp.download.done', '{file} downloaded', { file: name }) }),
                    (error: unknown) => toasts.push({ variant: 'error', title: t('studio:saveApp.download.failed', 'The file could not be downloaded'), description: error instanceof Error ? error.message : String(error) }),
                  );
                }}
              >
                <Download aria-hidden className="size-4" />
                {t('studio:saveApp.download.button', 'Download')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" disabled={saving} onClick={onClose}>
                {t('studio:saveApp.cancel', 'Cancel')}
              </Button>
              {step > 0 ? (
                <Button variant="secondary" disabled={saving} onClick={() => onStep((step - 1) as WizardStep)}>
                  {t('studio:saveApp.back', 'Back')}
                </Button>
              ) : null}
              {step === 3 ? (
                <Button
                  loading={saving}
                  disabled={props.plan === undefined || !props.plan.ready || props.planPending}
                  {...(note === null ? {} : { 'aria-describedby': 'save-app-note' })}
                  onClick={props.save}
                >
                  {t('studio:saveApp.save', 'Save')}
                </Button>
              ) : (
                <Button disabled={!canContinue} onClick={() => onStep((step + 1) as WizardStep)}>
                  {t('studio:saveApp.continue', 'Continue')}
                </Button>
              )}
            </>
          )}
        </span>
      </footer>
    </section>
  );
}

/* ---------------------------------------------------------- 1. Database */

/** The Database step: every database once, with its workspace chips. */
export function SaveDatabaseChoice({ databases, connectionId, onConnection }: Pick<SaveAppWizardProps, 'databases' | 'connectionId' | 'onConnection'>) {
  const numbers = formatters();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-[16.5px] font-extrabold tracking-[-0.02em]">{t('studio:saveApp.database.title', 'Database')}</h2>
        <p className="mt-1 text-[13px] leading-[1.5] text-fg-muted">{t('studio:saveApp.database.body', 'One app describes one database.')}</p>
      </div>
      {databases.length === 0 ? (
        <Alert tone="info" title={t('studio:saveApp.database.none', 'This server has no database connected yet.')} />
      ) : (
        <RadioGroup
          value={connectionId ?? ''}
          onValueChange={onConnection}
          aria-label={t('studio:saveApp.database.title', 'Database')}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          {databases.map(({ connection, workspaces, other }) => (
            <RadioCard
              key={connection.id}
              value={connection.id}
              icon={<Database aria-hidden className="size-4" />}
              title={<MonoText className="text-[13px] font-semibold">{connection.name}</MonoText>}
              description={
                <span className="flex flex-col gap-2">
                  <span>
                    {engineName(connection.engine)} ·{' '}
                    {t('studio:saveApp.database.tables', 'Tables: {count}', { count: numbers.number(connection.tableCount ?? 0) })}
                  </span>
                  {workspaces.length > 0 || other ? (
                    <span className="flex flex-wrap gap-1.5" data-part="workspace-chips">
                      {workspaces.map((name) => (
                        <Badge key={name}>{name}</Badge>
                      ))}
                      {other ? <Badge>{t('studio:saveApp.database.other', 'Other databases')}</Badge> : null}
                    </span>
                  ) : null}
                </span>
              }
            />
          ))}
        </RadioGroup>
      )}
    </div>
  );
}

export function engineName(engine: string): string {
  switch (engine) {
    case 'postgres':
      return 'Postgres';
    case 'mysql':
      return 'MySQL';
    case 'sqlite':
      return 'SQLite';
    default:
      return engine;
  }
}

/* ---------------------------------------------------------- 3. About */

function AboutStep({ draft, setDraft, saves, problems }: SaveAppWizardProps & { problems: ReturnType<typeof aboutProblems> }) {
  if (draft === null) return null;
  const last = savesOf(draft.key, saves)[0];
  const next = nextVersionFor(draft.key, saves);
  const version = draft.version ?? next;
  const date = formatters();
  return (
    <div className="flex max-w-[640px] flex-col gap-4">
      <div>
        <h2 className="text-[16.5px] font-extrabold tracking-[-0.02em]">{t('studio:saveApp.about.title', 'About the app')}</h2>
        <p className="mt-1 text-[13px] leading-[1.5] text-fg-muted">{t('studio:saveApp.about.body', 'How the app is named and shown where it is installed.')}</p>
      </div>
      <FormField label={t('studio:saveApp.about.name', 'Name')} controlId="save-app-name" error={problems?.name}>
        <Input value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
      </FormField>
      <FormField
        label={t('studio:saveApp.about.key', 'Key')}
        controlId="save-app-key"
        error={problems?.key}
        helper={
          problems?.key === undefined && draft.key !== '' ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-pos" data-part="key-free">
              <Check aria-hidden className="size-3.5" />
              {monoSentence((m) => t('studio:saveApp.about.keyFree', 'No other app uses {key}', { key: m['key']! }), { key: draft.key })}
            </span>
          ) : undefined
        }
      >
        <Input className="font-mono" value={draft.key} maxLength={80} onChange={(event) => setDraft({ ...draft, key: event.target.value.trim() })} />
      </FormField>
      <FormField
        label={t('studio:saveApp.about.version', 'Version')}
        controlId="save-app-version"
        error={problems?.version}
        helper={
          last === undefined
            ? undefined
            : monoSentence(
                (m) => t('studio:saveApp.about.lastSaved', 'Last saved: {last} on {date}. This one: {next}.', { last: m['last']!, date: date.date(last.savedAt, 'medium'), next: m['next']! }),
                { last: last.version, next: version },
              )
        }
      >
        <Input className="w-40 font-mono" value={version} onChange={(event) => setDraft({ ...draft, version: event.target.value.trim() === next ? null : event.target.value.trim() })} />
      </FormField>
      <FormField label={t('studio:saveApp.about.description', 'Description')} controlId="save-app-description">
        <Textarea value={draft.description} maxLength={500} rows={3} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
      </FormField>
      <div className="flex flex-col gap-2">
        <span id="save-app-icon-label" className="text-[13px] font-semibold text-fg">
          {t('studio:saveApp.about.icon', 'Icon')}
        </span>
        <AppIconPicker labelledBy="save-app-icon-label" value={draft.icon} onChange={(icon) => setDraft({ ...draft, icon })} />
      </div>
      <FormField
        label={t('studio:saveApp.about.label', 'Made at')}
        controlId="save-app-label"
        error={problems?.label}
        helper={t('studio:saveApp.about.labelHint', 'Shown where the app is installed. Use a name, not an address.')}
      >
        <Input value={draft.label} maxLength={120} placeholder={t('studio:saveApp.about.labelPlaceholder', 'This server’s name')} onChange={(event) => setDraft({ ...draft, label: event.target.value })} />
      </FormField>
    </div>
  );
}

/* ---------------------------------------------------------- 5. Download */

function DownloadStep({ saved }: SaveAppWizardProps) {
  const toasts = useAppToasts();
  if (saved === null) return null;
  const half = Math.ceil(saved.integrity.length / 2);
  return (
    <div className="flex max-w-[640px] flex-col gap-4">
      <div>
        <h2 className="text-[16.5px] font-extrabold tracking-[-0.02em]">{t('studio:saveApp.step.download', 'Download')}</h2>
        <p className="mt-1 text-[13px] leading-[1.5] text-fg-muted">
          {monoSentence(
            (m) => t('studio:saveApp.download.body', '{app} {version} is saved as a file. Download it to install it on another server.', { app: m['app']!, version: m['version']! }),
            { app: saved.key, version: saved.version },
          )}
        </p>
      </div>
      <Card>
        <CardBody className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <IconTile tone="accent">
              <Package aria-hidden className="size-5" />
            </IconTile>
            <MonoText className="flex-1 text-[13px] font-semibold">{saved.filename}</MonoText>
            <MonoText className="text-xs text-fg-muted">{formatters().bytes(saved.bytes)}</MonoText>
          </div>
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <span className="text-[10.5px] font-bold uppercase tracking-[0.05em] text-fg-subtle">{t('studio:saveApp.download.fingerprint', 'Fingerprint')}</span>
            <div className="flex items-start gap-3">
              <MonoText className={cn('flex-1 break-all text-xs leading-[1.6]')} data-part="fingerprint">
                <span className="block">{saved.integrity.slice(0, half)}</span>
                <span className="block">{saved.integrity.slice(half)}</span>
              </MonoText>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(saved.integrity).then(
                    () => toasts.push({ variant: 'success', title: t('studio:saveApp.download.copied', 'Fingerprint copied') }),
                    () => toasts.push({ variant: 'error', title: t('studio:saveApp.download.copyFailed', 'The fingerprint could not be copied') }),
                  );
                }}
              >
                <Copy aria-hidden className="size-3.5" />
                {t('studio:saveApp.download.copy', 'Copy')}
              </Button>
            </div>
            <p className="text-xs text-fg-subtle">
              {t('studio:saveApp.download.keep', 'Keep the fingerprint with the file. The new server asks for it to check the file is the one you saved.')}
            </p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
