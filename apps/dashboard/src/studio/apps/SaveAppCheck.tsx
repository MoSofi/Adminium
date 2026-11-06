// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SAVE AS APP, step 4: Check (`Save As App.dc.html` boards 3d, 3d-june, 5).
 *
 * What the file holds and what needs the person first, in four groups:
 *
 *  - **Blocks saving**: a refusal of the file (the server's own words, with a
 *    way back to What to include) and a secret this server holds, found in
 *    what is going in. A secret is named by kind, item and field, never by
 *    value, and offers "Clear this field" or "Leave it out".
 *  - **Needs a choice**: every other question, each with the answers the
 *    server offers; the personal views as one block of switches, the same
 *    control as What to include's ticks, all off at first ("0 of N").
 *  - **After you install** and **For your information**.
 *
 * An answer is recorded as the item says, and the plan is asked again; the
 * answered item stays in its place with what the file will hold and "Undo",
 * and focus moves to that Undo. Save stays off until the server says the
 * file can be made, and the footer says what holds it.
 *
 * Departure: a warning that only LOOKS like a key holds Save until it is
 * answered, because the server refuses a save while any question is open
 * (the comp lets Save through with it). Its answers are the server's: clear
 * it, or say it is not a key.
 */
import { Bookmark, Check, CircleHelp, Info, KeyRound, OctagonX, ShieldAlert, TriangleAlert, Type } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, MonoText, Spinner, Switch, cn } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { SaveFlowShared } from './saveAppShared.js';
import type { AnswerChoice, CheckItem } from './saveAppApi.js';
import { groupCheck, itemId, needsCount, personalViews, type SaveDraft } from './saveAppDraft.js';
import { answerLabel, answeredSentence, checkSentence, groupedAfter, groupedInfo } from './saveAppWords.js';

type Tone = 'danger' | 'warn' | 'info' | 'neutral';

const TONE_TEXT: Record<Tone, string> = { danger: 'text-danger', warn: 'text-warn', info: 'text-info', neutral: 'text-fg-muted' };
const TONE_SOFT: Record<Tone, string> = { danger: 'bg-danger-soft text-danger', warn: 'bg-warn-soft text-warn', info: 'bg-info-soft text-info', neutral: 'bg-surface-3 text-fg-muted' };

/** What holds Save, for the footer; null when nothing does. */
export function checkFooterNote({ plan }: Pick<SaveFlowShared, 'plan'>): string | null {
  if (plan === undefined || plan.ready) return null;
  if (plan.problems.length > 0) return t('studio:saveApp.check.noteProblems', 'Fix what blocks saving to save.');
  const groups = groupCheck(plan);
  if (groups.blocks.length > 0) return t('studio:saveApp.check.noteSecret', 'Clear or leave out the saved secret to save.');
  const open = needsCount(plan, 0).choices;
  if (open > 0) return t('studio:saveApp.check.noteChoices', '{count, plural, one {Answer # choice to save.} other {Answer # choices to save.}}', { count: open });
  return null;
}

export interface SaveAppCheckProps extends SaveFlowShared {
  onBackToInclude: () => void;
}

