// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One assistant, one page, one modal.
 *
 * WHAT IT KNOWS ABOUT THE PAGE IT IS ON. Only what the host handed it: the
 * context key, what is on screen, a renderer, and two callbacks. Nothing in
 * this tree imports the email, invoice or report trees — not even their
 * types — so the preview a person sees is drawn by the page's OWN component
 * and there is no second renderer to keep in step.
 *
 * WHAT IT WILL NOT DO. Write anything by itself. Every button that changes
 * something is locked until a person turns actions on in this open, needs the
 * same grant the page's own save needs, and asks once more before it runs. The
 * model's terminal move is a draft; everything after that is somebody's
 * decision.
 *
 * THE THREAD IS THE SESSION. Every turn keeps its bubble, its working card and
 * its result, because a conversation is the reason this is a modal and not a
 * form. Closing it cancels whatever is still running and closes the session.
 */
import { Modal, ModalBody, Spinner, cn } from '@adminium/ui';
import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { t } from '../i18n/t.js';
import type { AssistantContext, AssistantResult } from './api.js';
import { useAssistantMessages } from './assistantMessages.js';
import {
  confirmCopy,
  contextCopy,
  echoText,
  type AssistantActionSpec,
  type AssistantFactValues,
} from './contexts.js';
import { isEditorHost, type AssistantHostContext } from './hostContext.js';
import { ActionsRow } from './parts/ActionsRow.js';
import { AskCard } from './parts/AskCard.js';
import { AssistantBubble } from './parts/AssistantBubble.js';
import { ChipList } from './parts/ChipList.js';
import { Composer } from './parts/Composer.js';
import { ConfirmDialog } from './parts/ConfirmDialog.js';
import { Echo } from './parts/Echo.js';
import { Header } from './parts/Header.js';
import { Idle } from './parts/Idle.js';
import { ReadOnlyBar } from './parts/ReadOnlyBar.js';
import { ResultCard, Warning } from './parts/ResultCard.js';
import { StepsCard } from './parts/StepsCard.js';
import { UnavailableBar } from './parts/UnavailableBar.js';
import { UserBubble } from './parts/UserBubble.js';
import { useAssistantSession, type ThreadTurn } from './useAssistantSession.js';

export interface AssistantModalProps {
  host: AssistantHostContext;
  open: boolean;
  onClose: () => void;
  /** Where *Open Settings → AI* goes; the host owns navigation. */
  onOpenSettings?: (() => void) | undefined;
}

/** A write waiting for its confirm. */
interface PendingWrite {
  turnId: string;
  action: AssistantActionSpec;
  /** True when the confirm must also promise the editor — a manager has nowhere else to put a draft. */
  open: boolean;
  title: string;
}

