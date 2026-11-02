// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One question of a form, drawn by its kind: its label (with Required or
 * Optional beside it), its help, its control and, after a Send, its error.
 *
 * Every control is named by its label and described by its help and its
 * error (the error only while it is shown). A choice of one, the score and
 * the stars are radio groups; the score's chips and the stars move with the
 * arrow keys (flipped right to left), Home and End, with one tab stop.
 */
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useT } from '@adminium/i18n/react';
import { CircleAlert, Star } from 'lucide-react';
import type { FormQuestion, FormQuestionOf } from '@adminium/add-on-contracts/forms';

import type { Held } from './answers.js';
import { FileField, type FileRow } from './Files.js';

export interface QuestionProps {
  question: FormQuestion;
  value: Held;
  /** The refusal to show under it, in words; null while there is none. */
  error: string | null;
  /** The page's language tag, and the language it reads from right to left. */
  tag: string;
  rtl: boolean;
  /** The day a date question's earliest counts from (`yyyy-mm-dd`, the business's). */
  today: string;
  onChange: (value: Held) => void;
  /** A file question's rows, and what picking and removing a file does (the page sends each file as it is picked). */
  files?: { rows: readonly FileRow[]; onPick: (files: File[]) => void; onRemove: (key: string) => void } | undefined;
}

/** The owner's words for this question, in the page's one language. */
export const textOf = (words: Partial<Record<string, string>> | undefined, tag: string): string => (words === undefined ? '' : (words[tag] ?? Object.values(words)[0] ?? ''));

/** The day after a `yyyy-mm-dd`. */
function nextDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
}

/** The id a question's control carries: what the error summary and focus after Send move to. */
export const controlId = (questionId: string): string => `x-q-${questionId}`;

function Mark({ required }: { required: boolean }): ReactNode {
  const t = useT();
  return <span className="x-mark">{required ? t('x:required', 'Required') : t('x:optional', 'Optional')}</span>;
}

function Problem({ id, text }: { id: string; text: string }): ReactNode {
  return (
    <p id={id} className="x-error">
      <CircleAlert className="x-icon" size={14} strokeWidth={2} aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}

/**
 * A radio group whose options move with the arrow keys and Home/End, with
 * one tab stop (the picked option, else the first). Arrows pick as they move,
 * as a radio group's do; left and right swap in a right-to-left page.
 */
function RovingGroup<V extends number>(props: {
  options: readonly V[];
  value: V | undefined;
  rtl: boolean;
  onPick: (value: V) => void;
  render: (value: V, picked: boolean, tabbable: boolean, onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void, ref: (element: HTMLButtonElement | null) => void) => ReactNode;
}): ReactNode {
  const refs = useRef(new Map<V, HTMLButtonElement>());
  const at = props.value === undefined ? -1 : props.options.indexOf(props.value);
  const move = (index: number): void => {
    const next = props.options[(index + props.options.length) % props.options.length]!;
    props.onPick(next);
    refs.current.get(next)?.focus();
  };
  return props.options.map((option, index) => {
    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
      const forward = props.rtl ? 'ArrowLeft' : 'ArrowRight';
      const back = props.rtl ? 'ArrowRight' : 'ArrowLeft';
      if (event.key === forward || event.key === 'ArrowDown') move(index + 1);
      else if (event.key === back || event.key === 'ArrowUp') move(index - 1);
      else if (event.key === 'Home') move(0);
      else if (event.key === 'End') move(props.options.length - 1);
      else return;
      event.preventDefault();
    };
    const ref = (element: HTMLButtonElement | null): void => {
      if (element === null) refs.current.delete(option);
      else refs.current.set(option, element);
    };
    return props.render(option, option === props.value, at === -1 ? index === 0 : index === at, onKeyDown, ref);
  });
}

const SCORES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
const STARS = [1, 2, 3, 4, 5] as const;

