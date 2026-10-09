// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One exchange of a conversation: what was asked, what ran, what came back,
 * and what stands under it. Drawn the same in the window a document page
 * opens and in the panel beside every page, so it lives apart from both.
 */
import { cn } from '@adminium/ui';
import type { ReactNode } from 'react';

import { t } from '../i18n/t.js';
import type { AssistantContext, AssistantResult } from './api.js';
import { AnswerFoot, ForgotDivider } from './parts/AnswerFoot.js';
import { AskCard } from './parts/AskCard.js';
import { AssistantBubble } from './parts/AssistantBubble.js';
import { Warning } from './parts/ResultCard.js';
import { StepsCard } from './parts/StepsCard.js';
import { SuggestionCard } from './parts/SuggestionCard.js';
import { UserBubble } from './parts/UserBubble.js';
import type { LiveStep } from './useTurnProgress.js';
import type { ThreadTurn } from './thread.js';

export interface TurnViewProps {
  turn: ThreadTurn;
  live: boolean;
  liveSteps: readonly LiveStep[];
  answered: boolean;
  workTitle: string;
  /** The page this turn ran on — the first step's sentence is per-page. */
  context: AssistantContext;
  picks: Record<string, string>;
  onPick: (groupKey: string, optionKey: string) => void;
  onGo: () => void;
  onRetry: (() => void) | null;
  renderResult: (result: AssistantResult) => ReactNode;
  /** What the assistant is called here, for the failures worded with it. */
  name: string;
  /** Whether this person may choose the model: it decides what a model failure tells them to do. */
  canConfigure: boolean;
  /** The last turn of the thread: only its answer offers what to ask next. */
  newest: boolean;
  /** Nothing can be asked right now (a turn is running, the day is used up). */
  blocked: boolean;
  /** Send a message as the person: a follow-up, or the same question to be read this time. */
  onAsk: (text: string) => void;
  onOpenAddOn: (key: string) => void;
  /** Where it was asked and what "these" meant, in the panel's thread; absent in a window that is one page's. */
  askedOn?: string | undefined;
  askedScope?: string | undefined;
}

/** The pages whose assistant answers from data: only there is "nothing was read" a thing to say. */
const READING_CONTEXTS: ReadonlySet<AssistantContext> = new Set<AssistantContext>(['data', 'general']);

/** One exchange: what was asked, what ran, and what came back. */
/**
 * A failed turn's sentence. The kinds this app knows are worded here, as
 * advice to the person; anything else is shown in the server's own words.
 * One literal key a sentence, so each is in the catalogue.
 */
export function failureText(turn: ThreadTurn, name: string, canConfigure: boolean): string {
  switch (turn.errorKind) {
    case 'too-long':
      return t('assistant:error.tooLong', 'This conversation is too long for the model — start a new session.');
    case 'model-format':
      // The model cannot do this, so asking again changes nothing: who can act is told what to do.
      return canConfigure
        ? t('assistant:error.modelFormat', 'This model does not answer in the way {name} needs. Choose another model in Settings → AI.', { name })
        : t('assistant:error.modelFormatAsk', 'This model does not answer in the way {name} needs. Ask an administrator to choose another model.', { name });
    case 'setup':
      return t('assistant:error.setup', 'This page could not be read just now. Try asking again.');
    case 'budget':
      // The bar across the window says when it starts again; this is the turn's own line.
      return t('assistant:error.budget', 'This stopped part way: today’s allowance is used up.');
    default:
      return turn.errorMessage ?? t('assistant:error.generic', 'That did not work. Try asking again.');
  }
}

export function TurnView({
  turn,
  live,
  liveSteps,
  answered,
  workTitle,
  context,
  name,
  canConfigure,
  newest,
  blocked,
  onAsk,
  onOpenAddOn,
  askedOn,
  askedScope,
  picks,
  onPick,
  onGo,
  onRetry,
  renderResult,
}: TurnViewProps) {
  const working = turn.status === 'queued' || turn.status === 'running';
  // While a turn runs its steps come off the socket, because a row polled for
  // them would be slower than the work it describes; a finished turn's steps
  // are the ones it stored.
  const steps = live && working ? liveSteps : turn.steps.map((step) => ({ ...step, note: null }));
  const failed = turn.status === 'failed';
  // An answer in words, finished: the one shape that has a foot.
  const answer =
    turn.answer !== null && turn.status === 'done' && turn.ask === null && turn.result === null && turn.say !== null ? turn.answer : null;
  const question = turn.askText;
  return (
    <>
      {turn.answer !== null && turn.answer.forgot > 0 ? <ForgotDivider count={turn.answer.forgot} name={name} /> : null}
      <UserBubble text={turn.askText} pickedLabels={turn.pickedLabels} askedOn={askedOn} scope={askedScope} />

      {steps.length === 0 && !working ? null : (
        <AssistantBubble>
          <StepsCard
            title={working ? t('assistant:steps.working', 'Working on it') : (turn.result?.workTitle ?? workTitle)}
            steps={steps}
            state={working ? 'working' : failed ? 'failed' : 'done'}
            context={context}
          />
        </AssistantBubble>
      )}

      {turn.ask === null && turn.result === null && turn.say !== null && !working ? (
        <AskCard say={turn.say} ask={null} picks={{}} onPick={() => undefined} onGo={() => undefined} />
      ) : null}

      {answer === null
        ? null
        : answer.suggest.map((suggestion) => (
            <AssistantBubble key={suggestion.key} spacer bare>
              <SuggestionCard suggestion={suggestion} onOpen={onOpenAddOn} />
            </AssistantBubble>
          ))}
      {answer === null ? null : (
        <AnswerFoot
          answer={answer}
          // An answer that points at an add-on is about what the workspace offers, not about its rows.
          reads={READING_CONTEXTS.has(context) && answer.suggest.length === 0}
          disabled={blocked}
          {...(question === null || !newest
            ? {}
            : {
                onReadAgain: () => {
                  onAsk(t('assistant:answer.readAgainAsk', '{question} Read the data to answer.', { question }));
                },
              })}
          {...(newest ? { followups: answer.followups, onFollowup: onAsk } : {})}
        />
      )}

      {turn.ask === null ? null : (
        <AskCard
          say={turn.say ?? ''}
          ask={turn.ask}
          picks={picks}
          onPick={onPick}
          onGo={onGo}
          answered={answered}
        />
      )}

      {failed ? (
        <AssistantBubble spacer bare>
          <div className="min-w-0 flex-1 overflow-hidden rounded-[16px] border border-border bg-surface pt-4 shadow-menu">
            <Warning
              text={failureText(turn, name, canConfigure)}
              {...(onRetry === null || turn.errorKind === 'model-format' || turn.errorKind === 'budget'
                ? {}
                : {
                    action: (
                      <button
                        type="button"
                        onClick={onRetry}
                        className={cn(
                          'nb-press rounded-sm px-2 py-1 text-[11px] font-bold text-warn underline-offset-2 hover:underline',
                          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                        )}
                      >
                        {t('assistant:error.tryAgain', 'Try again')}
                      </button>
                    ),
                  })}
            />
          </div>
        </AssistantBubble>
      ) : null}

      {turn.result === null ? null : (
        <AssistantBubble spacer bare>
          {renderResult(turn.result)}
        </AssistantBubble>
      )}
    </>
  );
}
