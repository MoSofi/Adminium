/**
 * `page-builder` template renderer (04-widget-registry.md §10 manifest
 * `page-builder.json`, 09-generated-app.md §7.11, M7-T06).
 *
 * Fills the manifest's three slots from the stored envelope config body:
 *
 *   palette   — a block rail (document flavors only; `question-builder` and
 *               `flow-builder` ship their own palettes, so those flavors omit
 *               it exactly like the manifest slot's `fallback: 'omit'`);
 *   canvas    — the docType's canvas widget via WidgetHost (`document-canvas`
 *               for invoice/report/email, `question-builder` for survey,
 *               `flow-builder` for automation), fed by the stored slot config
 *               plus the current doc payload;
 *   inspector — doc fields + block visibility (document flavors), the LIVE
 *               publish summary (survey — the ia-mapping §5 static-counts
 *               fix), or run stats + step counts (automation).
 *
 * Chrome: `autosave-indicator` renders as the @adminium/ui pill fed by the
 * host's save choreography; `starter-template-picker` mounts as an overlay and
 * seeds full docs (12 domain-true invoice starters).
 *
 * STATE MODEL: the renderer owns a WORKING DRAFT of the document so palette,
 * inspector and canvas stay coherent without a host round trip; every change
 * is reported through `onDocChange` (documents) or forwarded `mutate` events
 * (survey/automation), and the HOST owns persistence — same division as
 * `document-canvas` itself (block-lib.ts). Canvas-internal edits arrive as
 * mutate intents and are echoed onto the draft (`reorderDocByBlockIds`), so
 * the two never disagree about the block list.
 */
import {
  AutosaveIndicator,
  Button,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  MonoText,
  Switch,
  cn,
  type AutosaveStatus,
} from '@adminium/ui';
import {
  AlarmClock,
  Award,
  BadgeCheck,
  BarChart3,
  Coins,
  FileText,
  GitBranch,
  History,
  Image,
  LayoutGrid,
  LifeBuoy,
  Paperclip,
  PenLine,
  Percent,
  QrCode,
  Repeat,
  Rows3,
  Send,
  Sigma,
  Sparkles,
  SquareCheckBig,
  SquareDashed,
  Table2,
  TicketPercent,
  TrendingUp,
  Truck,
  Zap,
} from 'lucide-react';
import { useMemo, useState, type ComponentType, type ReactNode } from 'react';

import {
  BLOCK_KIND_META,
  BUILDER_DRAFT_BINDING,
  BUILDER_STARTERS,
  DOC_TYPE_PALETTE,
  addBlockToDoc,
  builderDemoDoc,
  builderDemoData,
  canvasDocTypeOf,
  canvasItemOf,
  canvasWidgetIdFor,
  docBlockInstancesOf,
  ensureTriggerFirst,
  flowNodesFromValues,
  pageBuilderConfigSchema,
  reorderDocByBlockIds,
  starterDocOf,
  surveySummaryOf,
  type BlockId,
  type BuilderDocType,
  type DocRecord,
  type DocType,
} from './builder-config.js';
import { rowOf } from '../../families/domain/block-lib.js';
import { WidgetHost } from '../../frame/WidgetHost.js';
import type { WidgetEvent } from '../../registry/types.js';

export const PAGE_BUILDER_TEMPLATE_ID = 'page-builder';

export interface PageBuilderLabels {
  paletteTitle?: string | undefined;
  inspectorTitle?: string | undefined;
  startFromTemplate?: string | undefined;
  publish?: string | undefined;
  close?: string | undefined;
  saving?: string | undefined;
  saved?: string | undefined;
  dirty?: string | undefined;
  saveError?: string | undefined;
}

