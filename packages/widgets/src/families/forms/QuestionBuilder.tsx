// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `question-builder` (annex §10) — the survey editor pair: a palette rail of the
 * 8 addable question types beside reorderable question cards with type-specific
 * answer previews (radio/checkbox rows, dropdown stub, short/long text, star
 * rating, NPS 0–10 chips, date stub) and a required toggle.
 * Evidence: Survey Builder.
 *
 * PRESENTATIONAL: the question list lives in local state; every change is a
 * `mutate` intent (04 §2.1). The widget never persists a survey.
 *
 * Binds §3 `form-state` — like the other builders, an empty canvas is a builder
 * awaiting its first question, not an empty widget.
 *
 * REORDERING IS BUTTONS, NOT DRAG. `@dnd-kit` is confined to the `boards` family
 * by the chunk-budget gate (04 §2.3), so a drag layer here would ship a drag
 * engine to every page with a settings toggle. Move-up/move-down is also the
 * affordance a pointer-only drag never has: it works from the keyboard.
 */

import { EmptyState, IconTile, Input, MonoText, Switch, cn } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { ChevronDown, ChevronUp, Plus, Star, X } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import {
  DEFAULT_QUESTION_KIND_LABELS,
  questionBuilderConfigSchema,
  questionBuilderDemoData,
} from './forms-config.js';
import type { QuestionBuilderConfig } from './forms-config.js';
import { NPS_SCORES, QUESTION_KINDS, RATING_STARS, moveItem, questionTakesOptions } from './forms-builders.js';
import type { QuestionKind } from './forms-builders.js';
import { questionKindIcon } from './forms-icons.js';
import { booleanField, oneOf, stringField } from './forms-lib.js';
import { bindingTargetOf, formValuesOf } from './forms-state.js';
import type { WidgetProps } from '../../registry/types.js';

export { questionBuilderConfigSchema, questionBuilderDemoData };
export type { QuestionBuilderConfig };

export interface SurveyQuestion {
  id: string;
  kind: QuestionKind;
  q: string;
  required: boolean;
  opts: string[];
}

type Rec = Record<string, unknown>;

/**
 * Literal bundle key per question kind. Indexed rather than assembled so the
 * extractor sees all 8 and a 9th `QUESTION_KINDS` member is a compile error
 * instead of a raw `widgets.forms.questionBuilder.kind.…` in the palette
 * (10 §2.5).
 */
const KIND_KEY = {
  'single-choice': 'ui:widgets.forms.questionBuilder.kind.single-choice',
  'multi-choice': 'ui:widgets.forms.questionBuilder.kind.multi-choice',
  dropdown: 'ui:widgets.forms.questionBuilder.kind.dropdown',
  'short-text': 'ui:widgets.forms.questionBuilder.kind.short-text',
  'long-text': 'ui:widgets.forms.questionBuilder.kind.long-text',
  rating: 'ui:widgets.forms.questionBuilder.kind.rating',
  nps: 'ui:widgets.forms.questionBuilder.kind.nps',
  date: 'ui:widgets.forms.questionBuilder.kind.date',
} as const satisfies Record<QuestionKind, string>;

/** Project the §3 `form-state` payload onto survey questions. */
export function questionsOf(data: unknown, config: QuestionBuilderConfig): SurveyQuestion[] {
  const values = formValuesOf(data);
  const raw = values['questions'];
  if (!Array.isArray(raw)) return [];
  const kinds = config.kinds ?? QUESTION_KINDS;
  const out: SurveyQuestion[] = [];
  for (const [index, entry] of raw.entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const row = entry as Rec;
    const kind = oneOf(row['kind'], QUESTION_KINDS, 'short-text');
    // A question of a kind this survey disabled is dropped rather than coerced:
    // silently turning a disabled NPS question into a short-text box would
    // change what the survey asks respondents.
    if (!kinds.includes(kind)) continue;
    const opts = Array.isArray(row['opts']) ? row['opts'].filter((o): o is string => typeof o === 'string') : [];
    out.push({
      id: stringField(row, 'id') ?? `q-${index}`,
      kind,
      q: stringField(row, 'q') ?? '',
      required: booleanField(row, 'required') === true,
      opts,
    });
  }
  return out;
}

