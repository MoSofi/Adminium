/**
 * Step 6 — generate + success (09 §8.2 step 4 tail): POST
 * /connections/:id/generate with the chosen intent, narrated by the staged
 * script (classification → template composition → page writes), then the
 * SuccessState with page/nav-group counts and "Open your app" (bootstrap
 * invalidation → the freshly generated nav renders).
 *
 * Schema-file mode is preview-only this wave: schema-file connections are
 * not creatable server-side yet (M9) — the step says so instead of faking it.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Alert, Button, MonoText, SuccessState } from '@adminium/ui';

import { ApiError } from '../../../app/api.js';
import { t } from '../../../i18n/t.js';
import { studioApi, type GenerateResult } from '../../api.js';
import { LogConsole, type LogLine } from '../LogConsole.js';
import { clearWizardState, type WizardState } from '../wizardState.js';

export interface GenerateStepProps {
  state: WizardState;
  /** Navigate into the generated app (router-level; tests inject a spy). */
  onOpenApp: () => void;
  lineDelayMs?: number | undefined;
}

type Phase = 'idle' | 'running' | 'done' | 'error';

const wait = (ms: number) => (ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms)));

export function GenerateStep({ state, onOpenApp, lineDelayMs = 250 }: GenerateStepProps) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>('idle');
  const [lines, setLines] = useState<LogLine[]>([]);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nextId = useRef(0);

  const push = (kind: LogLine['kind'], text: string) => {
    nextId.current += 1;
    const id = `gen_${nextId.current}`;
    setLines((current) => [
      ...current.map((line) => (line.kind === 'running' ? { ...line, kind: 'info' as const } : line)),
      { id, kind, text },
    ]);
  };

  const run = () => {
    if (state.connectionId === null) return;
    const connectionId = state.connectionId;
    setPhase('running');
    setError(null);
    setLines([]);
    void (async () => {
      try {
        push('running', t('studio.generate.log.classifying', 'Classifying schema…'));
        await wait(lineDelayMs);
        push('running', t('studio.generate.log.composing', 'Composing templates…'));
        const generated = await studioApi.generate(connectionId, state.intent);
        push('running', t('studio.generate.log.writing', 'Writing pages…'));
        await wait(lineDelayMs);
        push(
          'ok',
          t('studio.generate.log.done', '{pages} pages generated across {groups} nav groups', { pages: String(generated.pages), groups: String(generated.navGroups.length) }),
        );
        setResult(generated);
        setPhase('done');
        // The nav tree changed — the next bootstrap read must be fresh.
        await queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
      } catch (cause) {
        setPhase('error');
        setError(
          cause instanceof ApiError
            ? cause.message
            : t('studio.generate.failed', 'Generation failed — retry, or re-run introspection first.'),
        );
      }
    })();
  };

  if (state.mode === 'file') {
    return (
      <section aria-label={t('studio.generate.title', 'Generate your app')} className="flex flex-col gap-4">
        <h2 className="text-section text-fg">{t('studio.generate.title', 'Generate your app')}</h2>
        <Alert
          tone="info"
          title={t('studio.generate.fileTitle', 'Schema file parsed — generation needs a live database')}
          body={t(
            'studio.generate.fileBody',
            'Your schema parsed cleanly and the preview above is real. Generating a running app straight from a schema file (with placeholder rows) is not available yet — connect a live database to generate today.',
          )}
        />
      </section>
    );
  }

  if (phase === 'done' && result !== null) {
    return (
      <SuccessState
        title={t('studio.generate.successTitle', 'Your dashboard is ready')}
        body={t('studio.generate.successBody', '{pages} pages across {groups} navigation groups — generated from your schema, editable in Studio.', { pages: String(result.pages), groups: String(result.navGroups.length) })}
        doneLabel={t('studio.generate.openApp', 'Open your app')}
        onDone={() => {
          clearWizardState();
          onOpenApp();
        }}
      />
    );
  }

  return (
    <section aria-label={t('studio.generate.title', 'Generate your app')} className="flex flex-col gap-4">
      <div>
        <h2 className="text-section text-fg">{t('studio.generate.title', 'Generate your app')}</h2>
        <p className="mt-1 text-body-sm text-fg-muted">
          {t('studio.generate.subtitle', 'One page per included table plus dashboards per domain — intent:')}{' '}
          <MonoText>{state.intent}</MonoText>
        </p>
      </div>
      {lines.length > 0 ? <LogConsole lines={lines} label={t('studio.generate.logLabel', 'Generation log')} /> : null}
      {error !== null ? (
        <Alert tone="danger" role="alert" title={t('studio.generate.errorTitle', 'Generation failed')} body={error} />
      ) : null}
      <div>
        <Button onClick={run} loading={phase === 'running'} disabled={state.connectionId === null}>
          {t('studio.generate.run', 'Generate dashboard')}
        </Button>
      </div>
    </section>
  );
}
