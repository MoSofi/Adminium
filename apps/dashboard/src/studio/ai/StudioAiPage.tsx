// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/settings/ai` — Settings → AI. Where an Admin configures the
 * direct-API provider used to enrich a schema, reads the BYO (copy-paste)
 * round-trip guarantee, and reviews past enrichment runs. The provider form is
 * no longer only here — the connect wizard's enrich step renders the same
 * component — but the guarantee and the history are.
 *
 * Seed patterns: `API Keys.dc.html` (write-only key entry → masked `sk-…last4` +
 * Replace) and `Integrations.dc.html` (provider connect cards). RBAC is enforced
 * one level up by `StudioGuard` (Admin + Super-Admin) and again by every
 * `/api/v1/llm/*` route — Editors/Viewers never reach this surface and see no AI
 * navigation (acceptance #13).
 *
 * The provider form itself lives in `ProviderConfigForm.tsx` — this page is one
 * of its two hosts, the connect wizard's enrich step is the other
 * (R3). Its write-only key contract, model list and test button are documented
 * there.
 */
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { getFormatters } from '@adminium/i18n';
import { KeyRound, ScrollText } from 'lucide-react';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  IconTile,
  MonoText,
  Select,
  Spinner,
  StatusPill,
  Tag,
  type Tone,
} from '@adminium/ui';

import { llmAffordances, systemInfoQuery } from '../../app/capabilities.js';
import { getI18nInstance, t } from '../../i18n/t.js';
import { connectionsQuery } from '../hub/ConnectionsHub.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import type { ConnectionDto } from '../api.js';
import { ProviderConfigForm, aiConfigQuery } from './ProviderConfigForm.js';
import { aiApi, type LlmRunDto, type LlmRunStatus } from './api.js';
import { PROMPT_VERSION, SCHEMA_VERSION } from './providerCatalog.js';

/** Locale-bound Intl formatters, test-safe (ConnectionsHub precedent). */
function fmt() {
  return getFormatters(getI18nInstance()?.language ?? 'en-US');
}

// ── Run status → pill tone/label ───────────────────────────────────────────────

const RUN_STATUS_TONE: Record<LlmRunStatus, Tone> = {
  draft: 'neutral',
  running: 'info',
  awaiting_response: 'warn',
  validated: 'accent',
  applied: 'pos',
  partially_applied: 'pos',
  failed: 'danger',
  discarded: 'neutral',
};

function runStatusLabel(status: LlmRunStatus): string {
  switch (status) {
    case 'draft':
      return t('studio:settingsAi.runStatus.draft', 'Draft');
    case 'running':
      return t('studio:settingsAi.runStatus.running', 'Running');
    case 'awaiting_response':
      return t('studio:settingsAi.runStatus.awaitingResponse', 'Awaiting response');
    case 'validated':
      return t('studio:settingsAi.runStatus.validated', 'Validated');
    case 'applied':
      return t('studio:settingsAi.runStatus.applied', 'Applied');
    case 'partially_applied':
      return t('studio:settingsAi.runStatus.partiallyApplied', 'Partially applied');
    case 'failed':
      return t('studio:settingsAi.runStatus.failed', 'Failed');
    case 'discarded':
      return t('studio:settingsAi.runStatus.discarded', 'Discarded');
  }
}

// ── BYO explainer panel ─────────────────────────────────────────────────────────

/**
 * `highlighted` is "highlighted first in desktop" — the visual half of the
 * same decision the page's ordering makes. It changes the accent, the tile
 * tone and the heading, because leading with a card that opens "No key?" would
 * still frame the round-trip as the consolation prize on the one runtime where
 * it is the recommendation (LLM row).
 */
