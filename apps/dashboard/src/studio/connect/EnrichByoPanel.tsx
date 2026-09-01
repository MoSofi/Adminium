// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BYO round-trip panel (06-llm-assist.md §10.2 step 4, §9). For each prompt
 * chunk: a read-only virtualized prompt viewer with a token-estimate chip,
 * Copy-prompt and Download-.md, then a paste textarea + `.json` drop zone and a
 * per-chunk Validate that POSTs `/runs/:id/response`. Fatal validation renders
 * the precise per-path error list with "Copy errors for your AI tool"; once
 * every chunk validates, the deterministic merge unlocks "Continue to review".
 *
 * Zero network I/O beyond the validation POST (which runs in-process on the
 * server); copy and download stay entirely local (§9 telemetry-free guarantee).
 */
import { getFormatters } from '@adminium/i18n';
import { CheckCircle2, Download } from 'lucide-react';
import { useState } from 'react';
import { Alert, Badge, Button, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from '@adminium/ui';

import { getI18nInstance, t } from '../../i18n/t.js';
import { aiApi, type LlmPromptChunk, type LlmValidationError } from '../ai/api.js';
import { CopyButton } from './CopyButton.js';
import { Dropzone } from './Dropzone.js';
import { MonoPromptViewer } from './MonoPromptViewer.js';
import { ValidationErrorList } from './ValidationErrorList.js';
import { allChunksValid, promptFileName, type ChunkStatus } from './enrichState.js';
import { downloadTextFile } from './enrichIo.js';

interface ChunkUi {
  text: string;
  status: ChunkStatus;
  errors: LlmValidationError[];
  warnings: LlmValidationError[];
}

const EMPTY_CHUNK: ChunkUi = { text: '', status: 'empty', errors: [], warnings: [] };

export interface EnrichByoPanelProps {
  runId: string;
  chunks: readonly LlmPromptChunk[];
  tokenEstimate: number;
  onContinueReview: (runId: string) => void;
}

function tokenLabel(tokenEstimate: number): string {
  const tag = getI18nInstance()?.language ?? 'en-US';
  const formatted = getFormatters(tag).number(tokenEstimate);
  return t('studio:enrich.byo.tokenChip', '≈ {tokens} tokens', { tokens: formatted });
}

export function EnrichByoPanel({ runId, chunks, tokenEstimate, onContinueReview }: EnrichByoPanelProps) {
  const chunked = chunks.length > 1;
  const [active, setActive] = useState(0);
  const [ui, setUi] = useState<ChunkUi[]>(() => chunks.map(() => ({ ...EMPTY_CHUNK })));

  const patchChunk = (index: number, next: Partial<ChunkUi>) => {
    setUi((current) => current.map((chunk, i) => (i === index ? { ...chunk, ...next } : chunk)));
  };

  const setText = (index: number, text: string) => {
    // Editing invalidates a prior validation for that chunk.
    patchChunk(index, { text, status: 'empty', errors: [], warnings: [] });
  };

  const validateChunk = async (index: number) => {
    const chunk = chunks[index];
    if (chunk === undefined) return;
    patchChunk(index, { status: 'validating' });
    try {
      const result = await aiApi.postResponse(runId, {
        ...(chunked ? { chunkIndex: chunk.index } : {}),
        text: ui[index]?.text ?? '',
      });
      patchChunk(index, {
        status: result.validation.ok ? 'valid' : 'error',
        errors: result.validation.errors,
        warnings: result.validation.warnings,
      });
    } catch (cause) {
      patchChunk(index, {
        status: 'error',
        errors: [
          {
            code: 'LLM_REQUEST_FAILED',
            severity: 'fatal',
            path: '',
            message:
              cause instanceof Error
                ? cause.message
                : t('studio:enrich.byo.requestFailed', 'Could not reach the server to validate — retry.'),
          },
        ],
        warnings: [],
      });
    }
  };

  const readDropped = (index: number, file: File) => {
    void file.text().then((text) => setText(index, text));
  };

  const ready = allChunksValid(ui.map((chunk) => chunk.status));

  const renderChunk = (index: number) => {
    const chunk = chunks[index];
    if (chunk === undefined) return null;
    const state = ui[index] ?? EMPTY_CHUNK;
    const viewerLabel = chunked
      ? t('studio:enrich.byo.promptLabelN', 'Enrichment prompt {index} of {total}', { index: String(chunk.index), total: String(chunk.total) })
      : t('studio:enrich.byo.promptLabel', 'Enrichment prompt');

    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{tokenLabel(tokenEstimate)}</Badge>
          <div className="ms-auto flex items-center gap-2">
            <CopyButton
              value={chunk.byo}
              label={t('studio:enrich.byo.copyPrompt', 'Copy prompt')}
              copiedLabel={t('studio:enrich.byo.copyPromptDone', 'Prompt copied')}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => downloadTextFile(promptFileName(runId, chunk.index, chunk.total), chunk.byo)}
            >
              <span className="flex items-center gap-1.5">
                <Download aria-hidden="true" className="size-3.5" />
                {t('studio:enrich.byo.download', 'Download .md')}
              </span>
            </Button>
          </div>
        </div>

        <MonoPromptViewer text={chunk.byo} label={viewerLabel} />

        <p className="text-body-sm text-fg-muted">
          {t(
            'studio:enrich.byo.guidance',
            'Run this in any AI tool — Claude Code, ChatGPT, anything. Paste the JSON it returns below.',
          )}
        </p>

        <Textarea
          mono
          rows={6}
          value={state.text}
          onChange={(event) => setText(index, event.currentTarget.value)}
          aria-label={t('studio:enrich.byo.pasteLabel', 'Paste the JSON response')}
          placeholder={t('studio:enrich.byo.pastePlaceholder', 'Paste the JSON response here…')}
          error={state.status === 'error'}
        />
        <Dropzone accept=".json,application/json" onFile={(file) => readDropped(index, file)} />

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={state.status === 'validating'}
            disabled={state.text.trim().length === 0}
            onClick={() => void validateChunk(index)}
          >
            {t('studio:enrich.byo.validate', 'Validate')}
          </Button>
          {state.status === 'valid' ? (
            <span className="flex items-center gap-1.5 text-body-sm font-semibold text-pos">
              <CheckCircle2 aria-hidden="true" className="size-4" />
              {chunked
                ? t('studio:enrich.byo.chunkValid', 'Chunk {index} validated', { index: String(chunk.index) })
                : t('studio:enrich.byo.valid', 'Response validated')}
            </span>
          ) : null}
        </div>

        {state.status === 'error' ? (
          <ValidationErrorList errors={state.errors} warnings={state.warnings} />
        ) : null}

        {state.status === 'valid' && state.warnings.length > 0 ? (
          <p className="text-caption text-fg-muted">
            {t('studio:enrich.byo.droppedItems', '{count} suggestions were dropped during validation — review shows the rest.', { count: String(state.warnings.length) })}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {chunked ? (
        <Tabs value={String(active)} onValueChange={(value) => setActive(Number(value))}>
          <TabsList aria-label={t('studio:enrich.byo.chunkTabs', 'Prompt chunks')}>
            {chunks.map((chunk, index) => (
              <TabsTrigger key={chunk.index} value={String(index)}>
                {ui[index]?.status === 'valid' ? (
                  <CheckCircle2 aria-hidden="true" className="me-1.5 size-3.5 text-pos" />
                ) : null}
                {t('studio:enrich.byo.chunkTab', 'Prompt {index}', { index: String(chunk.index) })}
              </TabsTrigger>
            ))}
          </TabsList>
          {chunks.map((chunk, index) => (
            <TabsContent key={chunk.index} value={String(index)}>
              {renderChunk(index)}
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        renderChunk(0)
      )}

      {ready ? (
        <div className="flex flex-col gap-3 rounded-lg border border-pos bg-pos-soft p-3.5">
          <div className="flex items-start gap-2">
            <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-pos" />
            <div className="flex flex-col gap-0.5">
              <p className="text-body-sm font-semibold text-fg">
                {chunked
                  ? t('studio:enrich.byo.mergedTitle', 'All {count} chunks validated and merged', { count: String(chunks.length) })
                  : t('studio:enrich.byo.mergedTitleSingle', 'Response validated')}
              </p>
              <p className="text-caption text-fg-muted">
                {t('studio:enrich.byo.mergedBody', 'Suggestions are ready to review against the heuristic baseline.')}
              </p>
            </div>
          </div>
          <div>
            <Button type="button" onClick={() => onContinueReview(runId)}>
              {t('studio:enrich.byo.continueReview', 'Continue to review')}
            </Button>
          </div>
        </div>
      ) : (
        <Alert
          tone="info"
          title={t('studio:enrich.byo.pendingTitle', 'Validate every prompt to continue')}
          body={
            chunked
              ? t(
                  'studio:enrich.byo.pendingBodyChunked',
                  'Each chunk must validate before the suggestions merge. Paste and validate every prompt above.',
                )
              : t('studio:enrich.byo.pendingBody', 'Paste the JSON response above and validate it to continue to review.')
          }
        />
      )}
    </div>
  );
}