export interface PageBuilderProps {
  /** The stored envelope `config` body (raw — validated here). */
  config: unknown;
  /**
   * Current canvas payload (host persistence re-entry): a `record` `{ row }`
   * doc for document flavors, a `form-state` envelope for survey/automation.
   * Absent → the flavor's deterministic demo payload (04 §5.3).
   */
  data?: unknown;
  /** Every canvas mutate intent bubbles here with the canvas instance id. */
  onEvent?: ((instanceId: string, event: WidgetEvent) => void | Promise<unknown>) | undefined;
  /** The working document after any palette/inspector/canvas change. */
  onDocChange?: ((doc: DocRecord) => void) | undefined;
  /** Autosave choreography (09 §7.10/§7.11) — host-owned; renders the pill. */
  autosave?: AutosaveStatus | undefined;
  /** Epoch-ms of the last successful save (the pill's "· HH:MM" stamp). */
  savedAt?: number | undefined;
  /** Extra toolbar actions (save-as-version, versions menu) from the host. */
  toolbarActions?: ReactNode | undefined;
  locale?: string | undefined;
  labels?: PageBuilderLabels | undefined;
  className?: string | undefined;
  testId?: string | undefined;
}

/** Icon slug → lucide component for the palette/inspector rows. */
const BLOCK_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  sigma: Sigma,
  'table-2': Table2,
  'layout-grid': LayoutGrid,
  'bar-chart-3': BarChart3,
  'trending-up': TrendingUp,
  'rows-3': Rows3,
  percent: Percent,
  coins: Coins,
  history: History,
  'ticket-percent': TicketPercent,
  award: Award,
  repeat: Repeat,
  'qr-code': QrCode,
  truck: Truck,
  'pen-line': PenLine,
  'square-check-big': SquareCheckBig,
  'badge-check': BadgeCheck,
  paperclip: Paperclip,
  'alarm-clock': AlarmClock,
  image: Image,
  'life-buoy': LifeBuoy,
  'square-dashed': SquareDashed,
};

function BlockIcon({ slug }: { slug: string }) {
  const Icon = BLOCK_ICONS[slug] ?? SquareDashed;
  return <Icon className="size-3.5" aria-hidden="true" />;
}

const PANE_CLASS =
  'flex shrink-0 flex-col gap-2 overflow-y-auto rounded-lg border border-border bg-surface p-3';

