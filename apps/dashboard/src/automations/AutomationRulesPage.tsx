// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/automations` — the rule list and the flow builder.
 *
 * The comp's layout: four KPIs, then a `360px minmax(0,1fr)` grid with the
 * filtered rule cards on the left and the selected rule's flow on the right
 * (comp 208). What this page owns beyond the markup is the two behaviours
 * the comp does not have.
 *
 * --- D11: an explicit draft, and an explicit save -------------------------
 *
 * The comp writes state on every keystroke. The owner ruled explicit save for
 * every authored document, so the flow on screen is a DRAFT: every insert,
 * move, rename and inspector edit changes it and nothing else, the save chip
 * says so, ⌘S saves, and navigating away while dirty asks first.
 *
 * The two exceptions are the comp's own: the Active/Paused toggle and Test
 * act on the graph in front of the person, so neither needs a save first —
 * Test posts the on-screen document (D14) and the toggle is about the RULE,
 * not the draft.
 *
 * --- D12: a rule enables only when it validates ---------------------------
 *
 * The card's toggle is optimistic; a `422 AUTOMATION_INCOMPLETE` snaps it
 * back, toasts the step's name and opens the inspector on it. The client
 * knows the same rule (`model/validate.ts`) so it can usually say so before
 * asking, but the server is the authority and this is the path that handles
 * being wrong.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker, useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Button, ConfirmModal } from '@adminium/ui';

import { t } from '../i18n/t.js';
import { PageActions } from '../shell/PageActionsProvider.js';
import { PageSurface } from '../shell/PageSurface.js';
import { useAppToasts } from '../pages/toasts.js';
import { automationIcon } from './icons.js';
import { automationsApi, tableForTrigger, type RuleView, type SourceTable } from './api.js';
import { invalidateRules, rulesQuery, rulesStatsQuery, sourcesQuery } from './queries.js';
import { FlowBuilder } from './flow/FlowBuilder.js';
import { StepInspector } from './flow/StepInspector.js';
import { StepPicker } from './flow/StepPicker.js';
import { useTestRun } from './flow/useTestRun.js';
import { NewRuleModal } from './rules/NewRuleModal.js';
import { FlowHeader, RuleCard, RulesEmpty, RulesKpiStrip, type RulesKpi } from './rules/parts.js';
import { FilterPills } from './logs/parts.js';
import { countSteps, locate, type Condition, type Graph, type Trigger } from './model/graph.js';
import type { Action, FlowNode } from './model/graph.js';
import {
  insert,
  moveIntoBranch,
  moveTo,
  move as moveNode,
  patchAction,
  patchBranchLabel,
  patchCondition,
  patchNode,
  remove,
  duplicate as duplicateNode,
  toggleOnError,
  type InsertTarget,
  type StepDefinition,
} from './model/ops.js';
import { firstIncompleteNode } from './model/validate.js';
import { subLineFor, triggerSentence } from './model/summaries.js';