export function QuestionBuilderWidget({ config, data, onEvent }: WidgetProps<QuestionBuilderConfig>) {
  const t = useMaybeT();
  const [questions, setQuestions] = useState<SurveyQuestion[]>(() => questionsOf(data, config));
  const target = bindingTargetOf(config.binding);
  const kinds = config.kinds ?? QUESTION_KINDS;

  const commit = (next: SurveyQuestion[]) => {
    setQuestions(next);
    if (target === null) return; // unbound (demo/story/palette)
    onEvent({
      type: 'mutate',
      intent: 'update',
      connectionId: target.connectionId,
      table: target.table,
      values: {
        questions: next.map((question) => ({
          id: question.id,
          kind: question.kind,
          q: question.q,
          required: question.required,
          // Only the kinds that HAVE options carry them: an NPS question with a
          // leftover `opts` array from before a kind switch would describe a
          // scale with choices, which is not a thing.
          ...(questionTakesOptions(question.kind) ? { opts: question.opts } : {}),
        })),
      },
    });
  };

  const addQuestion = (kind: QuestionKind) => {
    if (questions.length >= config.maxQuestions) return;
    commit([
      ...questions,
      {
        id: `${kind}-${questions.length}`,
        kind,
        q: '',
        required: false,
        opts: questionTakesOptions(kind) ? ['Option 1', 'Option 2'] : [],
      },
    ]);
  };

  const patch = (index: number, partial: Partial<SurveyQuestion>) =>
    commit(questions.map((question, i) => (i === index ? { ...question, ...partial } : question)));

  const atCapacity = questions.length >= config.maxQuestions;
  const kindLabel = (kind: QuestionKind) =>
    config.kindLabels?.[kind] ?? t(KIND_KEY[kind], DEFAULT_QUESTION_KIND_LABELS[kind] ?? kind);

  return (
    <div
      data-widget="question-builder"
      data-testid={config.testId}
      className="flex h-full gap-3 overflow-hidden px-[var(--widget-pad)] pb-[var(--widget-pad)]"
    >
      {/* Palette rail (annex "palette rail 3×5"). Collapses under the canvas on
          a narrow grid cell rather than squeezing both into unusable columns. */}
      <div data-part="question-palette" className="hidden w-40 shrink-0 flex-col gap-1 overflow-auto sm:flex">
        <p className="text-caption font-bold uppercase tracking-wide text-fg-subtle">
          {config.paletteTitle ?? t('ui:widgets.forms.questionBuilder.paletteTitle', 'Add a question')}
        </p>
        {kinds.map((kind) => (
          <button
            key={kind}
            type="button"
            data-part="palette-kind"
            data-kind={kind}
            disabled={atCapacity}
            onClick={() => addQuestion(kind)}
            className={cn(
              'flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-start transition-colors duration-150',
              'hover:border-accent hover:bg-accent-soft disabled:pointer-events-none disabled:opacity-40',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            )}
          >
            <span className="text-fg-muted [&_svg]:size-3.5">{questionKindIcon(kind)}</span>
            <span className="min-w-0 truncate text-caption font-semibold text-fg">{kindLabel(kind)}</span>
          </button>
        ))}
      </div>

      {/* Canvas (annex "canvas 6×6"). */}
      <div data-part="question-canvas" className="flex min-w-0 flex-1 flex-col gap-2 overflow-auto">
        {questions.length === 0 ? (
          <EmptyState
            compact
            preset="no-data"
            title={config.emptyTitle ?? t('ui:widgets.forms.questionBuilder.emptyTitle', 'No questions yet')}
            body={config.emptyBody ?? t('ui:widgets.forms.questionBuilder.emptyBody', 'Pick a question type to start building your survey.')}
          />
        ) : (
          questions.map((question, index) => (
            <div
              key={question.id}
              data-part="question-card"
              data-kind={question.kind}
              data-question={question.id}
              data-required={question.required}
              className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 px-2.5 py-2.5"
            >
              <div className="flex items-center gap-2">
                <IconTile size="sm" tone="accent" icon={questionKindIcon(question.kind)} />
                <MonoText className="shrink-0 text-caption text-fg-subtle">{kindLabel(question.kind)}</MonoText>
                <div className="ms-auto flex items-center gap-0.5">
                  <RailButton
                    label={`${config.moveUpLabel ?? t('ui:widgets.forms.questionBuilder.moveUp', 'Move up')} — ${index + 1}`}
                    part="question-up"
                    disabled={index === 0}
                    onClick={() => commit(moveItem(questions, index, index - 1))}
                  >
                    <ChevronUp aria-hidden="true" className="size-4" />
                  </RailButton>
                  <RailButton
                    label={`${config.moveDownLabel ?? t('ui:widgets.forms.questionBuilder.moveDown', 'Move down')} — ${index + 1}`}
                    part="question-down"
                    disabled={index === questions.length - 1}
                    onClick={() => commit(moveItem(questions, index, index + 1))}
                  >
                    <ChevronDown aria-hidden="true" className="size-4" />
                  </RailButton>
                  <RailButton
                    label={`${config.removeLabel ?? t('ui:widgets.forms.questionBuilder.remove', 'Remove question')} — ${index + 1}`}
                    part="question-remove"
                    onClick={() => commit(questions.filter((_, i) => i !== index))}
                  >
                    <X aria-hidden="true" className="size-4" />
                  </RailButton>
                </div>
              </div>

              <Input
                aria-label={`${config.questionPlaceholder ?? t('ui:widgets.forms.questionBuilder.questionLabel', 'Question')} ${index + 1}`}
                data-part="question-text"
                value={question.q}
                placeholder={config.questionPlaceholder ?? t('ui:widgets.forms.questionBuilder.questionPlaceholder', 'Ask a question…')}
                onChange={(event) => patch(index, { q: event.currentTarget.value })}
              />

              <AnswerPreview kind={question.kind} opts={question.opts} />

              <label className="flex cursor-pointer items-center gap-2 self-end">
                <span className="text-caption text-fg-muted">
                  {config.requiredLabel ?? t('ui:widgets.forms.questionBuilder.required', 'Required')}
                </span>
                <Switch
                  data-part="question-required"
                  checked={question.required}
                  onCheckedChange={(next) => patch(index, { required: next })}
                />
              </label>
            </div>
          ))
        )}

        {/* The palette rail is hidden on narrow cells — this keeps the builder
            usable there instead of leaving no way to add anything. */}
        <button
          type="button"
          data-part="add-question"
          disabled={atCapacity || kinds.length === 0}
          onClick={() => {
            const first = kinds[0];
            if (first !== undefined) addQuestion(first);
          }}
          className={cn(
            'flex w-fit items-center gap-1.5 rounded-lg border border-dashed border-border-strong px-2.5 py-1.5 sm:hidden',
            'text-caption font-semibold text-fg-muted transition-colors duration-150',
            'hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-40',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          )}
        >
          <Plus aria-hidden="true" className="size-3.5" />
          {config.addLabel ?? t('ui:widgets.forms.questionBuilder.add', 'Add question')}
        </button>
      </div>
    </div>
  );
}