function ByoPanel({ highlighted = false }: { highlighted?: boolean }): ReactNode {
  return (
    <Card className={highlighted ? 'border-accent/40' : undefined}>
      <CardHeader className="flex items-center gap-3">
        <IconTile tone={highlighted ? 'accent' : 'neutral'} size="md" icon={<KeyRound />} />
        <div className="min-w-0 flex-1">
          <h3 className="text-section text-fg">
            {highlighted
              ? t('studio:settingsAi.byo.headingRecommended', 'Use your own AI tool — no key needed')
              : t('studio:settingsAi.byo.heading', 'No key? Use your own AI tool')}
          </h3>
          <p className="text-caption text-fg-subtle">
            {t('studio:settingsAi.byo.subtitle', 'The copy-paste round-trip — nothing leaves this machine.')}
          </p>
        </div>
        {highlighted ? (
          <Badge tone="accent">{t('studio:settingsAi.byo.recommended', 'Recommended')}</Badge>
        ) : null}
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <p className="text-body-sm text-fg-muted">
          {t(
            'studio:settingsAi.byo.body',
            'Studio can generate a self-contained prompt from your schema. Run it in Claude Code, ChatGPT, or any tool you like, then paste the JSON it returns back into the connect wizard. Same validation, same review, same result as the direct path.',
          )}
        </p>
        <div>
          <p className="text-caption font-bold text-fg">
            {t('studio:settingsAi.byo.guaranteeTitle', 'Telemetry-free guarantee')}
          </p>
          <ul className="mt-1 flex list-none flex-col gap-1 p-0 text-caption text-fg-muted">
            <li>{t('studio:settingsAi.byo.guarantee1', 'The prompt carries only your schema and aggregate stats — never row data by default.')}</li>
            <li>{t('studio:settingsAi.byo.guarantee2', 'No credentials, instance URL, or identifiers are embedded.')}</li>
            <li>{t('studio:settingsAi.byo.guarantee3', 'BYO runs make zero network calls.')}</li>
          </ul>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tag>
            {t('studio:settingsAi.byo.promptVersion', 'Prompt {version}', { version: PROMPT_VERSION })}
          </Tag>
          <Tag>
            {t('studio:settingsAi.byo.schemaVersion', 'Schema {version}', { version: SCHEMA_VERSION })}
          </Tag>
        </div>
      </CardBody>
    </Card>
  );
}

// ── Run history ─────────────────────────────────────────────────────────────────

function RunSourceCell({ run }: { run: LlmRunDto }): ReactNode {
  if (run.mode === 'byo') {
    return <Badge tone="neutral">{t('studio:settingsAi.history.byo', 'BYO')}</Badge>;
  }
  const provider = run.provider ?? t('studio:settingsAi.history.directPath', 'Direct');
  return (
    <span className="min-w-0 truncate text-body-sm text-fg">
      <span className="font-semibold">{provider}</span>
      {run.model === null ? null : (
        <>
          {' '}
          <MonoText className="text-caption text-fg-muted">{run.model}</MonoText>
        </>
      )}
    </span>
  );
}

