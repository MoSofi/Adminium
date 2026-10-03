// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Add a model": choose a provider, give its key or address, test, save.
 *
 * Saving writes the project's `.env`, on this machine; the key goes to the
 * server and never comes back. A provider already added shows an empty key
 * field ("A key is saved. Type a new one to replace it.") and a test with the
 * field empty runs against the saved key.
 *
 * The test is two calls: one lists the models (the Model field stays off
 * until it passes), then one asks the chosen model to call a tool, so the
 * result says whether it can build. A model that cannot is still savable,
 * for other uses. Changing the key or the address clears the test; changing
 * the model asks the new one.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, CircleAlert, CircleCheck, Cpu, FileText, Loader2, TriangleAlert } from 'lucide-react';
import { Button, FormField, Input, Modal, ModalBody, ModalFooter, ModalHeader, SecretInput, Select } from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import type { ConfigurableProvider } from '../../studio/ai/providerCatalog.js';
import { designerApi, type ConnectionDraft, type ConnectionTest, type DesignerModels, type ModelConnection } from '../api.js';
import { PROVIDERS, providerFields, providerLabel, providerLine } from './providers.js';

type Verdict = NonNullable<ConnectionTest['canBuild']>;

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'passed'; models: { id: string; label: string }[]; ms: number | null; verdict: Verdict | 'checking' | null }
  | { kind: 'failed'; on: 'key' | 'address' | 'form'; message: string };

export interface SavedModel {
  connection: ModelConnection;
  model: string;
}

function failure(provider: ConfigurableProvider, error: { code: string; message: string } | null): Extract<TestState, { kind: 'failed' }> {
  const fields = providerFields(provider);
  const code = error?.code ?? 'error';
  if (code === 'auth' && fields.key !== 'none') return { kind: 'failed', on: 'key', message: t('designer:model.keyRefused', 'The key was refused.') };
  if ((code === 'network' || code === 'timeout' || code === 'not_found') && fields.address !== 'none') {
    return { kind: 'failed', on: 'address', message: t('designer:model.unreachable', 'Could not reach this connection') };
  }
  return { kind: 'failed', on: 'form', message: t('designer:model.testFailed', 'The test failed: {message}', { message: error?.message ?? code }) };
}

function seconds(ms: number): string {
  return (Math.max(ms, 100) / 1000).toFixed(1);
}