export function SaveAppCheck(props: SaveAppCheckProps) {
  const { plan, planPending, planError, inventory, draft, setDraft, saveError, saving } = props;
  const [justAnswered, setJustAnswered] = useState<string | null>(null);
  if (draft === null || inventory === undefined) return null;
  const views = personalViews(inventory, draft);
  const groups = plan === undefined ? null : groupCheck(plan);
  const answered = Object.entries(draft.answers);
  const answeredBlocks = answered.filter(([, given]) => given.item.code === 'SECRET_FOUND');
  const answeredChoices = answered.filter(([, given]) => given.item.code !== 'SECRET_FOUND');
  const needs = plan === undefined ? { blocks: 0, choices: 0 } : needsCount(plan, views.length);
  const after = groups === null ? [] : groupedAfter(groups.after);
  const info = plan === undefined || groups === null ? [] : groupedInfo(groups.info, plan.counts['tables'] ?? 0, plan.minAdminiumVersion);

  const answer = (item: CheckItem, choice: AnswerChoice) => {
    const id = itemId(item);
    setDraft({ ...draft, answers: { ...draft.answers, [id]: { item, choice } } });
    setJustAnswered(id);
  };
  const undo = (id: string) => {
    const { [id]: _gone, ...rest } = draft.answers;
    setDraft({ ...draft, answers: rest });
    setJustAnswered(null);
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-[16.5px] font-extrabold tracking-[-0.02em]">{t('studio:saveApp.step.check', 'Check')}</h2>
        <p className="mt-1 text-[13px] leading-[1.5] text-fg-muted">{t('studio:saveApp.check.body', 'What goes in the file, and what needs you first.')}</p>
      </div>

      {plan === undefined ? null : (
        <div className="flex flex-wrap gap-2" data-part="check-pills">
          <Pill tone="danger" label={t('studio:saveApp.check.blocks', 'Blocks saving')} count={needs.blocks} />
          <Pill tone="warn" label={t('studio:saveApp.check.choices', 'Needs a choice')} count={needs.choices} />
          <Pill tone="info" label={t('studio:saveApp.check.after', 'After you install')} count={after.length} />
          <Pill tone="neutral" label={t('studio:saveApp.check.info', 'For your information')} count={info.length} />
        </div>
      )}

      <div role="status" aria-live="polite">
        {planPending ? (
          <span className="inline-flex items-center gap-2 text-[13px] text-fg-muted">
            <Spinner size="sm" />
            {t('studio:saveApp.check.checking', 'Checking the file again…')}
          </span>
        ) : null}
      </div>
      {planError === null ? null : (
        <Alert tone="danger" title={t('studio:saveApp.planFailed', 'The file could not be checked')}>
          {planError.message}
        </Alert>
      )}
      {saveError === null ? null : (
        <Alert tone="danger" role="alert" title={t('studio:saveApp.saveFailed', 'Could not save. Nothing was written. Try again.')}>
          <p>{saveError.message}</p>
          <Button className="mt-2" size="sm" variant="secondary" loading={saving} onClick={props.save}>
            {t('studio:saveApp.tryAgain', 'Try again')}
          </Button>
        </Alert>
      )}

      {plan === undefined || groups === null ? null : (
        <>
          {plan.problems.length + groups.blocks.length + answeredBlocks.length > 0 ? (
            <Group tone="danger" icon={<OctagonX aria-hidden className="size-[15px] shrink-0" />} label={t('studio:saveApp.check.blocks', 'Blocks saving')} count={needs.blocks}>
              {plan.problems.map((problem, index) => (
                <Row key={`problem-${String(index)}`} tone="danger" icon={<OctagonX aria-hidden className="size-[15px]" />}>
                  <p className="text-[13px] leading-[1.5]">{problem.message}</p>
                  <div>
                    <Button size="sm" variant="secondary" onClick={props.onBackToInclude}>
                      {t('studio:saveApp.check.backToInclude', 'Back to What to include')}
                    </Button>
                  </div>
                </Row>
              ))}
              {groups.blocks.map((item) => (
                <QuestionRow key={itemId(item)} item={item} tone="danger" icon={<ShieldAlert aria-hidden className="size-[15px]" />} onAnswer={answer} />
              ))}
              {answeredBlocks.map(([id, given]) => (
                <AnsweredRow key={id} given={given} tone="danger" focus={justAnswered === id} onUndo={() => undo(id)} />
              ))}
            </Group>
          ) : null}

          {groups.choices.length + answeredChoices.length + views.length > 0 ? (
            <Group tone="warn" icon={<TriangleAlert aria-hidden className="size-[15px] shrink-0" />} label={t('studio:saveApp.check.choices', 'Needs a choice')} count={needs.choices}>
              {groups.choices.map((item) => (
                <QuestionRow key={itemId(item)} item={item} tone="warn" icon={iconFor(item)} onAnswer={answer} />
              ))}
              {answeredChoices.map(([id, given]) => (
                <AnsweredRow key={id} given={given} tone="warn" focus={justAnswered === id} onUndo={() => undo(id)} />
              ))}
              {views.length === 0 ? null : <ViewsRow views={views} inventory={inventory} draft={draft} setDraft={setDraft} />}
            </Group>
          ) : null}

          {after.length === 0 ? null : (
            <Group tone="info" icon={<Info aria-hidden className="size-[15px] shrink-0" />} label={t('studio:saveApp.check.after', 'After you install')} count={after.length}>
              <div className="flex flex-col gap-2 px-5 py-4">
                <ul className="flex list-disc flex-col gap-1.5 ps-5 text-[13px] leading-[1.5]">
                  {after.map((one) => (
                    <li key={one.key}>{one.text}</li>
                  ))}
                </ul>
                <p className="text-[12.5px] text-fg-muted">
                  {t('studio:saveApp.check.afterNote', 'Passwords, keys and addresses are never in the file. The new server lists these until they are done.')}
                </p>
              </div>
            </Group>
          )}

          <Group tone="neutral" icon={<Info aria-hidden className="size-[15px] shrink-0" />} label={t('studio:saveApp.check.info', 'For your information')} count={info.length}>
            <ul className="flex list-disc flex-col gap-1.5 px-5 py-4 ps-10 text-[13px] leading-[1.5]">
              {info.map((one) => (
                <li key={one.key}>{one.text}</li>
              ))}
            </ul>
          </Group>
        </>
      )}
    </div>
  );
}

function iconFor(item: CheckItem): ReactNode {
  if (item.code === 'TYPE_NO_FORM' || item.code === 'COMPOSITE_LINK' || item.code === 'COLUMN_NAME_NO_FORM') return <Type aria-hidden className="size-[15px]" />;
  if (item.code === 'SECRET_LIKELY') return <KeyRound aria-hidden className="size-[15px]" />;
  return <CircleHelp aria-hidden className="size-[15px]" />;
}

