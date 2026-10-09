// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A draft on the page it was made for: the card, its actions, and what
 * happens when one is pressed.
 *
 * WHAT IT WILL NOT DO BY ITSELF. Write anything. Every button that changes
 * something is locked until the person turns actions on (for this page, this
 * visit), needs the same grant the page's own save needs, and asks once more
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
import type { ActionOutcome, ThreadTurn } from '../thread.js';

export interface LiveDraftProps {
  turn: ThreadTurn;
  result: AssistantResult;
  /** The page's own hands: its renderer, what follows a save, putting a draft on screen. Read when needed. */
  host: () => AssistantHostContext | null;
  copy: AssistantCopy;
  name: string;
  /** The guardrail: false until the person enables actions on this page. */
  enabled: boolean;
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
}

export function LiveDraft({ turn, result, host, copy, name, enabled, canWrite, tokensIn, tokensOut, runAction, loadWhole, onOwnDialog, onLeave }: LiveDraftProps) {
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
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <ResultCard
        result={result}
        kind={copy.page}
        tokensIn={tokensIn}
        tokensOut={tokensOut}
        preview={light || page === null ? null : page.renderPreview(sample?.artefact ?? result.artefact, { basedOn: result.basedOn })}
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