export function AddModelDialog({
  open,
  onOpenChange,
  models,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  models: DesignerModels | undefined;
  onSaved: (saved: SavedModel) => void;
}): ReactNode {
  const [provider, setProvider] = useState<ConfigurableProvider | null>(null);
  const [key, setKey] = useState('');
  const [address, setAddress] = useState('');
  const [model, setModel] = useState('');
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const run = useRef(0);

  // Each opening starts at the providers.
  useEffect(() => {
    if (open) {
      setProvider(null);
      setSaveError(null);
    }
  }, [open]);

  const added = (id: ConfigurableProvider): boolean => models?.connections.some((connection) => connection.provider === id && connection.source === 'environment') ?? false;

  const choose = (id: ConfigurableProvider): void => {
    run.current += 1;
    setProvider(id);
    setKey('');
    setAddress(providerFields(id).addressDefault);
    setModel('');
    setTest({ kind: 'idle' });
    setSaveError(null);
  };

  const draft = (id: ConfigurableProvider, withModel?: string): ConnectionDraft => ({
    provider: id,
    ...(key.trim() === '' ? {} : { apiKey: key.trim() }),
    ...(address.trim() === '' ? {} : { baseUrl: address.trim() }),
    ...(withModel === undefined || withModel === '' ? {} : { model: withModel }),
  });

  /** Ask one model whether it can build; the answer lands only if nothing changed since. */
  const check = async (id: ConfigurableProvider, listed: { id: string; label: string }[], chosen: string, ticket: number): Promise<void> => {
    const started = performance.now();
    const reply = await designerApi.testConnection(draft(id, chosen)).catch((error: unknown) => ({
      ok: false,
      models: [],
      canBuild: null,
      error: { code: 'error', message: error instanceof ApiError || error instanceof Error ? error.message : String(error) },
    }));
    if (run.current !== ticket) return;
    if (!reply.ok) {
      setTest(failure(id, reply.error));
      return;
    }
    setTest({ kind: 'passed', models: listed, ms: performance.now() - started, verdict: reply.canBuild });
  };

  const runTest = async (): Promise<void> => {
    if (provider === null) return;
    run.current += 1;
    const ticket = run.current;
    setTest({ kind: 'testing' });
    setSaveError(null);
    const listed = await designerApi.testConnection(draft(provider)).catch((error: unknown) => ({
      ok: false,
      models: [],
      canBuild: null,
      error: { code: 'error', message: error instanceof ApiError || error instanceof Error ? error.message : String(error) },
    }));
    if (run.current !== ticket) return;
    if (!listed.ok) {
      setTest(failure(provider, listed.error));
      return;
    }
    const chosen = listed.models.some((entry) => entry.id === model) ? model : (listed.models[0]?.id ?? model);
    setModel(chosen);
    if (chosen === '') {
      // Nothing listed (a compatible service may not list): the model is typed, then asked.
      setTest({ kind: 'passed', models: [], ms: null, verdict: null });
      return;
    }
    await check(provider, listed.models, chosen, ticket);
  };

  const changeModel = (next: string): void => {
    setModel(next);
    if (provider === null || test.kind !== 'passed' || next === '') return;
    run.current += 1;
    setTest({ ...test, verdict: 'checking', ms: null });
    void check(provider, test.models, next, run.current);
  };

  const fieldChanged = (): void => {
    run.current += 1;
    setTest({ kind: 'idle' });
    setSaveError(null);
  };

  const save = async (): Promise<void> => {
    if (provider === null || model.trim() === '') return;
    setSaving(true);
    setSaveError(null);
    try {
      const connection = await designerApi.saveConnection({ ...draft(provider), model: model.trim() });
      onSaved({ connection, model: model.trim() });
    } catch (error) {
      setSaveError(error instanceof ApiError || error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const fields = provider === null ? null : providerFields(provider);
  const keySaved = provider !== null && added(provider) && fields?.key !== 'none';
  const busy = test.kind === 'testing' || saving;
  const missing = fields !== null && ((fields.key === 'required' && key.trim() === '' && !keySaved) || (fields.address === 'required' && address.trim() === ''));
  const passed = test.kind === 'passed' ? test : null;
  const canSave = passed !== null && model.trim() !== '' && passed.verdict !== 'checking' && !saving;
  const resultId = 'designer-add-model-result';

  return (
    <Modal open={open} onOpenChange={onOpenChange} className="max-w-[560px] max-sm:inset-0 max-sm:m-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:rounded-none">
      <ModalHeader
        icon={<Cpu />}
        title={t('designer:model.add', 'Add a model')}
        subtitle={provider === null ? t('designer:model.chooseProvider', 'Choose a provider') : providerLabel(provider)}
        closeLabel={t('designer:model.close', 'Close')}
      />
      <ModalBody className="flex flex-col gap-4 pt-1">
        {provider === null ? (
          <div role="group" aria-label={t('designer:model.chooseProvider', 'Choose a provider')} className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-3">
            {PROVIDERS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => choose(id)}
                className="flex flex-col items-start gap-1 rounded-[12px] border border-border bg-surface px-4 py-3.5 text-start hover:border-accent/50 hover:bg-surface-2 focus-visible:border-accent"
              >
                <span className="flex w-full items-center gap-2">
                  <span className="text-sm font-extrabold text-fg">{providerLabel(id)}</span>
                  {added(id) ? (
                    <span className="ms-auto inline-flex items-center gap-1 rounded-full bg-pos-soft px-2 py-0.5 text-[10.5px] font-bold text-pos">
                      <Check aria-hidden="true" className="size-3" />
                      {t('designer:model.addedChip', 'Added')}
                    </span>
                  ) : null}
                </span>
                <span className="text-[12.5px] leading-normal text-fg-muted">{providerLine(id)}</span>
              </button>
            ))}
          </div>
        ) : (
          <>
            {fields?.address === 'none' ? null : (
              <FormField label={t('designer:model.address', 'Address')} error={test.kind === 'failed' && test.on === 'address' ? test.message : undefined}>
                <Input
                  type="url"
                  value={address}
                  placeholder={fields?.addressPlaceholder}
                  spellCheck={false}
                  autoComplete="off"
                  className="font-mono"
                  onChange={(event) => {
                    setAddress(event.target.value);
                    fieldChanged();
                  }}
                />
              </FormField>
            )}
            {fields?.key === 'none' ? null : (
              <FormField
                label={t('designer:model.key', 'API key')}
                tag={fields?.key === 'optional' ? <span className="text-[11px] font-semibold text-fg-subtle">{t('designer:model.optional', 'Optional')}</span> : undefined}
                helper={keySaved ? t('designer:model.keySaved', 'A key is saved. Type a new one to replace it.') : undefined}
                error={test.kind === 'failed' && test.on === 'key' ? test.message : undefined}
              >
                <SecretInput
                  value={key}
                  placeholder={fields?.keyPlaceholder}
                  spellCheck={false}
                  autoComplete="off"
                  revealLabel={t('designer:model.showKey', 'Show the key')}
                  hideLabel={t('designer:model.hideKey', 'Hide the key')}
                  copyLabel={t('designer:model.copyKey', 'Copy the key')}
                  copiedLabel={t('designer:model.copied', 'Copied')}
                  onChange={(event) => {
                    setKey(event.target.value);
                    fieldChanged();
                  }}
                />
              </FormField>
            )}
            <FormField label={t('designer:model.model', 'Model')}>
              {passed !== null && passed.models.length === 0 ? (
                <Input value={model} spellCheck={false} autoComplete="off" className="font-mono" onChange={(event) => setModel(event.target.value)} />
              ) : (
                <Select value={passed === null ? '' : model} disabled={passed === null} mono={provider === 'ollama'} onChange={(event) => changeModel(event.target.value)}>
                  {passed === null ? (
                    <option value="">
                      {fields?.key === 'required' ? t('designer:model.testKeyFirst', 'Test the key to list models') : t('designer:model.testAddressFirst', 'Test the address to list models')}
                    </option>
                  ) : (
                    passed.models.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))
                  )}
                </Select>
              )}
            </FormField>

            <div id={resultId} aria-live="polite" className="flex flex-col gap-1.5 empty:hidden">
              {passed !== null && passed.ms !== null && model !== '' ? (
                <p className="m-0 flex items-start gap-2 text-[12.5px] font-semibold text-pos">
                  <CircleCheck aria-hidden="true" className="mt-0.5 size-[15px] shrink-0" />
                  <span>
                    {t('designer:model.connected', 'Connected. {model} answered in {seconds} s.', {
                      model: passed.models.find((entry) => entry.id === model)?.label ?? model,
                      seconds: seconds(passed.ms),
                    })}
                  </span>
                </p>
              ) : null}
              {passed?.verdict === 'checking' ? (
                <p className="m-0 flex items-center gap-2 text-[12.5px] text-fg-muted">
                  <Loader2 aria-hidden="true" className="size-[15px] shrink-0 animate-spin" />
                  {t('designer:model.checking', 'Asking this model whether it can build…')}
                </p>
              ) : null}
              {passed !== null && typeof passed.verdict === 'object' && passed.verdict !== null ? (
                passed.verdict.canBuild ? (
                  <p className="m-0 flex items-start gap-2 text-[12.5px] font-semibold text-pos">
                    <CircleCheck aria-hidden="true" className="mt-0.5 size-[15px] shrink-0" />
                    {t('designer:model.canBuild', 'This model can build apps.')}
                  </p>
                ) : (
                  <p className="m-0 flex items-start gap-2 text-[12.5px] font-semibold text-warn">
                    <TriangleAlert aria-hidden="true" className="mt-0.5 size-[15px] shrink-0" />
                    {t('designer:model.cannotBuildSave', 'This model cannot build apps: it does not support tools. You can still save it for other uses.')}
                  </p>
                )
              ) : null}
              {test.kind === 'failed' && test.on === 'form' ? (
                <p role="alert" className="m-0 flex items-start gap-2 text-[12.5px] font-semibold text-danger">
                  <CircleAlert aria-hidden="true" className="mt-0.5 size-[15px] shrink-0" />
                  {test.message}
                </p>
              ) : null}
              {saveError === null ? null : (
                <p role="alert" className="m-0 flex items-start gap-2 text-[12.5px] font-semibold text-danger">
                  <CircleAlert aria-hidden="true" className="mt-0.5 size-[15px] shrink-0" />
                  {saveError}
                </p>
              )}
            </div>

            <div className="flex items-start gap-2.5 rounded-[12px] border border-border bg-surface-2 px-3.5 py-3">
              <FileText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
              <p className="m-0 text-pretty text-[12.5px] leading-normal text-fg-muted">
                <span className="font-bold text-fg">{t('designer:model.keptLead', 'Where this is kept:')}</span> <KeptLine />
              </p>
            </div>
          </>
        )}
      </ModalBody>
      {provider === null ? null : (
        <ModalFooter className="max-sm:flex-wrap">
          <Button
            variant="ghost"
            className="me-auto"
            onClick={() => {
              run.current += 1;
              setProvider(null);
              setTest({ kind: 'idle' });
            }}
          >
            {t('designer:model.back', 'Back')}
          </Button>
          <Button variant="secondary" disabled={busy || missing} onClick={() => void runTest()}>
            {test.kind === 'testing' ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
            {test.kind === 'testing' ? t('designer:model.testing', 'Testing…') : t('designer:model.test', 'Test')}
          </Button>
          <Button variant="primary" disabled={!canSave} onClick={() => void save()}>
            {saving ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
            {saving ? t('designer:model.saving', 'Saving…') : t('designer:model.save', 'Save')}
          </Button>
        </ModalFooter>
      )}
    </Modal>
  );
}

/** "in the file `.env` in your project folder, …", with the file name in mono wherever the language puts it. */
function KeptLine(): ReactNode {
  const MARK = '\u0001';
  const [before = '', after = ''] = t('designer:model.kept', 'in the file {file} in your project folder, on this machine. It is not sent to the browser and not committed to git.', { file: MARK }).split(MARK);
  return (
    <>
      {before}
      <span className="font-mono font-semibold text-fg">.env</span>
      {after}
    </>
  );
}