export function Question(props: QuestionProps): ReactNode {
  const t = useT();
  const { question, value, error, tag, onChange } = props;
  const base = useId();
  const id = controlId(question.id);
  const labelId = `${base}-label`;
  const helpId = `${base}-help`;
  const errorId = `${base}-error`;
  const label = textOf(question.label, tag);
  const help = question.help === undefined ? '' : textOf(question.help, tag);
  const describedBy = [help === '' ? null : helpId, error === null ? null : errorId].filter((one): one is string => one !== null).join(' ') || undefined;
  const invalid = error === null ? undefined : true;
  const helpLine = help === '' ? null : (
    <p id={helpId} className="x-help">
      {help}
    </p>
  );
  const problem = error === null ? null : <Problem id={errorId} text={error} />;
  const head = (as: 'label' | 'legend' | 'span'): ReactNode => {
    const inner = (
      <>
        <span className="x-label-text">{label}</span>
        {question.kind === 'tick' ? null : <Mark required={question.required} />}
      </>
    );
    if (as === 'label') {
      return (
        <label id={labelId} htmlFor={id} className="x-label">
          {inner}
        </label>
      );
    }
    if (as === 'legend') {
      return (
        <legend id={labelId} className="x-label">
          {inner}
        </legend>
      );
    }
    return (
      <span id={labelId} className="x-label">
        {inner}
      </span>
    );
  };

  switch (question.kind) {
    case 'short':
    case 'long': {
      const ltr = question.kind === 'short' && question.check !== undefined;
      const common = {
        id,
        value: typeof value === 'string' ? value : '',
        onChange: (event: { target: { value: string } }) => onChange(event.target.value),
        'aria-required': question.required || undefined,
        'aria-invalid': invalid,
        'aria-describedby': describedBy,
        maxLength: question.maxLength,
      };
      return (
        <div className="x-field" data-kind={question.kind}>
          {head('label')}
          {helpLine}
          {question.kind === 'long' ? (
            <textarea className="x-input x-textarea" rows={4} {...common} />
          ) : (
            <input
              className={ltr ? 'x-input x-mono' : 'x-input'}
              type={question.check === 'email' ? 'email' : question.check === 'phone' ? 'tel' : 'text'}
              autoComplete={question.role === 'name' ? 'name' : question.role === 'email' ? 'email' : question.role === 'company' ? 'organization' : question.check === 'phone' ? 'tel' : 'off'}
              dir={ltr ? 'ltr' : undefined}
              {...common}
            />
          )}
          {problem}
        </div>
      );
    }
    case 'date': {
      const min = question.from === 'today' ? props.today : question.from === 'tomorrow' ? nextDay(props.today) : undefined;
      return (
        <div className="x-field" data-kind="date">
          {head('label')}
          {helpLine}
          <input
            id={id}
            className="x-input x-mono"
            type="date"
            dir="ltr"
            // Latin digits in every language: a day is written as the business reads it back.
            lang={`${tag}-u-nu-latn`}
            min={min}
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => onChange(event.target.value)}
            aria-required={question.required || undefined}
            aria-invalid={invalid}
            aria-describedby={describedBy}
          />
          {problem}
        </div>
      );
    }
    case 'number':
      return (
        <div className="x-field" data-kind="number">
          {head('label')}
          {helpLine}
          <input
            id={id}
            className="x-input x-mono x-number"
            type="text"
            inputMode={question.whole === true ? 'numeric' : 'decimal'}
            dir="ltr"
            maxLength={16}
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => onChange(event.target.value)}
            aria-required={question.required || undefined}
            aria-invalid={invalid}
            aria-describedby={describedBy}
          />
          {problem}
        </div>
      );
    case 'one':
    case 'several': {
      const picks = question.kind === 'several' ? (Array.isArray(value) ? value : []) : [];
      return (
        <fieldset className="x-field x-group" data-kind={question.kind} aria-describedby={describedBy}>
          {head('legend')}
          {helpLine}
          <div className="x-choices">
            {(question as FormQuestionOf<'one' | 'several'>).choices.map((choice, index) => {
              const checked = question.kind === 'one' ? value === choice.id : picks.includes(choice.id);
              return (
                <label key={choice.id} className="x-choice">
                  <input
                    id={index === 0 ? id : undefined}
                    type={question.kind === 'one' ? 'radio' : 'checkbox'}
                    name={id}
                    value={choice.id}
                    checked={checked}
                    onChange={() => {
                      if (question.kind === 'one') onChange(choice.id);
                      else onChange(checked ? picks.filter((pick) => pick !== choice.id) : [...picks, choice.id]);
                    }}
                  />
                  <span>{textOf(choice.label, tag)}</span>
                </label>
              );
            })}
          </div>
          {problem}
        </fieldset>
      );
    }
    case 'score': {
      const endsId = `${base}-ends`;
      return (
        <div className="x-field" data-kind="score">
          {head('span')}
          {helpLine}
          <p id={endsId} className="x-sr">
            {t('x:score.ends', '0 is not likely, 10 is very likely.')}
          </p>
          <div
            role="radiogroup"
            aria-labelledby={labelId}
            aria-describedby={[endsId, describedBy].filter(Boolean).join(' ')}
            aria-required={question.required || undefined}
            aria-invalid={invalid}
            className="x-scores"
          >
            <RovingGroup
              options={SCORES}
              value={typeof value === 'number' ? (value as (typeof SCORES)[number]) : undefined}
              rtl={props.rtl}
              onPick={onChange}
              render={(score, picked, tabbable, onKeyDown, ref) => (
                <button
                  key={score}
                  ref={ref}
                  id={score === 0 ? id : undefined}
                  type="button"
                  role="radio"
                  aria-checked={picked}
                  tabIndex={tabbable ? 0 : -1}
                  className="x-score"
                  onClick={() => onChange(score)}
                  onKeyDown={onKeyDown}
                >
                  {score}
                </button>
              )}
            />
          </div>
          <div className="x-score-ends" aria-hidden="true">
            <span>
              <bdi dir="ltr">0</bdi> · {t('x:score.low', 'Not likely')}
            </span>
            <span>
              {t('x:score.high', 'Very likely')} · <bdi dir="ltr">10</bdi>
            </span>
          </div>
          {problem}
        </div>
      );
    }
    case 'stars': {
      const picked = typeof value === 'number' ? value : 0;
      return (
        <div className="x-field" data-kind="stars">
          {head('span')}
          {helpLine}
          <div className="x-stars-row">
            <div role="radiogroup" aria-labelledby={labelId} aria-describedby={describedBy} aria-required={question.required || undefined} aria-invalid={invalid} className="x-stars">
              <RovingGroup
                options={STARS}
                value={picked === 0 ? undefined : (picked as (typeof STARS)[number])}
                rtl={props.rtl}
                onPick={onChange}
                render={(n, isPicked, tabbable, onKeyDown, ref) => (
                  <button
                    key={n}
                    ref={ref}
                    id={n === 1 ? id : undefined}
                    type="button"
                    role="radio"
                    aria-checked={isPicked}
                    aria-label={t('x:stars.star', '{n, plural, one {# star} other {# stars}}', { n })}
                    tabIndex={tabbable ? 0 : -1}
                    className="x-star"
                    data-on={n <= picked ? '' : undefined}
                    onClick={() => onChange(n)}
                    onKeyDown={onKeyDown}
                  >
                    <Star className="x-icon" size={26} strokeWidth={2} aria-hidden="true" />
                  </button>
                )}
              />
            </div>
            {picked === 0 ? null : (
              <span className="x-star-caption" aria-hidden="true">
                {t('x:stars.of', '{n} of 5', { n: picked })}
              </span>
            )}
          </div>
          {problem}
        </div>
      );
    }
    case 'file': {
      const names: Readonly<Record<string, string>> = {
        pdf: t('x:file.kind.pdf', 'PDF'),
        jpg: t('x:file.kind.jpg', 'JPG'),
        png: t('x:file.kind.png', 'PNG'),
        text: t('x:file.kind.text', 'plain text'),
      };
      const kinds = question.kinds.map((kind) => names[kind] ?? kind);
      const list = typeof Intl.ListFormat === 'function' ? new Intl.ListFormat(tag, { type: 'disjunction' }).format(kinds) : kinds.join(', ');
      const hintId = `${base}-hint`;
      return (
        <div className="x-field" data-kind="file">
          {head('span')}
          {helpLine}
          <p id={hintId} className="x-hint">
            {t('x:file.hint', '{kinds}, up to {mb} MB', { kinds: list, mb: question.maxMb })}
          </p>
          <FileField
            question={question}
            rows={props.files?.rows ?? []}
            tag={tag}
            kinds={list}
            labelId={labelId}
            describedBy={[hintId, describedBy].filter(Boolean).join(' ')}
            onPick={(files) => props.files?.onPick(files)}
            onRemove={(key) => props.files?.onRemove(key)}
          />
          {problem}
        </div>
      );
    }
    case 'tick':
      return (
        <div className="x-field x-tick" data-kind="tick">
          <div className="x-tick-row">
            <input
              id={id}
              type="checkbox"
              checked={value === true}
              onChange={(event) => onChange(event.target.checked)}
              aria-invalid={invalid}
              aria-describedby={describedBy}
            />
            <label id={labelId} htmlFor={id} className="x-tick-label">
              {label}
            </label>
          </div>
          {helpLine}
          {problem}
        </div>
      );
    case 'hidden':
      return null;
  }
}
