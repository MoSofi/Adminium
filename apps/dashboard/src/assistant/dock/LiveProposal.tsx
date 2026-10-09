// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A proposal in the thread: checked, shown, confirmed, undone.
 *
 * NOTHING IS SHOWN UNTIL THE SERVER HAS TRIED IT. A turn that ends with a
 * proposal carries only the fact of one. This asks the server to try it as
 * the person who is signed in, and draws what comes back: what would change,
 * as they read the rows, and what cannot be done, in the server's own words.
 *
 * A CONFIRM IS A CLICK HERE AND NOTHING ELSE. It sends the hash of what was
 * shown and the rows left ticked. When anything differs by then (a row moved,
 * a switch was turned off) the server writes nothing and answers the proposal
 * as it now stands; that is drawn, and the person is asked again.
 *
 * THE UNDO IS THE PAGE'S OWN. A confirmation hands back the same one-minute
 * tokens a save on the screen gets, once; they are held here and nowhere
 * else, so a reload has none and says so.
 */
import { Modal, ModalBody, ModalHeader } from '@adminium/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError } from '../../app/api.js';
import { undoMutation } from '../../api/crud.js';
import { t } from '../../i18n/t.js';
import { assistantApi, readProposal, type AssistantProposal, type AssistantProposalAction } from '../api.js';
import { ProposalCard, type ProposalButton, type ProposalCardProps, type ProposalLine, type ProposalRow } from '../parts/ProposalCard.js';
import { askTitle, cellText, doneTitle, fixRequest, iconOf, labelOf, referencesText, rowOf, sharedChange, sharedKind } from '../proposalModel.js';
import { messageOf } from '../thread.js';

/** How long the page's own undo lasts. */
const UNDO_MS = 60_000;
/** Rows a list shows in the panel before "Open large". */
const ROWS_SHOWN = 6;

export interface LiveProposalProps {
  sessionId: string | null;
  turnId: string;
  /** The proposal as the turn carries it. */
  proposal: AssistantProposal;
  name: string;
  /** The conversation's last turn: once something else was asked, a proposal is let go. */
  newest: boolean;
  /** The person is on the page this was asked on: elsewhere it waits, parked. */
  atHome: boolean;
  /** What that page is called, for "Open Invoices to use this". */
  homeTitle: string;
  onOpenHome: (() => void) | null;
  /** Send a message as the person. */
  onAsk: (text: string) => void;
  /** Nothing can be asked or confirmed right now. */
  blocked: boolean;
  /** The turn changed on the server: read it again. */
  onChanged: () => void;
  /** Open a mail in its editor, from a send's card. */
  onOpenTemplate?: ((id: string) => void) | undefined;
  rtl?: boolean;
  /** For tests: the clock. */
  now?: () => number;
}

type Phase = 'idle' | 'checking' | 'applying' | 'undoing';

/**
 * What this window knows of a proposal that the server does not keep: the
 * undo tokens of a confirmation made here, what was unticked, that it was
 * cancelled. Held by the turn, outside the component: the panel is taken off
 * the screen when it is closed, and closing it must not cost the minute's undo.
 * It lives as long as the page does; a reload has none of it.
 */
interface Remembered {
  fresh: AssistantProposal | null;
  off: readonly number[];
  cancelled: boolean;
  changed: boolean;
  undo: { tokens: { index: number; token: string }[]; at: number; given: number } | null;
  undone: number | null;
}
const remembered = new Map<string, Remembered>();

/** For tests: nothing is remembered of any proposal. */
export function forgetProposals(): void {
  remembered.clear();
}

/** How far along a proposal is: a copy further along is the newer one. */
const rank = (proposal: AssistantProposal): number => (proposal.state === 'unchecked' ? 0 : proposal.state === 'open' ? 1 : 2);