function RailButton({
  label,
  part,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  part: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      data-part={part}
      disabled={disabled}
      onClick={onClick}
      className={
        'rounded-md p-1 text-fg-subtle transition-colors duration-150 hover:bg-surface-3 hover:text-fg ' +
        'disabled:pointer-events-none disabled:opacity-30 ' +
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
      }
    >
      {children}
    </button>
  );
}

/**
 * The type-specific answer preview (annex §10). Inert by design: these are the
 * SHAPES the respondent will see, rendered for the author to recognise — a
 * working radio group here would invite the author to "answer" their own draft.
 */
function AnswerPreview({ kind, opts }: { kind: QuestionKind; opts: readonly string[] }) {
  const t = useMaybeT();
  if (kind === 'single-choice' || kind === 'multi-choice') {
    return (
      <ul aria-hidden="true" data-part="answer-preview" data-kind={kind} className="m-0 flex list-none flex-col gap-1 p-0">
        {opts.map((option, index) => (
          <li key={`${option}-${index}`} className="flex items-center gap-2 text-caption text-fg-muted">
            <span
              className={cn(
                'size-3.5 shrink-0 border border-border-strong',
                kind === 'single-choice' ? 'rounded-full' : 'rounded-xs',
              )}
            />
            {option}
          </li>
        ))}
      </ul>
    );
  }
  if (kind === 'dropdown') {
    return (
      <div
        aria-hidden="true"
        data-part="answer-preview"
        data-kind={kind}
        className="flex h-8 items-center justify-between rounded-md border border-border-strong bg-surface px-2 text-caption text-fg-subtle"
      >
        {opts[0] ?? t('ui:widgets.forms.questionBuilder.dropdownPlaceholder', 'Choose…')}
        <ChevronDown className="size-3.5" />
      </div>
    );
  }
  if (kind === 'rating') {
    return (
      <div aria-hidden="true" data-part="answer-preview" data-kind={kind} className="flex gap-1">
        {Array.from({ length: RATING_STARS }, (_, index) => (
          <Star key={index} className="size-4 text-fg-subtle" />
        ))}
      </div>
    );
  }
  if (kind === 'nps') {
    return (
      <div aria-hidden="true" data-part="answer-preview" data-kind={kind} className="flex flex-wrap gap-1">
        {NPS_SCORES.map((score) => (
          <MonoText
            key={score}
            className="rounded-sm border border-border-strong px-1.5 py-0.5 text-caption text-fg-subtle"
          >
            {score}
          </MonoText>
        ))}
      </div>
    );
  }
  return (
    <div
      aria-hidden="true"
      data-part="answer-preview"
      data-kind={kind}
      className={cn(
        'rounded-md border border-border-strong bg-surface',
        kind === 'long-text' ? 'h-12' : 'h-8',
      )}
    />
  );
}