function Pill({ tone, label, count }: { tone: Tone; label: string; count: number }) {
  return (
    <span className={cn('inline-flex h-[22px] items-center gap-[5px] whitespace-nowrap rounded-[6px] px-2 text-[11.5px] font-bold', TONE_SOFT[tone])}>
      {label}
      <span className="font-mono">{count}</span>
    </span>
  );
}

function Group({ tone, icon, label, count, children }: { tone: Tone; icon: ReactNode; label: string; count: number; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className={cn('flex items-center gap-2 px-0.5', TONE_TEXT[tone])}>
        {icon}
        <h3 className="text-[10.5px] font-bold uppercase tracking-[0.05em]">{label}</h3>
        <span className={cn('inline-flex h-[22px] items-center rounded-[6px] px-2 font-mono text-[11.5px] font-bold', TONE_SOFT[tone])}>{count}</span>
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-[14px] border border-border bg-surface shadow-card">{children}</div>
    </section>
  );
}

function Row({ tone, icon, children }: { tone: Tone; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-5 py-4">
      <span className={cn('mt-px flex size-[30px] shrink-0 items-center justify-center rounded-[10px]', TONE_SOFT[tone])}>{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">{children}</div>
    </div>
  );
}

function QuestionRow({ item, tone, icon, onAnswer }: { item: CheckItem; tone: Tone; icon: ReactNode; onAnswer: (item: CheckItem, choice: AnswerChoice) => void }) {
  const choices = (item.answer?.choices ?? []).filter((choice): choice is AnswerChoice => ['carry-as-text', 'leave-out', 'make-shared', 'clear', 'keep'].includes(choice));
  return (
    <Row tone={tone} icon={icon}>
      <p className="text-[13px] leading-[1.5]" data-part="check-item" data-code={item.code}>
        {checkSentence(item)}
      </p>
      {choices.length === 0 ? null : (
        <div className="flex flex-wrap gap-1.5">
          {choices.map((choice) => (
            <Button key={choice} size="sm" variant="secondary" onClick={() => onAnswer(item, choice)}>
              {answerLabel(choice, item)}
            </Button>
          ))}
        </div>
      )}
    </Row>
  );
}

function AnsweredRow({ given, tone, focus, onUndo }: { given: SaveDraft['answers'][string]; tone: Tone; focus: boolean; onUndo: () => void }) {
  const undoRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (focus) undoRef.current?.focus();
  }, [focus]);
  return (
    <Row tone={tone} icon={<Check aria-hidden className="size-[15px]" />}>
      <p className="text-[13px] leading-[1.5] text-fg-muted">{checkSentence(given.item)}</p>
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-pos" data-part="check-answered">
          <Check aria-hidden className="size-3.5" />
          {answeredSentence(given.item, given.choice)}
        </span>
        <Button ref={undoRef} size="sm" variant="ghost" onClick={onUndo}>
          {t('studio:saveApp.check.undo', 'Undo')}
        </Button>
      </div>
    </Row>
  );
}

function ViewsRow({
  views,
  inventory,
  draft,
  setDraft,
}: {
  views: ReturnType<typeof personalViews>;
  inventory: NonNullable<SaveFlowShared['inventory']>;
  draft: SaveDraft;
  setDraft: (draft: SaveDraft) => void;
}) {
  const pageTitle = (id: string) => inventory.pages.find((page) => page.id === id)?.title ?? '';
  return (
    <Row tone="warn" icon={<Bookmark aria-hidden className="size-[15px]" />}>
      <p className="text-[13px] leading-[1.5]">
        {t('studio:saveApp.check.views', '{count, plural, one {# saved view belongs to a person. Make it shared in the app to take it along.} other {# saved views belong to people. Make a view shared in the app to take it along.}}', {
          count: views.length,
        })}
      </p>
      <ul className="flex flex-col divide-y divide-border rounded-[10px] border border-border">
        {views.map((view) => {
          const shared = draft.sharedViews.includes(view.id);
          const id = `save-view-${view.id}`;
          return (
            <li key={view.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold">{view.name}</span>
                <span className="block text-[12px] text-fg-subtle">
                  {pageTitle(view.pageId)}
                  {view.ownerName === null ? null : ` · ${view.ownerName}`}
                </span>
              </span>
              <label htmlFor={id} className="text-[12.5px] font-semibold text-fg-muted">
                {t('studio:saveApp.check.answer.makeShared', 'Make shared')}
              </label>
              <Switch
                id={id}
                checked={shared}
                onCheckedChange={(on) => setDraft({ ...draft, sharedViews: on ? [...draft.sharedViews, view.id] : draft.sharedViews.filter((one) => one !== view.id) })}
              />
            </li>
          );
        })}
      </ul>
      <MonoText className="text-xs text-fg-subtle">
        {t('studio:saveApp.views.sharedOf', '{shared} of {total} shared', { shared: draft.sharedViews.filter((id) => views.some((view) => view.id === id)).length, total: views.length })}
      </MonoText>
    </Row>
  );
}