export function LiveProposal({ sessionId, turnId, proposal: stored, name, newest, atHome, homeTitle, onOpenHome, onAsk, blocked, onChanged, onOpenTemplate, rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl', now = Date.now }: LiveProposalProps) {
  const memory = remembered.get(turnId);
  // What the server last said of it: the turn's own copy, until a check or a confirm answers a newer one.
  const [fresh, setFresh] = useState<AssistantProposal | null>(memory?.fresh ?? null);
  const proposal = fresh ?? stored;
  const [phase, setPhase] = useState<Phase>('idle');
  const [problem, setProblem] = useState<string | null>(null);
  const [off, setOff] = useState<ReadonlySet<number>>(new Set(memory?.off ?? []));
  const [cancelled, setCancelled] = useState(memory?.cancelled ?? false);
  const [changed, setChanged] = useState(memory?.changed ?? false);
  const [groupOpen, setGroupOpen] = useState(true);
  const [large, setLarge] = useState(false);
  // The undo: tokens in hand, when the confirmation began, how many were given, and how many were taken back.
  const [undo, setUndo] = useState<Remembered['undo']>(memory?.undo ?? null);
  const [undone, setUndone] = useState<number | null>(memory?.undone ?? null);
  const [tick, setTick] = useState(0);
  // Whether the card came to ask, or to say what was done, while the person was looking: then it takes focus.
  const [arrived, setArrived] = useState<'asked' | 'done' | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    remembered.set(turnId, { fresh, off: [...off], cancelled, changed, undo, undone });
  }, [turnId, fresh, off, cancelled, changed, undo, undone]);

  // A copy on the turn that is further along (a reload's, another window's) replaces what is
  // held here. One that is not is the turn as it was read before this window's own reply.
  useEffect(() => {
    setFresh((held) => (held !== null && rank(stored) > rank(held) ? null : held));
  }, [stored]);

  // ── the check, once, as soon as there is something to check ───────────────
  const checked = useRef<string | null>(null);
  useEffect(() => {
    // Something else was asked since: the server would only say it was let go.
    if (proposal.state !== 'unchecked' || !newest || sessionId === null || checked.current === `${turnId}:${String(retry)}`) return;
    checked.current = `${turnId}:${String(retry)}`;
    setPhase('checking');
    setProblem(null);
    assistantApi.checkProposal(sessionId, turnId).then(
      (reply) => {
        setFresh(readProposal(reply.proposal));
        setArrived('asked');
        setPhase('idle');
        onChanged();
      },
      (error: unknown) => {
        setProblem(messageOf(error));
        setPhase('idle');
      },
    );
  }, [proposal.state, newest, sessionId, turnId, onChanged, retry]);

  // ── the undo's minute ────────────────────────────────────────────────────
  const left = undo === null ? 0 : Math.max(0, UNDO_MS - (now() - undo.at));
  useEffect(() => {
    if (undo === null || left <= 0) return;
    const timer = setTimeout(() => setTick((value) => value + 1), 1000);
    return () => clearTimeout(timer);
  }, [undo, left, tick]);

  const able = useMemo(() => proposal.actions.map((action, index) => ({ action, index })).filter((entry) => entry.action.preview !== null && entry.action.refused === null), [proposal.actions]);
  const picked = useMemo(() => able.filter((entry) => !off.has(entry.index)), [able, off]);

  const confirm = useCallback(() => {
    if (sessionId === null || proposal.hash === null || picked.length === 0 || phase !== 'idle') return;
    setPhase('applying');
    setProblem(null);
    // The undo's minute runs from each row's own write: counted from the click, the ring is never late.
    const began = now();
    const count = proposal.actions.length;
    assistantApi.applyProposal(sessionId, turnId, { hash: proposal.hash, pick: picked.map((entry) => entry.index) }).then(
      (reply) => {
        setFresh(readProposal(reply.proposal));
        const tokens = reply.undo ?? [];
        setUndo({ tokens, at: tokens.length === 0 ? 0 : began, given: tokens.length });
        setChanged(false);
        setArrived('done');
        setPhase('idle');
        onChanged();
      },
      (error: unknown) => {
        setPhase('idle');
        // Nothing was written. The server says how the proposal stands now: that is what is drawn.
        const current = error instanceof ApiError ? readProposal((error.details as { proposal?: unknown } | null)?.proposal) : null;
        if (current === null) {
          setProblem(messageOf(error));
          return;
        }
        setFresh(current);
        // What was unticked stays unticked while the list is the same list.
        if (current.actions.length !== count) setOff(new Set());
        setChanged(current.state === 'open');
        onChanged();
      },
    );
  }, [sessionId, turnId, proposal.hash, proposal.actions.length, picked, phase, now, onChanged]);

  const takeBack = useCallback(() => {
    if (undo === null || undo.tokens.length === 0 || phase !== 'idle') return;
    setPhase('undoing');
    setProblem(null);
    void (async () => {
      let back = 0;
      const kept: { index: number; token: string }[] = [];
      for (const entry of undo.tokens) {
        try {
          await undoMutation(entry.token);
          back += 1;
        } catch {
          // Kept: while the minute lasts it can be tried again.
          kept.push(entry);
        }
      }
      setUndone((already) => (already ?? 0) + back);
      setUndo({ ...undo, tokens: kept });
      if (kept.length > 0) setProblem(t('assistant:proposal.undoFailed', '{count, plural, one {# change} other {# changes}} could not be taken back. Try again.', { count: kept.length }));
      setPhase('idle');
    })();
  }, [undo, phase]);

  const base = { rtl, testId: 'assistant-proposal' } satisfies Partial<ProposalCardProps>;
  const sub = proposal.title === '' ? undefined : proposal.title;
  const problemLine: ProposalLine[] = problem === null ? [] : [{ icon: 'warn', text: problem, tone: 'warn' }];

  // What the server would say on its next look, known here already: something else was asked
  // since, or its half hour has passed.
  const late = proposal.state === 'open' && proposal.expiresAt !== null && now() > proposal.expiresAt;
  const waiting = proposal.state === 'unchecked' || proposal.state === 'open';
  const letGo: 'superseded' | 'expired' | null = proposal.state === 'superseded' || (waiting && !newest) ? 'superseded' : proposal.state === 'expired' || late ? 'expired' : null;

  // ── before the check ─────────────────────────────────────────────────────
  if (proposal.state === 'unchecked' && letGo === null) {
    return (
      <ProposalCard
        {...base}
        icon="change"
        title={t('assistant:proposal.checking.title', 'A change to confirm')}
        {...(problem === null ? { spinner: t('assistant:proposal.checking.line', 'Checking what would change…') } : {})}
        lines={problemLine}
        {...(problem === null || phase === 'checking'
          ? {}
          : { buttons: [{ id: 'recheck', label: t('assistant:proposal.checkAgain', 'Check again'), onClick: () => setRetry((count) => count + 1) }] })}
      />
    );
  }

  const quiet = { ...base, tone: 'muted' as const, iconTone: 'muted' as const, icon: iconOf(sharedKind(proposal.actions)), title: sub ?? t('assistant:proposal.checking.title', 'A change to confirm') };

  // ── let go ───────────────────────────────────────────────────────────────
  if (letGo === 'superseded') {
    return <ProposalCard {...quiet} badge={t('assistant:proposal.badge.replaced', 'Replaced')} lines={[{ icon: 'down', text: t('assistant:proposal.replaced', 'Something else was asked after this. Nothing was changed.') }]} />;
  }
  if (letGo === 'expired') {
    return <ProposalCard {...quiet} badge={t('assistant:proposal.badge.expired', 'Expired')} lines={[{ icon: 'clock', text: t('assistant:proposal.expired', 'This proposal is 30 minutes old. Ask again.') }]} />;
  }
  if (proposal.state === 'refused') {
    return (
      <ProposalCard
        {...quiet}
        icon="mixed"
        iconTone="warn"
        lines={[
          {
            icon: 'warn',
            tone: 'warn',
            text:
              proposal.refusal?.code === 'OVER_CAP'
                ? t('assistant:proposal.overCap', 'That is {count} changes; at most {cap} can be confirmed at once. Use the page’s own bulk tools for more.', {
                    count: proposal.refusal.count ?? proposal.count,
                    cap: proposal.refusal.cap ?? 0,
                  })
                : t('assistant:proposal.refused.generic', 'The server refused this.'),
          },
        ]}
      />
    );
  }

  // ── confirmed ────────────────────────────────────────────────────────────
  if (proposal.state === 'applying' || proposal.state === 'applied' || proposal.state === 'interrupted') {
    const outcome = proposal.outcome ?? { done: [], failed: [], notTried: [], unsure: [] };
    const asked = proposal.picked.map((index) => proposal.actions[index]).filter((action): action is AssistantProposalAction => action !== undefined);
    const done = outcome.done.map((entry) => proposal.actions[entry.index]).filter((action): action is AssistantProposalAction => action !== undefined);
    const labels = (indexes: readonly number[]): string[] => indexes.map((index) => proposal.actions[index]).filter((action): action is AssistantProposalAction => action !== undefined).map((action) => labelOf(action).label);

    if (proposal.state === 'applying') {
      return <ProposalCard {...base} icon={iconOf(sharedKind(asked))} title={askTitle(asked)} sub={sub} spinner={t('assistant:proposal.applying', 'Working…')} />;
    }
    const tokensLeft = undo?.tokens.length ?? 0;
    if (undone !== null && undone > 0 && (tokensLeft === 0 || left <= 0)) {
      return undone >= outcome.done.length ? (
        <ProposalCard {...base} tone="muted" icon="undone" iconTone="muted" title={t('assistant:proposal.undone', 'Undone. Everything is as it was.')} />
      ) : (
        <ProposalCard
          {...base}
          tone="muted"
          icon="undone"
          iconTone="muted"
          title={t('assistant:proposal.undonePart', '{count, plural, one {# change was} other {# changes were}} taken back.', { count: undone })}
          lines={[{ icon: 'info', text: t('assistant:proposal.undoneRest', 'The rest stay as changed.') }]}
        />
      );
    }
    if (proposal.state === 'interrupted') {
      const row = (index: number): { label: string; text: string } => ({ label: labels([index])[0] ?? '—', text: '' });
      return (
        <ProposalCard
          {...base}
          icon="paused"
          iconTone="warn"
          title={t('assistant:proposal.interrupted', 'This stopped part way.')}
          sub={sub}
          groups={[
            { tone: 'pos' as const, icon: 'done' as const, label: t('assistant:proposal.group.done', 'Done'), count: outcome.done.length, rows: outcome.done.map((entry) => row(entry.index)) },
            {
              tone: 'warn' as const,
              icon: 'warn' as const,
              label: t('assistant:proposal.group.check', 'Check this one'),
              count: outcome.unsure.length,
              rows: outcome.unsure.map((index) => ({ ...row(index), text: t('assistant:proposal.group.checkLine', 'The save was cut off. It may or may not have changed.') })),
            },
            { tone: 'muted' as const, icon: 'notTried' as const, label: t('assistant:proposal.group.notTried', 'Not attempted'), count: outcome.notTried.length, rows: outcome.notTried.map(row) },
          ].filter((group) => group.count > 0)}
          {...(onOpenHome === null ? {} : { buttons: [{ id: 'home', label: t('assistant:proposal.openHome', 'Open {page}', { page: homeTitle }), icon: 'open' as const, onClick: onOpenHome }] })}
        />
      );
    }
    const notDone = [...outcome.failed.map((entry) => entry.index), ...outcome.notTried];
    const failedRows: ProposalRow[] = [
      ...outcome.failed.map((entry) => ({ id: `f${String(entry.index)}`, label: labels([entry.index])[0] ?? '—', reason: entry.message })),
      ...outcome.notTried.map((index) => ({ id: `n${String(index)}`, label: labels([index])[0] ?? '—', reason: t('assistant:proposal.notTried', 'Not attempted: too many requests at once. Ask again in a minute.') })),
    ];
    const names = labels(outcome.done.map((entry) => entry.index));
    const tokens = left > 0 ? tokensLeft : 0;
    const buttons: ProposalButton[] = [];
    if (notDone.length > 0) {
      buttons.push({
        id: 'again',
        label: t('assistant:proposal.again', 'Propose the rest again'),
        icon: 'ask',
        disabled: blocked,
        onClick: () => onAsk(t('assistant:proposal.againAsk', 'Propose again the changes that were not made:\n{rows}', { rows: failedRows.map((row) => `${row.label}: ${row.reason ?? ''}`).join('\n') })),
      });
    }
    if (tokens > 0) {
      const seconds = Math.ceil(left / 1000);
      buttons.push({
        id: 'undo',
        label: tokens === outcome.done.length ? t('assistant:proposal.undo', 'Undo') : t('assistant:proposal.undoSome', 'Undo {count} of {total}', { count: tokens, total: outcome.done.length }),
        disabled: phase === 'undoing',
        onClick: takeBack,
        ring: { left: left / UNDO_MS, seconds: seconds >= 60 ? '1:00' : `0:${String(seconds).padStart(2, '0')}` },
      });
    }
    const after: ProposalLine[] = [];
    // Only when this window made the confirmation does it know which changes had an undo.
    if (undo !== null && outcome.done.length > 0) {
      if (undo.given > 0 && left <= 0) after.push({ icon: 'clock', text: t('assistant:proposal.undoPassed', 'The time to undo has passed.'), tone: 'subtle' });
      const without = outcome.done.length - undo.given;
      if (undo.given === 0) after.push({ icon: 'info', text: t('assistant:proposal.noUndo', 'This cannot be undone from here.') });
      else if (without > 0) after.push({ icon: 'info', text: t('assistant:proposal.noUndoSome', '{count, plural, one {# change} other {# changes}} cannot be undone from here.', { count: without }) });
    }
    return (
      <ProposalCard
        {...base}
        testId="assistant-proposal-result"
        tone={notDone.length === 0 ? 'pos' : 'default'}
        icon={notDone.length === 0 ? 'done' : 'mixed'}
        iconTone={notDone.length === 0 ? 'pos' : 'warn'}
        asks={arrived === 'done'}
        title={doneTitle(notDone.length === 0 ? done : asked, outcome.done.length, proposal.picked.length)}
        {...(names.length === 0 ? {} : { sub: names.length <= 3 ? names.join(', ') : undefined })}
        {...(failedRows.length === 0 ? {} : { lines: [{ text: t('assistant:proposal.notChanged', '{count, plural, one {This one was} other {These # were}} not changed:', { count: failedRows.length }) }], rows: failedRows })}
        buttons={buttons}
        after={[...after, ...problemLine]}
      />
    );
  }

  // ── open ─────────────────────────────────────────────────────────────────
  if (cancelled) {
    return <ProposalCard {...quiet} badge={t('assistant:proposal.badge.cancelled', 'Cancelled')} lines={[{ text: t('assistant:proposal.cancelled', 'Nothing was changed.') }]} />;
  }
  if (!atHome) {
    return (
      <ProposalCard
        {...quiet}
        badge={t('assistant:proposal.badge.parked', 'Parked')}
        {...(onOpenHome === null
          ? { lines: [{ icon: 'info' as const, text: t('assistant:proposal.parkedNoHome', 'Go back to {page}, where this was asked, to use it.', { page: homeTitle }) }] }
          : { buttons: [{ id: 'home', label: t('assistant:proposal.parked', 'Open {page} to use this.', { page: homeTitle }), icon: 'open' as const, onClick: onOpenHome }] })}
      />
    );
  }

  const refused = proposal.actions.filter((action) => action.refused !== null).length;
  const pickedActions = picked.map((entry) => entry.action);
  const kind = sharedKind(able.map((entry) => entry.action));
  const title = able.length === 0 ? t('assistant:proposal.noneAble', 'None of this can be done') : askTitle(pickedActions.length === 0 ? able.map((entry) => entry.action) : pickedActions);
  const shared = sharedChange(able.map((entry) => entry.action));
  const busy = phase === 'applying';
  const tickable = able.length > 1;
  const toggle = (index: number) => (): void => {
    // Not while it is being carried out: what was sent is what was ticked then.
    if (busy) return;
    setOff((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };
  const allRows: ProposalRow[] = proposal.actions.map((action, index) => {
    const row = rowOf(action, index, name);
    const isAble = action.refused === null && action.preview !== null;
    const preview = action.preview;
    // In a list that is one sentence, a row says only what it held before.
    const inShared = shared !== null && isAble && preview?.kind === 'change';
    return {
      ...row,
      ...(inShared ? { changes: [], inline: { before: cellText(preview.before[shared.field]), after: shared.after } } : {}),
      ...(tickable && isAble ? { checked: !off.has(index), onToggle: toggle(index) } : {}),
    };
  });
  const open = shared === null || groupOpen;
  const shownRows = open ? allRows.slice(0, ROWS_SHOWN) : [];
  const more = allRows.length - shownRows.length;
  // A send is a card of its own: one mail, who gets it. (The server takes no other shape.)
  const only = proposal.actions.length === 1 ? able[0]?.action.preview : undefined;
  const send = only?.kind === 'send.template' ? only : null;
  const references = referencesText(pickedActions);
  const irreversible = send !== null || references !== null;
  const lines: ProposalLine[] = [
    ...(refused === 0 ? [] : [{ icon: 'warn' as const, tone: 'warn' as const, text: t('assistant:proposal.someRefused', '{refused} of {count, plural, one {# change} other {# changes}} cannot be made.', { refused, count: proposal.actions.length }) }]),
    ...(changed ? [{ icon: 'changed' as const, tone: 'warn' as const, text: t('assistant:proposal.changedSince', 'This changed since you were shown it. Look again before confirming.') }] : []),
    ...problemLine,
  ];
  const buttons: ProposalButton[] = [{ id: 'cancel', label: t('assistant:confirm.cancel', 'Cancel'), disabled: busy, onClick: () => setCancelled(true) }];
  if (refused > 0) {
    buttons.push({ id: 'fix', label: t('assistant:proposal.fix', 'Ask {name} to fix this', { name }), icon: 'ask', disabled: blocked || busy, onClick: () => onAsk(fixRequest(proposal, name)) });
  }
  if (able.length > 0) {
    buttons.push({
      id: 'confirm',
      label: busy ? t('assistant:proposal.applying', 'Working…') : title,
      kind: kind === 'delete' || kind === 'deleteDoc' ? 'danger' : 'primary',
      ...(kind === 'send' ? { icon: 'send' as const } : {}),
      // Not while something else is being asked or answered: the server would let this go.
      disabled: busy || blocked || picked.length === 0 || sessionId === null,
      onClick: confirm,
    });
  }

  return (
    <>
      <ProposalCard
        {...base}
        asks={arrived === 'asked'}
        {...(busy ? {} : { onEscape: () => setCancelled(true) })}
        icon={iconOf(kind)}
        iconTone={kind === 'delete' || kind === 'deleteDoc' ? 'danger' : 'accent'}
        title={title}
        sub={sub}
        {...(send === null
          ? {}
          : {
              facts: [
                { label: t('assistant:proposal.send.template', 'Template'), value: send.name },
                { label: t('assistant:proposal.send.subject', 'Subject'), value: send.subject },
                {
                  label: t('assistant:proposal.send.to', 'To'),
                  value: t('assistant:proposal.send.roles', 'everyone with the role {roles} ({count, plural, one {# person} other {# people}})', { roles: send.roles.map((role) => role.name).join(', '), count: send.total }),
                },
              ],
              ...(onOpenTemplate === undefined ? {} : { link: { label: t('assistant:proposal.send.open', 'Open template'), onClick: () => onOpenTemplate(send.id) } }),
            })}
        lines={lines}
        {...(shared === null
          ? {}
          : {
              group: {
                // Of the rows that are ticked: the sentence is what the button will do.
                label: t('assistant:proposal.group.shared', '{field} {arrow} {value} on {count, plural, one {# row} other {# rows}}', { field: shared.field, arrow: rtl ? '←' : '→', value: shared.after, count: picked.length }),
                open,
                onToggle: () => setGroupOpen(!open),
              },
            })}
        rows={send === null ? shownRows : []}
        {...(references === null ? {} : { danger: references })}
        notes={[
          ...(more > 0 && allRows.length > ROWS_SHOWN ? [{ text: t('assistant:proposal.more', '{count} more. Open large to see them all.', { count: more }), tone: 'subtle' as const }] : []),
          ...(send !== null && send.skipped > 0
            ? [{ icon: 'info' as const, text: t('assistant:proposal.send.skipped', '{count, plural, one {# person has opted out and gets nothing.} other {# people have opted out and get nothing.}}', { count: send.skipped }) }]
            : []),
          ...(irreversible ? [{ icon: 'info' as const, text: t('assistant:proposal.irreversible', 'This cannot be undone.') }] : []),
        ]}
        {...(tickable ? { count: t('assistant:proposal.chosen', '{picked} of {count} chosen', { picked: picked.length, count: able.length }) } : {})}
        {...(allRows.length > ROWS_SHOWN ? { openLarge: { label: t('assistant:proposal.large', 'Open large'), onClick: () => setLarge(true) } } : {})}
        buttons={buttons}
      />
      {large ? (
        <Modal open size="lg" onOpenChange={(next) => (next ? undefined : setLarge(false))}>
          <ModalHeader title={title} closeLabel={t('assistant:close', 'Close')} />
          <ModalBody data-testid="assistant-proposal-sheet" className="max-h-[70vh] overflow-y-auto">
            <ProposalCard {...base} testId="assistant-proposal-all" icon={iconOf(kind)} title={title} sub={sub} rows={allRows} {...(tickable ? { count: t('assistant:proposal.chosen', '{picked} of {count} chosen', { picked: picked.length, count: able.length }) } : {})} />
          </ModalBody>
        </Modal>
      ) : null}
    </>
  );
}
