// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A draft on the page it was made for: the card, its actions, and what
 * happens when one is pressed.
 *
 * WHAT IT WILL NOT DO BY ITSELF. Write anything. Every button that changes
 * something is held while the workspace has not let the assistant create
 * things, needs the same grant the page's own save needs, and asks once more
 * before it runs. The model's last move is a draft; everything after it is
 * somebody's decision.
 *
 * WHERE IT IS PRESSED TRAVELS WITH THE ACTION. The server checks it against
 * where the draft was made and refuses a draft that is not at home, so a
 * panel that had the wrong idea of the page could not save into the wrong
 * place.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { t } from '../../i18n/t.js';
import type { AssistantActionBody, AssistantResult } from '../api.js';
import { confirmCopy, echoText, type AssistantActionSpec, type AssistantCopy } from '../contexts.js';
import { isEditorHost, type AssistantHostContext } from '../hostContext.js';
import { ActionsRow } from '../parts/ActionsRow.js';
import { ConfirmDialog } from '../parts/ConfirmDialog.js';
import { Echo } from '../parts/Echo.js';
import { ResultCard } from '../parts/ResultCard.js';
import { SuggestionCard } from '../parts/SuggestionCard.js';
import type { ActionOutcome, ThreadTurn } from '../thread.js';

export interface LiveDraftProps {
  turn: ThreadTurn;
  result: AssistantResult;
  /** The page's own hands: its renderer, what follows a save, putting a draft on screen. Read when needed. */
  host: () => AssistantHostContext | null;
  copy: AssistantCopy;
  name: string;
  /** Whether the workspace lets the assistant create things: its Create switch. */
  enabled: boolean;
  /** For someone who may change that: the way to the setting. */
  onOpenSettings?: (() => void) | undefined;
  /** Whether this person may save on this page at all. */
  canWrite: boolean;
  tokensIn: number;
  tokensOut: number;
  runAction: (turnId: string, body: AssistantActionBody) => Promise<ActionOutcome | null>;
  /** An older turn comes without its document: ask for it whole. */
  loadWhole: (turnId: string) => void;
  /** The confirm is a dialog of the panel's own, not one of the page's. */
  onOwnDialog: (open: boolean) => void;
  /** After an action that takes the person to the document: a panel lying over the page gets out of the way. */
  onLeave: () => void;
  /** Opens the add-on a suggestion under the draft names. */
  onOpenAddOn?: ((key: string) => void) | undefined;
}

export function LiveDraft({ turn, result, host, copy, name, enabled, canWrite, onOpenSettings, tokensIn, tokensOut, runAction, loadWhole, onOwnDialog, onLeave, onOpenAddOn }: LiveDraftProps) {
  const [echo, setEcho] = useState<string | null>(null);
  const [sample, setSample] = useState<{ artefact: Record<string, unknown>; label: string } | null>(null);
  const [pending, setPending] = useState<{ action: AssistantActionSpec; open: boolean } | null>(null);
  // What this draft was saved as here, beside what the server recorded on the turn: a second
  // save of the same draft would be a second document.
  const [saved, setSaved] = useState<{ id: string; kind: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const turnId = turn.id;
  const light = result.light;
  useEffect(() => {
    if (light) loadWhole(turnId);
  }, [light, turnId, loadWhole]);

  const confirming = pending !== null;
  useEffect(() => {
    if (!confirming) return;
    onOwnDialog(true);
    return () => onOwnDialog(false);
  }, [confirming, onOwnDialog]);

  const context = turn.context;
  const documentId = turn.on.documentId;
  // Where this is pressed: the page (and document) the draft was made for, which is the page it is drawn live on.
  const on = useMemo(() => ({ context, ...(documentId === null ? {} : { documentId }) }), [context, documentId]);

  const onRun = useCallback(
    (action: AssistantActionSpec) => {
      const page = host();
      if (page === null) return;
      if (action.id === 'editor' && isEditorHost(page)) {
        // Client-only: the draft goes onto the screen the person is looking at. Nothing is
        // written, so nothing is confirmed.
        page.applyDraft?.(result.artefact);
        setEcho(t('assistant:echo.applied', 'Drafted into the editor — review the highlighted blocks.'));
        onLeave();
        return;
      }
      if (!action.writes || action.id === 'test-send') {
        void (async () => {
          setBusy(true);
          const outcome = await runAction(turnId, { action: action.writes ? 'test-send' : 'sample', on });
          setBusy(false);
          if (outcome === null) return;
          if (outcome.sample !== null) setSample(outcome.sample);
          setEcho(echoText(context, outcome.echo, result.title));
        })();
        return;
      }
      const already = saved ?? result.saved;
      if (already !== null) {
        // Already saved: *open* goes to the document that exists. Nothing is written.
        if (action.id === 'editor') {
          page.onCreated(already, true);
          onLeave();
        }
        return;
      }
      setPending({ action, open: action.id === 'editor' });
    },
    [host, result, runAction, turnId, context, on, saved, onLeave],
  );

  const confirmWrite = useCallback(() => {
    if (pending === null) return;
    void (async () => {
      setBusy(true);
      const outcome = await runAction(turnId, { action: 'save', on, ...(pending.open ? { open: true } : {}) });
      setBusy(false);
      setPending(null);
      if (outcome === null) return;
      setEcho(echoText(context, { ...outcome.echo, open: pending.open }, result.title));
      if (outcome.created !== null) {
        setSaved(outcome.created);
        host()?.onCreated(outcome.created, pending.open);
      }
      if (pending.open) onLeave();
    })();
  }, [pending, runAction, turnId, context, on, result.title, host, onLeave]);

  const page = host();
  // What would give the part left out: the add-ons the server checked and listed for this turn.
  const suggestions = turn.answer?.suggest ?? [];
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <ResultCard
        result={result}
        kind={copy.page}
        tokensIn={tokensIn}
        tokensOut={tokensOut}
        preview={light || page === null ? null : page.renderPreview(sample?.artefact ?? result.artefact, { basedOn: result.basedOn })}
        // A rule that does less than was asked must say so where the rule is shown.
        alwaysLeftOut={context === 'automation'}
        under={
          suggestions.length === 0 || onOpenAddOn === undefined
            ? null
            : suggestions.map((suggestion) => <SuggestionCard key={suggestion.key} suggestion={suggestion} onOpen={onOpenAddOn} />)
        }
        footer={
          <ActionsRow
            actions={copy.actions}
            enabled={enabled}
            canWrite={canWrite}
            saved={(saved ?? result.saved) !== null}
            name={name}
            busy={busy || light}
            onRun={onRun}
          />
        }
      />
      {enabled || !canWrite ? null : (
        // The draft can still be put in the editor and saved there by hand: that save is the person's own.
        <p data-testid="assistant-save-off" className="flex flex-wrap items-center gap-x-2 gap-y-1 ps-1 text-[11.5px] font-medium leading-[1.5] text-fg-muted">
          {t('assistant:readOnly.switchedOff', 'Saving is switched off for {name} in this workspace.', { name })}
          {onOpenSettings === undefined ? null : (
            <button type="button" onClick={onOpenSettings} className="font-bold text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              {t('assistant:readOnly.openSettings', 'Open settings')}
            </button>
          )}
        </p>
      )}
      {echo === null ? null : <Echo text={echo} />}
      {pending === null ? null : (
        <ConfirmDialog
          open
          busy={busy}
          copy={confirmCopy(context, { name, title: result.title, open: pending.open })}
          onCancel={() => setPending(null)}
          onConfirm={confirmWrite}
        />
      )}
    </div>
  );
}