const FILTER_KEYS = ['all', 'active', 'paused'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

const FILTER_LABELS: Record<FilterKey, { key: string; fallback: string }> = {
  all: { key: 'automations:filter.all', fallback: 'All' },
  active: { key: 'automations:filter.active', fallback: 'Active' },
  paused: { key: 'automations:filter.paused', fallback: 'Paused' },
};

function percent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

/** `182h` / `45m` — the comp's ROI value, only when somebody typed minutes. */
function formatSaved(minutes: number): string | null {
  if (minutes <= 0) return null;
  return minutes >= 60
    ? t('automations:saved.h', '{h}h', { h: Math.round(minutes / 60) })
    : t('automations:saved.m', '{m}m', { m: minutes });
}

function deltaPercent(now: number, before: number): string | null {
  // FILL F7 — no previous period means no pill, not "+100%".
  if (before === 0) return null;
  const change = Math.round(((now - before) / before) * 100);
  return `${change >= 0 ? '+' : ''}${String(change)}%`;
}

export function AutomationRulesPage(): ReactNode {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toasts = useAppToasts();
  const toastSuccess = (title: string): void => {
    toasts.push({ variant: 'success', title });
  };
  const toastError = (title: string): void => {
    toasts.push({ variant: 'error', title });
  };
  const search = useSearch({ strict: false }) as { rule?: string };

  const rules = useQuery(rulesQuery());
  const stats = useQuery(rulesStatsQuery());
  const sources = useQuery(sourcesQuery());

  const [filter, setFilter] = useState<FilterKey>('all');
  const [draft, setDraft] = useState<{ id: string; graph: Graph; trigger: Trigger } | null>(null);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [pickerTarget, setPickerTarget] = useState<InsertTarget | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<RuleView | null>(null);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const test = useTestRun();

  const all = rules.data?.rules ?? [];
  const selected = all.find((rule) => rule.id === search.rule) ?? all[0] ?? null;
  const dirty = draft !== null && selected !== null && draft.id === selected.id;
  const graph: Graph | null = dirty ? draft.graph : (selected?.graph ?? null);
  const trigger: Trigger | null = dirty ? draft.trigger : (selected?.trigger ?? null);

  const table: SourceTable | null = useMemo(
    () => tableForTrigger(sources.data ?? null, trigger),
    [trigger, sources.data],
  );

  // --- draft plumbing (D11) -------------------------------------------------

  const edit = useCallback(
    (next: { graph?: Graph; trigger?: Trigger }) => {
      if (selected === null) return;
      setDraft((current) => {
        const base =
          current !== null && current.id === selected.id
            ? current
            : { id: selected.id, graph: selected.graph, trigger: selected.trigger };
        return { ...base, ...next };
      });
    },
    [selected],
  );

  const save = useMutation({
    mutationFn: async () => {
      if (draft === null) throw new Error('nothing to save');
      return automationsApi.patch(draft.id, { graph: draft.graph, trigger: draft.trigger });
    },
    onSuccess: async () => {
      setDraft(null);
      toastSuccess(t('automations:toast.saved', 'Rule saved'));
      await invalidateRules(queryClient);
    },
    onError: (error: Error) => {
      toastError(t('automations:toast.failed', 'That did not save — {reason}', { reason: error.message }));
    },
  });

  // A rule the person is halfway through editing must not vanish under them.
  useBlocker({
    shouldBlockFn: () => dirty && !save.isPending,
    withResolver: true,
  });

  const toggle = useMutation({
    mutationFn: (rule: RuleView) => automationsApi.patch(rule.id, { enabled: !rule.enabled }),
    onSuccess: async (updated) => {
      toastSuccess(
        updated.enabled
          ? t('automations:toast.enabled', '{name} is on', { name: updated.name })
          : t('automations:toast.paused', '{name} is paused', { name: updated.name }),
      );
      await invalidateRules(queryClient);
    },
    onError: (error: Error & { details?: { nodeId?: string; nodeTitle?: string } }) => {
      // D12 — the 422 names the step; open the inspector on it.
      const nodeTitle = error.details?.nodeTitle;
      const nodeId = error.details?.nodeId;
      toastError(
        t('automations:toast.incomplete', 'Finish “{step}” before switching this rule on', {
          step: nodeTitle ?? '',
        }),
      );
      if (nodeId !== undefined) setInspectId(nodeId);
    },
  });

  const duplicate = useMutation({
    mutationFn: (rule: RuleView) => automationsApi.duplicate(rule.id),
    onSuccess: async (copy) => {
      toastSuccess(t('automations:toast.duplicated', '{name} duplicated', { name: copy.name }));
      await invalidateRules(queryClient);
    },
  });

  const destroy = useMutation({
    mutationFn: (rule: RuleView) => automationsApi.remove(rule.id),
    onSuccess: async (_result, rule) => {
      toastSuccess(t('automations:toast.deleted', '{name} deleted', { name: rule.name }));
      setConfirmDelete(null);
      setDraft(null);
      await invalidateRules(queryClient);
    },
  });

  const runTest = useMutation({
    mutationFn: async () => {
      if (selected === null || graph === null || trigger === null) throw new Error('no rule');
      return automationsApi.test(selected.id, { trigger, graph });
    },
    onSuccess: (result) => {
      setInspectId(null);
      test.play(result.trace);
    },
    onError: (error: Error & { code?: string }) => {
      toastError(
        error.code === 'NO_SAMPLE_RECORD'
          ? t('automations:flow.noSample', 'No record to test with — add one first')
          : error.message,
      );
    },
  });

  // --- the KPI strip (D22) --------------------------------------------------

  const kpis: RulesKpi[] = [
    {
      icon: 'workflow',
      label: t('automations:kpi.activeRules', 'Active rules'),
      value: String(stats.data?.activeRules ?? 0),
      delta: (stats.data?.rulesCreated7d ?? 0) > 0 ? `+${String(stats.data?.rulesCreated7d ?? 0)}` : null,
      up: true,
    },
    {
      icon: 'zap',
      label: t('automations:kpi.runsToday', 'Runs today'),
      value: String(stats.data?.runsToday ?? 0),
      delta: deltaPercent(stats.data?.runsToday ?? 0, stats.data?.runsYesterday ?? 0),
      up: (stats.data?.runsToday ?? 0) >= (stats.data?.runsYesterday ?? 0),
    },
    {
      icon: 'circle-check-big',
      label: t('automations:kpi.successRate', 'Success rate'),
      value: percent(stats.data?.successToday ?? null),
      delta:
        stats.data?.successYesterday == null || stats.data.successToday == null
          ? null
          : `${((stats.data.successToday - stats.data.successYesterday) * 100).toFixed(1)}%`,
      up: (stats.data?.successToday ?? 0) >= (stats.data?.successYesterday ?? 0),
    },
    {
      icon: 'clock',
      label: t('automations:kpi.timeSaved', 'Time saved (mo)'),
      value: formatSaved(stats.data?.timeSavedMinutes30d ?? 0) ?? '—',
      delta: deltaPercent(
        stats.data?.timeSavedMinutes30d ?? 0,
        stats.data?.timeSavedMinutesPrev30d ?? 0,
      ),
      up: true,
    },
  ];

  const visible = all.filter(
    (rule) => filter === 'all' || (filter === 'active' ? rule.enabled : !rule.enabled),
  );
  const inspectNode: FlowNode | null =
    graph === null || inspectId === null ? null : (locate(graph, inspectId)?.node ?? null);
  const incomplete = graph === null ? null : firstIncompleteNode(graph);
  const Plus = automationIcon('plus');

  const selectRule = (id: string): void => {
    const go = (): void => {
      setDraft(null);
      setInspectId(null);
      setPickerTarget(null);
      void navigate({ to: '.', search: (prev: Record<string, unknown>) => ({ ...prev, rule: id }) });
    };
    // Selecting another rule while dirty asks first (D11).
    if (dirty) setPendingLeave(() => go);
    else go();
  };

  return (
    <PageSurface width="wide" className="mx-auto flex w-full max-w-[1240px] flex-col gap-[18px]">
      <PageActions
        title={t('automations:rules.title', 'Automation rules')}
        subtitle={t('automations:rules.subtitle', 'Trigger workflows automatically when things happen.')}
      >
        <Button
          onClick={() => {
            setNewOpen(true);
          }}
          data-testid="new-rule"
        >
          <Plus aria-hidden className="size-4" />
          {t('automations:rules.new', 'New rule')}
        </Button>
      </PageActions>

      {/* ⌘S saves the draft (D11). On the surface's own subtree rather than a
          document listener: a shortcut that fires while somebody is typing in
          another page's field is a shortcut nobody asked for. */}
      <div
        role="presentation"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 's' && dirty) {
            event.preventDefault();
            save.mutate();
          }
        }}
        className="contents"
      >
        <RulesKpiStrip kpis={kpis} />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 min-[1080px]:grid-cols-[360px_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <FilterPills
            label={t('automations:rules.title', 'Automation rules')}
            active={filter}
            pills={FILTER_KEYS.map((key) => ({
              key,
              label: t(FILTER_LABELS[key].key, FILTER_LABELS[key].fallback),
              count:
                key === 'all'
                  ? all.length
                  : all.filter((rule) => (key === 'active' ? rule.enabled : !rule.enabled)).length,
            }))}
            onSelect={setFilter}
          />
          {visible.length === 0 ? (
            <RulesEmpty />
          ) : (
            visible.map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                selected={rule.id === selected?.id}
                triggerLine={triggerSentence(rule.trigger)}
                now={Date.now()}
                onSelect={() => {
                  selectRule(rule.id);
                }}
                onToggle={() => {
                  toggle.mutate(rule);
                }}
              />
            ))
          )}
        </div>

        {selected === null || graph === null || trigger === null ? (
          <div className="rounded-2xl border border-border bg-surface p-10 text-center text-[13px] text-fg-subtle">
            {t('automations:rules.none', 'Select a rule to see its flow')}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
            <FlowHeader
              rule={selected}
              stepCount={countSteps(graph.nodes)}
              timeSaved={selected.timeSavedMinutes === null ? null : formatSaved(selected.timeSavedMinutes)}
              dirty={dirty}
              saving={save.isPending}
              saveError={save.error?.message ?? null}
              testing={test.testing || runTest.isPending}
              onSave={() => {
                save.mutate();
              }}
              onTest={() => {
                runTest.mutate();
              }}
              onRename={() => {
                const name = window.prompt(t('automations:menu.rename', 'Rename'), selected.name);
                if (name !== null && name.trim() !== '') {
                  void automationsApi
                    .patch(selected.id, { name: name.trim() })
                    .then(() => invalidateRules(queryClient));
                }
              }}
              onDuplicate={() => {
                duplicate.mutate(selected);
              }}
              onDelete={() => {
                setConfirmDelete(selected);
              }}
            />
            <FlowBuilder
              graph={graph}
              selectedId={inspectId}
              runningId={test.runningId}
              ranIds={test.ranIds}
              incompleteId={incomplete?.id ?? null}
              subFor={(node) => subLineFor(node, table)}
              onSelect={setInspectId}
              onRemove={(id) => {
                edit({ graph: remove(graph, id) });
                if (inspectId === id) setInspectId(null);
              }}
              onInsert={setPickerTarget}
              onMoveTo={(dragId, targetId) => {
                edit({ graph: moveTo(graph, dragId, targetId) });
              }}
              onMoveIntoBranch={(dragId, branchId) => {
                edit({ graph: moveIntoBranch(graph, dragId, branchId) });
              }}
            />
          </div>
        )}
      </div>

      <StepPicker
        target={pickerTarget}
        contextLine={pickerContext(pickerTarget, graph)}
        onClose={() => {
          setPickerTarget(null);
        }}
        onPick={(definition: StepDefinition) => {
          if (graph === null || pickerTarget === null) return;
          const result = insert(graph, pickerTarget, definition);
          edit({ graph: result.graph });
          setPickerTarget(null);
          setInspectId(result.nodeId);
        }}
      />

      <StepInspector
        node={inspectNode}
        trigger={trigger ?? { kind: 'schedule', connectionId: null, schedule: { kind: 'interval', everyMinutes: '15' } }}
        sources={sources.data ?? null}
        table={table}
        onClose={() => {
          setInspectId(null);
        }}
        onTitle={(title) => {
          if (graph !== null && inspectId !== null) edit({ graph: patchNode(graph, inspectId, { title }) });
        }}
        onSub={(sub) => {
          if (graph !== null && inspectId !== null) edit({ graph: patchNode(graph, inspectId, { sub }) });
        }}
        onCondition={(condition: Condition) => {
          if (graph !== null && inspectId !== null) edit({ graph: patchCondition(graph, inspectId, condition) });
        }}
        onBranchLabel={(index, label) => {
          if (graph !== null && inspectId !== null) {
            edit({ graph: patchBranchLabel(graph, inspectId, index, label) });
          }
        }}
        onToggleError={() => {
          if (graph !== null && inspectId !== null) edit({ graph: toggleOnError(graph, inspectId) });
        }}
        onAction={(patch: Partial<Action>) => {
          if (graph !== null && inspectId !== null) edit({ graph: patchAction(graph, inspectId, patch) });
        }}
        onTrigger={(next) => {
          edit({ trigger: next });
        }}
        onWait={(patch) => {
          if (graph !== null && inspectId !== null) {
            edit({ graph: patchNode(graph, inspectId, patch as Partial<FlowNode>) });
          }
        }}
        onMove={(direction) => {
          if (graph !== null && inspectId !== null) edit({ graph: moveNode(graph, inspectId, direction) });
        }}
        onDuplicate={() => {
          if (graph === null || inspectId === null) return;
          const result = duplicateNode(graph, inspectId);
          edit({ graph: result.graph });
          setInspectId(result.nodeId);
        }}
        onDelete={() => {
          if (graph === null || inspectId === null) return;
          edit({ graph: remove(graph, inspectId) });
          setInspectId(null);
        }}
      />

      <NewRuleModal
        open={newOpen}
        sources={sources.data ?? null}
        onClose={() => {
          setNewOpen(false);
        }}
        onCreate={async (input) => {
          const created = await automationsApi.create({
            name: input.name,
            connectionId:
              input.trigger.kind === 'record' ? input.trigger.connectionId : input.trigger.connectionId,
            trigger: input.trigger,
            graph: input.graph,
            enabled: input.enabled,
          });
          await invalidateRules(queryClient);
          void navigate({
            to: '.',
            search: (prev: Record<string, unknown>) => ({ ...prev, rule: created.id }),
          });
          // Done opens the inspector on the action that still needs setting up.
          setInspectId(created.incompleteNodeId);
          return { enabled: created.enabled };
        }}
        onDone={() => {
          setNewOpen(false);
        }}
      />

      {confirmDelete === null ? null : (
        <ConfirmModal
          open
          onOpenChange={(open) => {
            if (!open) setConfirmDelete(null);
          }}
          title={t('automations:delete.title', 'Delete {name}?', { name: confirmDelete.name })}
          body={t('automations:delete.body', 'Its run history goes with it. This cannot be undone.')}
          confirmLabel={t('automations:delete.confirm', 'Delete')}
          cancelLabel={t('automations:delete.cancel', 'Cancel')}
          closeLabel={t('automations:picker.close', 'Close')}
          confirmWord={confirmDelete.name}
          promptLabel={t('automations:delete.title', 'Delete {name}?', { name: confirmDelete.name })}
          onConfirm={() => {
            destroy.mutate(confirmDelete);
          }}
        />
      )}

      {pendingLeave === null ? null : (
        <ConfirmModal
          open
          onOpenChange={(open) => {
            if (!open) setPendingLeave(null);
          }}
          title={t('automations:guard.title', 'Leave without saving?')}
          body={t('automations:guard.body', 'Your changes to this rule will be lost.')}
          confirmLabel={t('automations:guard.leave', 'Leave')}
          cancelLabel={t('automations:guard.stay', 'Keep editing')}
          closeLabel={t('automations:picker.close', 'Close')}
          // Leaving an unsaved draft is not destructive enough to make somebody
          // type a word: the empty confirmWord leaves the danger button live.
          confirmWord=""
          promptLabel=""
          onConfirm={() => {
            const go = pendingLeave;
            setPendingLeave(null);
            go();
          }}
        />
      )}
    </PageSurface>
  );
}

/** The picker's context line — the comp's three sentences (564-568). */
function pickerContext(target: InsertTarget | null, graph: Graph | null): string {
  if (target === null || graph === null) return '';
  if (target.branchId !== undefined) {
    for (const node of graph.nodes) {
      if (node.kind !== 'branch') continue;
      for (const branch of node.branches) {
        if (branch.id === target.branchId) {
          return t('automations:picker.inBranch', 'Inside branch · {label}', { label: branch.label });
        }
      }
    }
  }
  if (target.index >= graph.nodes.length) {
    return t('automations:picker.end', 'At the end of the flow');
  }
  return t('automations:picker.before', 'Before · {title}', {
    title: graph.nodes[target.index]?.title ?? '',
  });
}