export function PageBuilder({
  config,
  data,
  onEvent,
  onDocChange,
  autosave = 'idle',
  savedAt,
  toolbarActions,
  locale,
  labels,
  className,
  testId,
}: PageBuilderProps) {
  const parsed = useMemo(() => pageBuilderConfigSchema.safeParse(config ?? {}), [config]);
  // Hooks before any early return — the invalid card renders below.
  const docType: BuilderDocType = parsed.success ? parsed.data.docType : 'invoice';
  const isDocument = docType !== 'survey' && docType !== 'automation';
  const canvasDocType: DocType = canvasDocTypeOf(docType);
  const canvas = useMemo(
    () => canvasItemOf(parsed.success ? parsed.data.layout : undefined, docType),
    [parsed, docType],
  );

  // ── working draft (documents) + live mirror (survey/automation) ────────────
  const [draft, setDraft] = useState<DocRecord | null>(null);
  const [mirror, setMirror] = useState<Record<string, unknown> | null>(null);
  const [revision, setRevision] = useState(0);
  const [starterOpen, setStarterOpen] = useState(false);
  const [publishStep, setPublishStep] = useState<'closed' | 'summary' | 'done'>('closed');

  const seededDoc = useMemo<DocRecord>(() => {
    const fromData = rowOf<DocRecord>(data);
    return fromData ?? builderDemoDoc(canvasDocType, 7);
  }, [data, canvasDocType]);
  const doc: DocRecord = draft ?? seededDoc;

  const canvasData: unknown = useMemo(() => {
    if (isDocument) return { row: doc };
    // The live mirror wins so a canvas remount (revision bump after a guard
    // correction or a version restore) re-seeds from the CURRENT state.
    if (mirror !== null) return { fields: [], values: mirror };
    return data ?? builderDemoData(docType, 7);
  }, [isDocument, doc, mirror, data, docType]);

  const commitDoc = (next: DocRecord): void => {
    setDraft(next);
    onDocChange?.(next);
  };

  // ── canvas widget config: stored slot config + renderer overrides ──────────
  const canvasConfig = useMemo(() => {
    const stored = canvas.config;
    if (isDocument) {
      return {
        selectable: true,
        reorderable: true,
        ...stored,
        docType: canvasDocType,
        ...(locale === undefined ? {} : { format: { ...(stored['format'] as object | undefined), locale } }),
      };
    }
    // Survey/automation: an unbound builder would emit no mutate intents at
    // all (forms-state.ts), which would freeze the live counts — inject the
    // draft binding so the stream exists; hosts filter it via isDraftMutation.
    return { ...stored, binding: stored['binding'] ?? BUILDER_DRAFT_BINDING };
  }, [canvas.config, isDocument, canvasDocType, locale]);

  // Visible block instances drive the canvas remount key: outside edits
  // (palette add, visibility toggle, starter apply) remount the canvas so its
  // LOCAL order state re-seeds; canvas-internal reorders keep the same id set
  // and stay mounted.
  const visibleIds = useMemo(
    () =>
      docBlockInstancesOf(doc, canvasDocType)
        .filter((instance) => doc.flags?.[instance.block] !== false)
        .map((instance) => instance.id)
        .sort()
        .join('|'),
    [doc, canvasDocType],
  );
  const canvasKey = isDocument ? `${String(revision)}:${visibleIds}` : `${String(revision)}:${docType}`;

  const summary = useMemo(() => surveySummaryOf(mirror ?? canvasData), [mirror, canvasData]);
  const flowNodes = useMemo(() => flowNodesFromValues(mirror ?? canvasData), [mirror, canvasData]);

  if (!parsed.success) {
    return (
      <p role="alert" className="p-6 text-body-sm text-fg-muted" data-testid="page-builder-invalid">
        This builder page&rsquo;s stored config is invalid. Regenerate the page or reset it.
      </p>
    );
  }

  const handleCanvasEvent = (event: WidgetEvent): void | Promise<unknown> => {
    let forwarded = event;
    if (event.type === 'mutate' && isDocument) {
      const order = event.values?.['blockOrder'];
      if (Array.isArray(order)) commitDoc(reorderDocByBlockIds(doc, order, canvasDocType));
    } else if (event.type === 'mutate' && docType === 'survey') {
      setMirror(event.values ?? null);
    } else if (event.type === 'mutate' && docType === 'automation') {
      // Trigger is non-removable (09 §7.11): patch both the live mirror and
      // the forwarded intent, so hosts never persist a trigger-less flow. When
      // the guard actually corrected the list, remount the canvas so its local
      // state re-seeds from the guarded mirror and the trigger reappears.
      const emitted = flowNodesFromValues(event.values);
      const guarded = ensureTriggerFirst(emitted, flowNodes);
      const values = { ...event.values, nodes: guarded };
      setMirror(values);
      if (guarded.length !== emitted.length) setRevision((current) => current + 1);
      forwarded = { ...event, values };
    }
    return onEvent?.(canvas.i, forwarded);
  };

  const addBlock = (block: BlockId): void => {
    commitDoc(addBlockToDoc(doc, block, canvasDocType));
  };

  const toggleBlock = (block: BlockId, on: boolean): void => {
    if (on) {
      const present = docBlockInstancesOf(doc, canvasDocType).some((instance) => instance.block === block);
      const flags = { ...doc.flags };
      delete flags[block];
      commitDoc(present ? { ...doc, flags } : addBlockToDoc({ ...doc, flags }, block, canvasDocType));
    } else {
      commitDoc({ ...doc, flags: { ...doc.flags, [block]: false } });
    }
  };

  const patchDoc = (patch: Partial<DocRecord>): void => {
    commitDoc({ ...doc, ...patch });
  };

  const applyStarter = (starterId: string | null): void => {
    const seeded = starterDocOf(starterId, canvasDocType);
    setStarterOpen(false);
    setRevision((current) => current + 1);
    commitDoc(seeded);
  };

  const palette = DOC_TYPE_PALETTE[canvasDocType];
  const activeBlocks = new Set(
    docBlockInstancesOf(doc, canvasDocType)
      .filter((instance) => doc.flags?.[instance.block] !== false)
      .map((instance) => instance.block),
  );

  return (
    <div data-part="page-builder" data-doc-type={docType} data-testid={testId} className={cn('flex h-full min-h-0 flex-col gap-3', className)}>
      {/* Toolbar — `chrome.toolbar: ['autosave-indicator']` (manifest). */}
      <div className="flex min-h-9 items-center gap-2">
        <AutosaveIndicator
          data-part="builder-autosave"
          status={autosave}
          savingLabel={labels?.saving ?? 'Saving…'}
          savedLabel={labels?.saved ?? 'All changes saved'}
          dirtyLabel={labels?.dirty ?? 'Unsaved changes'}
          errorLabel={labels?.saveError ?? 'Couldn’t save'}
        />
        {autosave === 'saved' && savedAt !== undefined && (
          <MonoText data-part="builder-saved-at" className="text-caption text-fg-subtle">
            {new Date(savedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
          </MonoText>
        )}
        <div className="ms-auto flex items-center gap-2">
          {toolbarActions}
          {docType === 'survey' && (
            <Button
              size="sm"
              iconLeft={<Send aria-hidden="true" />}
              data-part="builder-publish"
              onClick={() => setPublishStep('summary')}
            >
              {labels?.publish ?? 'Publish'}
            </Button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        {/* Palette — document flavors only (question/flow builders ship their own). */}
        {isDocument && (
          <aside data-part="builder-palette" aria-label={labels?.paletteTitle ?? 'Blocks'} className={cn(PANE_CLASS, 'hidden w-52 md:flex')}>
            <p className="text-caption font-bold uppercase tracking-wide text-fg-subtle">
              {labels?.paletteTitle ?? 'Blocks'}
            </p>
            <button
              type="button"
              data-part="builder-starter-open"
              onClick={() => setStarterOpen(true)}
              className={cn(
                'flex items-center gap-2 rounded-md border border-dashed border-border-strong px-2 py-1.5 text-start',
                'text-caption font-semibold text-fg-muted transition-colors duration-150',
                'hover:border-accent hover:text-accent',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              )}
            >
              <Sparkles className="size-3.5" aria-hidden="true" />
              {labels?.startFromTemplate ?? 'Start from a template'}
            </button>
            {palette.map((block) => {
              const meta = BLOCK_KIND_META[block];
              return (
                <button
                  key={block}
                  type="button"
                  data-part="builder-add-block"
                  data-block={block}
                  onClick={() => addBlock(block)}
                  className={cn(
                    'flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-start transition-colors duration-150',
                    'hover:border-accent hover:bg-accent-soft',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                  )}
                >
                  <span className="text-fg-muted">
                    <BlockIcon slug={meta.icon} />
                  </span>
                  <span className="min-w-0 truncate text-caption font-semibold text-fg">{meta.label}</span>
                </button>
              );
            })}
          </aside>
        )}

        {/* Canvas — the manifest's one required slot. */}
        <div data-part="builder-canvas" className="min-h-0 min-w-0 flex-1">
          <WidgetHost
            key={canvasKey}
            widgetId={canvasWidgetIdFor(docType)}
            instanceId={canvas.i}
            config={canvasConfig}
            data={{ status: 'success', data: canvasData }}
            onEvent={handleCanvasEvent}
          />
        </div>

        {/* Inspector — per-flavor context pane. */}
        <aside data-part="builder-inspector" aria-label={labels?.inspectorTitle ?? 'Inspector'} className={cn(PANE_CLASS, 'hidden w-64 lg:flex')}>
          <p className="text-caption font-bold uppercase tracking-wide text-fg-subtle">
            {labels?.inspectorTitle ?? 'Inspector'}
          </p>

          {isDocument && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-caption text-fg-muted">Title</span>
                <Input
                  data-part="inspector-title"
                  value={doc.title ?? ''}
                  onChange={(event) => patchDoc({ title: event.currentTarget.value })}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-caption text-fg-muted">Number</span>
                <Input
                  data-part="inspector-number"
                  value={doc.number ?? ''}
                  onChange={(event) => patchDoc({ number: event.currentTarget.value })}
                />
              </label>
              {canvasDocType === 'invoice' && (
                <>
                  <label className="flex flex-col gap-1">
                    <span className="text-caption text-fg-muted">Currency</span>
                    <Input
                      data-part="inspector-currency"
                      value={doc.currency ?? 'USD'}
                      onChange={(event) => patchDoc({ currency: event.currentTarget.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-caption text-fg-muted">Tax rate %</span>
                    <Input
                      data-part="inspector-tax"
                      type="number"
                      value={String(Math.round((doc.rates?.taxRate ?? 0) * 100))}
                      onChange={(event) => {
                        const pct = Number(event.currentTarget.value);
                        patchDoc({
                          rates: { ...doc.rates, taxRate: Number.isFinite(pct) ? Math.min(1, Math.max(0, pct / 100)) : 0 },
                        });
                      }}
                    />
                  </label>
                </>
              )}
              <p className="mt-2 text-caption font-bold uppercase tracking-wide text-fg-subtle">Modules</p>
              {palette.map((block) => {
                const meta = BLOCK_KIND_META[block];
                return (
                  <label key={block} className="flex cursor-pointer items-center gap-2">
                    <span className="text-fg-muted">
                      <BlockIcon slug={meta.icon} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-caption text-fg">{meta.label}</span>
                    <Switch
                      data-part="inspector-module"
                      data-block={block}
                      checked={activeBlocks.has(block)}
                      onCheckedChange={(next) => toggleBlock(block, next)}
                    />
                  </label>
                );
              })}
            </>
          )}

          {docType === 'survey' && (
            <dl data-part="survey-summary" className="flex flex-col gap-1.5 text-body-sm">
              <div className="flex items-center justify-between">
                <dt className="text-fg-muted">Questions</dt>
                <dd>
                  <MonoText data-part="summary-questions" className="font-bold text-fg">
                    {summary.questions}
                  </MonoText>
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-fg-muted">Required</dt>
                <dd>
                  <MonoText data-part="summary-required" className="font-bold text-fg">
                    {summary.required}
                  </MonoText>
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-fg-muted">Est. length</dt>
                <dd>
                  <MonoText data-part="summary-est" className="font-bold text-fg">
                    {`~${String(summary.estMinutes)} min`}
                  </MonoText>
                </dd>
              </div>
            </dl>
          )}

          {docType === 'automation' && (
            <dl data-part="flow-summary" className="flex flex-col gap-1.5 text-body-sm">
              <div className="flex items-center justify-between">
                <dt className="text-fg-muted">Steps</dt>
                <dd>
                  <MonoText data-part="summary-steps" className="font-bold text-fg">
                    {flowNodes.length}
                  </MonoText>
                </dd>
              </div>
              {(['trigger', 'condition', 'action'] as const).map((kind) => (
                <div key={kind} className="flex items-center justify-between">
                  <dt className="flex items-center gap-1.5 text-fg-muted">
                    {kind === 'trigger' ? (
                      <Zap className="size-3.5" aria-hidden="true" />
                    ) : kind === 'condition' ? (
                      <GitBranch className="size-3.5" aria-hidden="true" />
                    ) : (
                      <FileText className="size-3.5" aria-hidden="true" />
                    )}
                    {kind === 'trigger' ? 'Triggers' : kind === 'condition' ? 'Conditions' : 'Actions'}
                  </dt>
                  <dd>
                    <MonoText data-part={`summary-${kind}`} className="font-bold text-fg">
                      {flowNodes.filter((node) => node.kind === kind).length}
                    </MonoText>
                  </dd>
                </div>
              ))}
              <p className="mt-1 text-caption text-fg-subtle">The trigger step can&rsquo;t be removed.</p>
            </dl>
          )}
        </aside>
      </div>

      {/* Starter picker — `chrome.overlays: ['starter-template-picker']`. */}
      <Modal open={starterOpen} onOpenChange={setStarterOpen} size="lg">
        <ModalHeader
          title={labels?.startFromTemplate ?? 'Start from a template'}
          subtitle="Selection replaces the current draft."
          closeLabel={labels?.close ?? 'Close'}
        />
        <ModalBody>
          <div data-part="builder-starter-picker" className="min-h-64">
            <WidgetHost
              widgetId="starter-template-picker"
              instanceId={`${canvas.i}-starters`}
              config={{
                docType: canvasDocType,
                binding: BUILDER_DRAFT_BINDING,
                defs: BUILDER_STARTERS[canvasDocType].map((starter) => ({
                  id: starter.id,
                  title: starter.title,
                  category: starter.category,
                })),
              }}
              data={{ status: 'success', data: { rows: [], total: 0 } }}
              onEvent={(event) => {
                if (event.type !== 'mutate') return;
                const starterId = event.values?.['starterId'];
                applyStarter(typeof starterId === 'string' ? starterId : null);
              }}
            />
          </div>
        </ModalBody>
      </Modal>

      {/* Survey publish — LIVE counts (ia-mapping §5 fix), then the done pane. */}
      <Modal open={publishStep !== 'closed'} onOpenChange={(open) => !open && setPublishStep('closed')} size="sm">
        {publishStep === 'done' ? (
          <>
            <ModalHeader
              tone="pos"
              title="Survey published"
              subtitle="Your survey is live and collecting responses right now."
              closeLabel={labels?.close ?? 'Close'}
            />
            <ModalBody />
            <ModalFooter>
              <Button size="sm" onClick={() => setPublishStep('closed')}>
                Done
              </Button>
            </ModalFooter>
          </>
        ) : (
          <>
            <ModalHeader
              title="Publish survey?"
              subtitle="Review before it goes live."
              closeLabel={labels?.close ?? 'Close'}
            />
            <ModalBody>
              <dl data-part="publish-summary" className="flex flex-col divide-y divide-border rounded-lg border border-border">
                <div className="flex items-center justify-between px-3 py-2.5 text-body-sm">
                  <dt className="text-fg-muted">Questions</dt>
                  <dd>
                    <MonoText data-part="publish-questions" className="font-bold text-fg">
                      {summary.questions}
                    </MonoText>
                  </dd>
                </div>
                <div className="flex items-center justify-between px-3 py-2.5 text-body-sm">
                  <dt className="text-fg-muted">Required</dt>
                  <dd>
                    <MonoText data-part="publish-required" className="font-bold text-fg">
                      {summary.required}
                    </MonoText>
                  </dd>
                </div>
                <div className="flex items-center justify-between px-3 py-2.5 text-body-sm">
                  <dt className="text-fg-muted">Est. length</dt>
                  <dd>
                    <MonoText data-part="publish-est" className="font-bold text-fg">
                      {`~${String(summary.estMinutes)} min`}
                    </MonoText>
                  </dd>
                </div>
              </dl>
            </ModalBody>
            <ModalFooter>
              <Button variant="ghost" size="sm" onClick={() => setPublishStep('closed')}>
                Cancel
              </Button>
              <Button
                size="sm"
                data-part="publish-confirm"
                iconLeft={<Send aria-hidden="true" />}
                onClick={() => setPublishStep('done')}
              >
                {labels?.publish ?? 'Publish survey'}
              </Button>
            </ModalFooter>
          </>
        )}
      </Modal>
    </div>
  );
}