function RunHistoryTable({
  runs,
  onOpenReview,
}: {
  runs: readonly LlmRunDto[];
  onOpenReview: (runId: string) => void;
}): ReactNode {
  const numbers = fmt();
  return (
    <div className="flex flex-col">
      {/* Visual column headers; each row button carries a self-describing label. */}
      <div
        aria-hidden="true"
        className="grid grid-cols-[1.4fr_1.6fr_1fr_0.8fr] gap-3 border-b border-border px-3 pb-2 text-micro uppercase text-fg-subtle"
      >
        <span>{t('studio:settingsAi.history.colDate', 'Date')}</span>
        <span>{t('studio:settingsAi.history.colSource', 'Source')}</span>
        <span>{t('studio:settingsAi.history.colStatus', 'Status')}</span>
        <span className="text-end">{t('studio:settingsAi.history.colChunks', 'Chunks')}</span>
      </div>
      <div className="divide-y divide-border/70">
        {runs.map((run) => (
          <button
            key={run.id}
            type="button"
            onClick={() => onOpenReview(run.id)}
            aria-label={t('studio:settingsAi.history.openReview', 'Open review for the run from {date}', {
              date: numbers.dateTime(run.createdAt),
            })}
            className="grid w-full grid-cols-[1.4fr_1.6fr_1fr_0.8fr] items-center gap-3 px-3 py-2.5 text-start transition-colors hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          >
            <span className="min-w-0 truncate text-body-sm text-fg">{numbers.relative(run.createdAt)}</span>
            <span className="min-w-0">
              <RunSourceCell run={run} />
            </span>
            <span>
              <StatusPill status={run.status} tone={RUN_STATUS_TONE[run.status]}>
                {runStatusLabel(run.status)}
              </StatusPill>
            </span>
            <span className="text-end tabular-nums text-body-sm text-fg-muted">
              {numbers.number(run.chunksReceived)}
              <span className="text-fg-subtle">/{numbers.number(run.chunksTotal)}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function RunHistoryForConnection({
  connectionId,
  onOpenReview,
}: {
  connectionId: string;
  onOpenReview: (runId: string) => void;
}): ReactNode {
  const runsQuery = useQuery({
    queryKey: ['llm', 'runs', connectionId] as const,
    queryFn: () => aiApi.listRuns(connectionId),
  });

  if (runsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="md" />
      </div>
    );
  }
  if (runsQuery.isError) {
    return (
      <Alert
        tone="danger"
        role="alert"
        title={t('studio:settingsAi.history.errorTitle', 'Could not load runs')}
        body={t('studio:settingsAi.history.errorBody', 'Refresh the page to try again.')}
      />
    );
  }
  const runs = runsQuery.data ?? [];
  if (runs.length === 0) {
    return (
      <p className="py-6 text-center text-body-sm text-fg-muted">
        {t('studio:settingsAi.history.empty', 'No enrichment runs yet. Enrich a schema from the connect wizard to see history here.')}
      </p>
    );
  }
  return <RunHistoryTable runs={runs} onOpenReview={onOpenReview} />;
}

function RunHistorySection({
  connections,
  onOpenReview,
}: {
  connections: readonly ConnectionDto[];
  onOpenReview: (runId: string) => void;
}): ReactNode {
  const [connectionId, setConnectionId] = useState<string | null>(() => connections[0]?.id ?? null);
  const selected = connections.find((c) => c.id === connectionId) ?? connections[0] ?? null;

  return (
    <Card padded={false}>
      <CardHeader className="flex flex-wrap items-center gap-3">
        <IconTile tone="accent" size="md" icon={<ScrollText />} />
        <div className="min-w-0 flex-1">
          <h3 className="text-section text-fg">{t('studio:settingsAi.history.heading', 'Run history')}</h3>
          <p className="text-caption text-fg-subtle">
            {t('studio:settingsAi.history.subtitle', 'Past enrichment runs. Open one to review its suggestions.')}
          </p>
        </div>
        {connections.length > 1 && selected !== null ? (
          <label className="flex items-center gap-2 text-caption text-fg-muted">
            <span>{t('studio:settingsAi.history.connection', 'Connection')}</span>
            <Select
              value={selected.id}
              onChange={(event) => setConnectionId(event.currentTarget.value)}
              aria-label={t('studio:settingsAi.history.connection', 'Connection')}
              wrapperClassName="w-[200px]"
            >
              {connections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.name}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
      </CardHeader>
      <CardBody>
        {selected === null ? (
          <p className="py-6 text-center text-body-sm text-fg-muted">
            {t('studio:settingsAi.history.noConnections', 'Connect a database first — enrichment runs are recorded per connection.')}
          </p>
        ) : (
          <RunHistoryForConnection connectionId={selected.id} onOpenReview={onOpenReview} />
        )}
      </CardBody>
    </Card>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────────

export interface StudioAiPageProps {
  /** Router-injected: opens `/studio/llm-runs/:id/review` (read-only once applied). */
  onOpenReview: (runId: string) => void;
}

export function StudioAiPage({ onOpenReview }: StudioAiPageProps): ReactNode {
  const { data: config } = useSuspenseQuery(aiConfigQuery());
  const { data: connections } = useSuspenseQuery(connectionsQuery());

  // LLM row: "BYO round-trip is the default and is highlighted first in
  // desktop".
  //
  // SUSPENDING, unlike this module's other capability reads, because this one
  // decides the ORDER OF THE PAGE. The unresolved runtime is `self-host`, so a
  // non-suspending read would paint provider-first and then visibly swap the two
  // panels the moment the probe lands — on desktop, i.e. on every single load of
  // the one runtime this ordering exists for. The page already suspends on
  // `aiConfigQuery` and `connectionsQuery`; joining them costs nothing and the
  // reader sees one layout.
  const { data: info } = useSuspenseQuery(systemInfoQuery());
  const { providerApi, byoFirst } = llmAffordances(info);

  const byo = <ByoPanel key="byo" highlighted={byoFirst} />;
  const provider = <ProviderConfigForm key="provider" config={config} networkAllowed={providerApi.enabled} />;

  return (
    <PageSurface width="page" className="flex flex-col gap-6">
      <PageActions
        title={t('studio:settingsAi.title', 'AI enrichment')}
        subtitle={t(
          'studio:settingsAi.subtitle',
          'Connect a model to let Adminium suggest labels, groups, relations and more — always reviewed as a diff before anything applies.',
        )}
      />

      {/* Order IS the recommendation — the top card is what an admin reads
          first and what they take to be the normal way. On desktop (and on any
          air-gapped install) that has to be the round-trip. Keyed so React moves
          the nodes rather than remounting them and dropping the provider draft. */}
      {byoFirst ? [byo, provider] : [provider, byo]}
      <RunHistorySection connections={connections} onOpenReview={onOpenReview} />
    </PageSurface>
  );
}
