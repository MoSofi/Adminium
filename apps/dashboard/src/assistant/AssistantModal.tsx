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
import { Modal, ModalBody, Spinner } from '@adminium/ui';
import { useCallback, useMemo, useState } from 'react';

import { t } from '../i18n/t.js';
import type { AssistantResult } from './api.js';
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
import { ChipList } from './parts/ChipList.js';
import { Composer } from './parts/Composer.js';
import { ConfirmDialog } from './parts/ConfirmDialog.js';
import { Echo } from './parts/Echo.js';
import { Header } from './parts/Header.js';
import { Idle } from './parts/Idle.js';
import { ReadOnlyBar } from './parts/ReadOnlyBar.js';
import { ResultCard, Warning } from './parts/ResultCard.js';
import { AllowanceBar } from './parts/AllowanceBar.js';
import { UnavailableBar } from './parts/UnavailableBar.js';
import { TurnView } from './TurnView.js';
import { useAssistantSession, type ThreadTurn } from './useAssistantSession.js';

export interface AssistantModalProps {
  host: AssistantHostContext;
  open: boolean;
  onClose: () => void;
  /** Where *Open Settings → AI* goes; the host owns navigation. */
  onOpenSettings?: (() => void) | undefined;
  /** Go to where add-ons are installed, for a suggestion's button. Absent: the button does nothing but close. */
  onOpenAddOns?: ((key: string) => void) | undefined;
}

/** A write waiting for its confirm. */
interface PendingWrite {
  turnId: string;
  action: AssistantActionSpec;
  /** True when the confirm must also promise the editor — a manager has nowhere else to put a draft. */
  open: boolean;
  title: string;
}

export function AssistantModal({ host, open, onClose, onOpenSettings, onOpenAddOns }: AssistantModalProps) {
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
  // What each turn's draft was saved as, in this open — beside what the server
  // recorded on the turn (`result.saved`), which a turn loaded already-saved
  // carries. A second save of the same draft would be a second document.
  const [saved, setSaved] = useState<Record<string, { id: string; kind: string; name: string }>>({});
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
  // A used-up day blocks asking, like no provider does: the bar above the thread says when it starts again.
  const composerBlocked = unavailable || session.phase !== 'ready' || session.usedUpUntil !== null;

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
      const already = saved[turn.id] ?? result.saved;
      if (already !== null) {
        // Already saved: *open* goes to the document that exists. Nothing is
        // written, so nothing is confirmed.
        if (action.id === 'editor') {
          host.onCreated(already, true);
          closeModal();
        }
        return;
      }
      setPending({ turnId: turn.id, action, open: action.id === 'editor', title: result.title });
    },
    [closeModal, host, saved, session],
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
      if (outcome.created !== null) {
        const created = outcome.created;
        setSaved((previous) => ({ ...previous, [pending.turnId]: created }));
        host.onCreated(created, pending.open);
      }
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
      ) : (enabled && canWrite) || copy.actions.length === 0 ? null : (
        // A page that drafts nothing has no action to switch on: no bar about switching them on.
        <ReadOnlyBar
          name={session.name}
          canWrite={canWrite}
          onEnable={() => {
            setEnabled(true);
          }}
        />
      )}

      {session.usedUpUntil === null ? null : <AllowanceBar resetsAt={session.usedUpUntil} />}

      <ModalBody data-testid="assistant-thread" className="bg-bg px-[22px] pb-[22px] pt-5">
        {session.phase === 'loading' ? (
          <div className="flex items-center justify-center py-10">
            <Spinner />
          </div>
        ) : session.turns.length === 0 ? (
          <div className="flex flex-col gap-4">
            <Idle
              greeting={copy.greeting}
              greetingSub={copy.greetingSub}
              suggestions={copy.suggestions}
              onPick={submit}
              disabled={composerBlocked}
            />
            {/* A first question the server refused has no turn to hang its reason on: it is said here,
                or the window would look as if nothing had been asked. */}
            {session.problem === null || session.phase !== 'ready' ? null : <Warning text={session.problem} />}
          </div>
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
                name={session.name}
                canConfigure={session.availability?.canConfigure ?? false}
                newest={index === session.turns.length - 1}
                blocked={composerBlocked || session.working}
                onAsk={submit}
                onOpenAddOn={(key) => {
                  onOpenAddOns?.(key);
                  closeModal();
                }}
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
                        saved={(saved[turn.id] ?? result.saved) !== null}
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