export function AssistantModal({ host, open, onClose, onOpenSettings }: AssistantModalProps) {
  // Before anything reads a key. A host that renders the button has already
  // waited on this namespace, so it resolves without suspending; a caller
  // that has not (a story, a later host) suspends here instead of painting
  // English and correcting itself a frame later.
  useAssistantMessages();
  const session = useAssistantSession(host, open);
  const [enabled, setEnabled] = useState(false);
  const [input, setInput] = useState('');
  const [picks, setPicks] = useState<Record<string, Record<string, string>>>({});
  const [echo, setEcho] = useState<string | null>(null);
  const [samples, setSamples] = useState<Record<string, { artefact: Record<string, unknown>; label: string }>>({});
  const [pending, setPending] = useState<PendingWrite | null>(null);
  const [busy, setBusy] = useState(false);

  const values: AssistantFactValues = useMemo(
    () => ({ ...(session.facts?.values ?? {}) }),
    [session.facts],
  );
  const copy = useMemo(
    () => contextCopy(host.context, values, session.name),
    [host.context, values, session.name],
  );

  const canWrite = session.availability?.canWrite ?? false;
  const unavailable = session.phase === 'unavailable';
  const composerBlocked = unavailable || session.phase !== 'ready';

  const submit = useCallback(
    (text: string) => {
      setEcho(null);
      setInput('');
      session.submit(text);
    },
    [session],
  );

  const closeModal = useCallback(() => {
    // The guardrail is per OPEN: the next one starts locked, whatever this
    // person decided a minute ago.
    setEnabled(false);
    setEcho(null);
    setPicks({});
    setSamples({});
    setPending(null);
    onClose();
  }, [onClose]);

  /** Run an action that writes nothing, or open the confirm for one that does. */
  const onRun = useCallback(
    (turn: ThreadTurn, result: AssistantResult, action: AssistantActionSpec) => {
      const editorHost = isEditorHost(host);
      if (action.id === 'editor' && editorHost) {
        // Client-only: the draft goes onto the screen the person is already
        // looking at. Nothing is written, so nothing is confirmed.
        host.applyDraft?.(result.artefact);
        setEcho(t('assistant:echo.applied', 'Drafted into the editor — review the highlighted blocks.'));
        closeModal();
        return;
      }
      if (!action.writes) {
        void (async () => {
          setBusy(true);
          const outcome = await session.runAction(turn.id, { action: 'sample' });
          setBusy(false);
          if (outcome === null) return;
          if (outcome.sample !== null) {
            setSamples((previous) => ({ ...previous, [turn.id]: outcome.sample! }));
          }
          setEcho(echoText(host.context, outcome.echo, result.title));
        })();
        return;
      }
      if (action.id === 'test-send') {
        void (async () => {
          setBusy(true);
          const outcome = await session.runAction(turn.id, { action: 'test-send' });
          setBusy(false);
          if (outcome === null) return;
          setEcho(echoText(host.context, outcome.echo, result.title));
        })();
        return;
      }
      setPending({ turnId: turn.id, action, open: action.id === 'editor', title: result.title });
    },
    [closeModal, host, session],
  );

  const confirmWrite = useCallback(() => {
    if (pending === null) return;
    void (async () => {
      setBusy(true);
      const outcome = await session.runAction(pending.turnId, {
        action: 'save',
        ...(pending.open ? { open: true } : {}),
      });
      setBusy(false);
      setPending(null);
      if (outcome === null) return;
      setEcho(echoText(host.context, { ...outcome.echo, open: pending.open }, pending.title));
      if (outcome.created !== null) host.onCreated(outcome.created, pending.open);
      if (pending.open) closeModal();
    })();
  }, [closeModal, host, pending, session]);

  const scope = useMemo(() => {
    const facts = session.facts;
    if (facts === null) return copy.scopePrimary;
    if (host.context === 'report' && facts.scope.primary !== '') {
      return t('assistant:scope.connection', '{connection} · {n, plural, one {# table} other {# tables}}', {
        connection: facts.scope.primary,
        n: facts.scope.extra,
      });
    }
    return facts.scope.extra > 0
      ? `${copy.scopePrimary} ${t('assistant:scope.extra', '+{n}', { n: facts.scope.extra })}`
      : copy.scopePrimary;
  }, [copy.scopePrimary, host.context, session.facts]);

  const lastResultTurn = [...session.turns].reverse().find((turn) => turn.result !== null) ?? null;

  return (
    <Modal
      open={open}
      size="xl"
      className="max-h-[88vh]"
      onOpenChange={(next) => {
        if (!next) closeModal();
      }}
    >
      <Header
        name={session.name}
        page={copy.page}
        pageIcon={copy.pageIcon}
        blurb={copy.blurb}
        scope={scope}
        tokens={session.tokensIn + session.tokensOut}
      />

      {unavailable ? (
        <UnavailableBar
          reason={session.availability?.reason ?? null}
          name={session.name}
          canConfigure={session.availability?.canConfigure ?? false}
          onOpenSettings={() => {
            onOpenSettings?.();
            closeModal();
          }}
        />
      ) : enabled && canWrite ? null : (
        <ReadOnlyBar
          name={session.name}
          canWrite={canWrite}
          onEnable={() => {
            setEnabled(true);
          }}
        />
      )}

      <ModalBody data-testid="assistant-thread" className="bg-bg px-[22px] pb-[22px] pt-5">
        {session.phase === 'loading' ? (
          <div className="flex items-center justify-center py-10">
            <Spinner />
          </div>
        ) : session.turns.length === 0 ? (
          <Idle
            greeting={copy.greeting}
            greetingSub={copy.greetingSub}
            suggestions={copy.suggestions}
            onPick={submit}
            disabled={composerBlocked}
          />
        ) : (
          <div className="flex flex-col gap-4">
            {session.turns.map((turn, index) => (
              <TurnView
                key={turn.id}
                turn={turn}
                live={turn.id === session.turns.at(-1)?.id}
                liveSteps={session.liveSteps}
                answered={index < session.turns.length - 1}
                workTitle={copy.workTitle}
                context={host.context}
                picks={picks[turn.id] ?? {}}
                onPick={(groupKey, optionKey) => {
                  setPicks((previous) => ({
                    ...previous,
                    [turn.id]: { ...(previous[turn.id] ?? {}), [groupKey]: optionKey },
                  }));
                }}
                onGo={() => {
                  setEcho(null);
                  session.answer(turn.id, picks[turn.id] ?? {});
                }}
                onRetry={
                  // A turn that only carried picks has no text to re-post, so
                  // there is nothing to offer rather than a button that does
                  // nothing.
                  turn.askText === null
                    ? null
                    : () => {
                        submit(turn.askText ?? '');
                      }
                }
                renderResult={(result) => (
                  <ResultCard
                    result={result}
                    kind={copy.page}
                    tokensIn={session.tokensIn}
                    tokensOut={session.tokensOut}
                    preview={host.renderPreview(samples[turn.id]?.artefact ?? result.artefact, {
                      basedOn: result.basedOn,
                    })}
                    footer={
                      <ActionsRow
                        actions={copy.actions}
                        enabled={enabled}
                        canWrite={canWrite}
                        name={session.name}
                        busy={busy}
                        onRun={(action) => {
                          onRun(turn, result, action);
                        }}
                      />
                    }
                  />
                )}
              />
            ))}
            {echo === null ? null : <Echo text={echo} />}
            {session.problem === null ? null : <Warning text={session.problem} />}
          </div>
        )}
      </ModalBody>

      <div className="shrink-0 border-t border-border bg-surface px-[18px] pb-3.5 pt-3">
        {lastResultTurn?.result !== undefined && lastResultTurn.result !== null ? (
          <ChipList
            className="mb-2.5"
            variant="compact"
            items={lastResultTurn.result.followups.map((label) => ({ label }))}
            onPick={submit}
            disabled={composerBlocked || session.working}
          />
        ) : null}
        <Composer
          value={input}
          onChange={setInput}
          onSubmit={() => {
            submit(input);
          }}
          placeholder={copy.placeholder}
          nextTurnTokens={session.nextTurnTokens}
          working={session.working}
          disabled={composerBlocked}
        />
      </div>

      {pending === null ? null : (
        <ConfirmDialog
          open
          busy={busy}
          copy={confirmCopy(host.context, {
            name: session.name,
            title: pending.title,
            open: pending.open,
          })}
          onCancel={() => {
            setPending(null);
          }}
          onConfirm={confirmWrite}
        />
      )}
    </Modal>
  );
}

interface TurnViewProps {
  turn: ThreadTurn;
  live: boolean;
  liveSteps: ReturnType<typeof useAssistantSession>['liveSteps'];
  answered: boolean;
  workTitle: string;
  /** The page this turn ran on — the first step's sentence is per-page. */
  context: AssistantContext;
  picks: Record<string, string>;
  onPick: (groupKey: string, optionKey: string) => void;
  onGo: () => void;
  onRetry: (() => void) | null;
  renderResult: (result: AssistantResult) => ReactNode;
}

/** One exchange: what was asked, what ran, and what came back. */
function TurnView({
  turn,
  live,
  liveSteps,
  answered,
  workTitle,
  context,
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
  return (
    <>
      <UserBubble text={turn.askText} pickedLabels={turn.pickedLabels} />

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
              text={
                // The one failure this app words itself: "too long" is a
                // KIND the server reports, and the advice that goes with it
                // is advice to a person, so it belongs in a message key.
                turn.tooLong
                  ? t(
                      'assistant:error.tooLong',
                      'This conversation is too long for the model — start a new session.',
                    )
                  : (turn.errorMessage ?? t('assistant:error.generic', 'That did not work. Try asking again.'))
              }
              {...(onRetry === null
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
