// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A workspace's mail sender: the Sheet on the workspace's row ("Sender").
 *
 * No comp draws it; it is built from the plan's notes with the kit's Sheet
 * and the comps' own patterns: a narrow sheet, the fields stacked, the
 * accepted places in an info callout above them, the shared do-not-email
 * list said once at the foot, Save in the footer.
 *
 *  - Name, From, reply-to and postal address. The From makes the sender:
 *    without one the workspace's mail goes as the server's.
 *  - The From must be an address the server's mail settings can send for.
 *    The sheet lists those places up front, refuses another before asking,
 *    and words the server's 422 the same way when it refuses after all.
 *  - "Use the server's sender" clears it.
 *
 * Self-contained: it reads and writes its own routes and is opened by the
 * button `opener` draws, so whoever owns the workspace's row mounts it there.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Send } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Alert, Button, FormField, Input, Sheet, SheetFooter, SheetHeader, Spinner, Textarea } from '@adminium/ui';

import { getI18nInstance, t } from '../../i18n/t.js';
import { checkDraft, refusalOf, senderApi, sendingDomainsQuery, type SenderDraft, type SenderRefusal, type SenderWorkspace, type SendingDomains } from './senderApi.js';

export interface WorkspaceSenderSheetProps {
  /** The workspace, with the sender it has now. */
  workspace: SenderWorkspace;
  /** Draws what opens the sheet (the row's "Sender" button), given the function that opens it. */
  opener: (open: () => void) => ReactNode;
  /** Told after a save or a clear, with the workspace as the server now has it. */
  onSaved?: ((workspace: SenderWorkspace) => void) | undefined;
  /** Stories and tests: open from the first render. */
  defaultOpen?: boolean | undefined;
  /** Stories and tests: a refusal shown from the first render. */
  defaultRefusal?: SenderRefusal | null | undefined;
  /** Stories and tests: what the fields hold from the first render. */
  defaultDraft?: SenderDraft | undefined;
}

function draftOf(workspace: SenderWorkspace): SenderDraft {
  const { sender } = workspace;
  return { name: sender.name ?? '', from: sender.from ?? '', replyTo: sender.replyTo ?? '', postal: sender.postal ?? '' };
}

/** A list in the reader's language ("a, b and c"). */
function listOf(items: readonly string[]): string {
  try {
    return new Intl.ListFormat((getI18nInstance()?.language ?? 'en-US').replace(/_/g, '-'), { style: 'long', type: 'disjunction' }).format(items);
  } catch {
    return items.join(', ');
  }
}

/** A refusal in words. */
export function refusalText(refusal: SenderRefusal): string {
  if (refusal.code === 'not-a-sending-domain') {
    return t('studio:workspaceSender.refusal.notSendingDomain', 'This server can only send from {accepted}. Use an address there.', { accepted: listOf(refusal.accepted) });
  }
  if (refusal.code === 'no-mail') return t('studio:workspaceSender.refusal.noMail', 'This server has no sender yet. Set up e-mail in Settings first.');
  return t('studio:workspaceSender.refusal.notAnAddress', 'Enter one e-mail address, such as hello@example.com.');
}

function AcceptedPlaces({ sending }: { sending: SendingDomains }) {
  if (sending.domains.length === 0 && sending.addresses.length === 0) {
    return (
      <Alert
        tone="warn"
        data-testid="workspace-sender-no-mail"
        title={t('studio:workspaceSender.noMail.title', 'This server has no sender yet')}
        body={t('studio:workspaceSender.noMail.body', 'Set up e-mail in Settings first. Until then, a workspace cannot have a sender of its own.')}
        action={
          <a href="/studio/settings#email" className="text-[12.5px] font-bold text-accent underline-offset-2 hover:underline">
            {t('studio:workspaceSender.noMail.action', 'Open e-mail settings')}
          </a>
        }
      />
    );
  }
  const loose = sending.addresses.filter((address) => !sending.domains.some((domain) => address.endsWith(`@${domain}`)));
  return (
    <Alert
      tone="info"
      data-testid="workspace-sender-accepted"
      title={t('studio:workspaceSender.accepted.title', 'Addresses this server can send from')}
      body={
        <span className="flex flex-col gap-1">
          {sending.domains.length === 0 ? null : (
            <span>
              {t('studio:workspaceSender.accepted.domains', 'Any address at:')}{' '}
              <span dir="ltr" className="font-mono text-[12px] font-semibold">
                {sending.domains.join(', ')}
              </span>
            </span>
          )}
          {loose.length === 0 ? null : (
            <span>
              {t('studio:workspaceSender.accepted.addresses', 'Or exactly:')}{' '}
              <span dir="ltr" className="font-mono text-[12px] font-semibold">
                {loose.join(', ')}
              </span>
            </span>
          )}
        </span>
      }
    />
  );
}

export function WorkspaceSenderSheet({ workspace, opener, onSaved, defaultOpen = false, defaultRefusal = null, defaultDraft }: WorkspaceSenderSheetProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(defaultOpen);
  const [draft, setDraft] = useState<SenderDraft>(defaultDraft ?? draftOf(workspace));
  const [refusal, setRefusal] = useState<SenderRefusal | null>(defaultRefusal);
  const [failed, setFailed] = useState(false);
  const sending = useQuery({ ...sendingDomainsQuery(), enabled: open });
  const formId = useId();
  const hasSender = workspace.sender.from !== null;

  const openSheet = () => {
    setDraft(draftOf(workspace));
    setRefusal(null);
    setFailed(false);
    setOpen(true);
  };

  const done = (saved: SenderWorkspace) => {
    void queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    onSaved?.(saved);
    setOpen(false);
  };

  const save = useMutation({
    mutationFn: () => senderApi.save(workspace.id, draft),
    onSuccess: done,
    onError: (error) => {
      const said = refusalOf(error);
      setRefusal(said);
      setFailed(said === null);
    },
  });
  const clear = useMutation({ mutationFn: () => senderApi.clear(workspace.id), onSuccess: done, onError: () => setFailed(true) });
  const busy = save.isPending || clear.isPending;

  const submit = () => {
    setFailed(false);
    const found = checkDraft(draft, sending.data);
    setRefusal(found);
    if (found === null) save.mutate();
  };
  const set = (patch: Partial<SenderDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    if (refusal !== null && (('from' in patch && refusal.field === 'from') || ('replyTo' in patch && refusal.field === 'replyTo'))) setRefusal(null);
  };

  const fromError = refusal?.field === 'from' ? <span data-testid="workspace-sender-from-error">{refusalText(refusal)}</span> : undefined;
  const replyError = refusal?.field === 'replyTo' ? refusalText(refusal) : undefined;

  return (
    <>
      {opener(openSheet)}
      <Sheet open={open} onOpenChange={(next) => (busy ? undefined : setOpen(next))} maxWidth={600}>
        <SheetHeader
          icon={<Mail />}
          title={t('studio:workspaceSender.title', 'Sender for {workspace}', { workspace: workspace.name })}
          subtitle={t('studio:workspaceSender.subtitle', 'Mail about the records in this workspace’s databases goes from this sender.')}
          closeLabel={t('studio:workspaceSender.close', 'Close')}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <form
            id={formId}
            data-testid="workspace-sender-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
            className="flex flex-col gap-4 px-5 py-5"
          >
            {sending.isPending ? (
              <div className="flex justify-center py-2">
                <Spinner label={t('studio:workspaceSender.loading', 'Loading')} />
              </div>
            ) : sending.data === undefined ? null : (
              <AcceptedPlaces sending={sending.data} />
            )}
            <FormField label={t('studio:workspaceSender.name.label', 'Sender name')} helper={t('studio:workspaceSender.name.helper', 'Who the mail says it is from, such as Kiln Street Pottery.')}>
              <Input data-testid="workspace-sender-name" value={draft.name} maxLength={120} autoComplete="organization" onChange={(event) => set({ name: event.target.value })} />
            </FormField>
            <FormField
              required
              label={t('studio:workspaceSender.from.label', 'From address')}
              helper={t('studio:workspaceSender.from.helper', 'An address at one of the places above.')}
              error={fromError}
            >
              <Input
                data-testid="workspace-sender-from"
                type="email"
                dir="ltr"
                mono
                value={draft.from}
                maxLength={320}
                autoComplete="email"
                error={fromError !== undefined}
                onChange={(event) => set({ from: event.target.value })}
              />
            </FormField>
            <FormField label={t('studio:workspaceSender.replyTo.label', 'Reply-to')} helper={t('studio:workspaceSender.replyTo.helper', 'Where replies go. Leave it blank for the From address.')} error={replyError}>
              <Input
                data-testid="workspace-sender-reply-to"
                type="email"
                dir="ltr"
                mono
                value={draft.replyTo}
                maxLength={254}
                autoComplete="email"
                error={replyError !== undefined}
                onChange={(event) => set({ replyTo: event.target.value })}
              />
            </FormField>
            <FormField
              label={t('studio:workspaceSender.postal.label', 'Postal address')}
              helper={t('studio:workspaceSender.postal.helper', 'Printed at the foot of this workspace’s marketing mail. Leave it blank for the server’s.')}
            >
              <Textarea data-testid="workspace-sender-postal" value={draft.postal} maxLength={300} rows={3} autoComplete="street-address" onChange={(event) => set({ postal: event.target.value })} />
            </FormField>
            <p className="text-[12px] leading-[1.5] text-fg-muted" data-testid="workspace-sender-shared-list">
              {t(
                'studio:workspaceSender.sharedList',
                'The do-not-email list belongs to the whole server: someone who unsubscribes from one business gets no marketing mail from any business on it.',
              )}
            </p>
          </form>
        </div>
        <SheetFooter>
          <div role="status" className={`min-w-0 text-[12px] ${failed ? 'text-danger' : 'text-fg-muted'}`} data-testid="workspace-sender-status">
            {failed
              ? t('studio:workspaceSender.failed', 'The sender could not be saved. Try again.')
              : hasSender
                ? t('studio:workspaceSender.footer.own', 'Its mail goes from {from}.', { from: workspace.sender.from })
                : t('studio:workspaceSender.footer.server', 'Until a From address is saved, its mail goes from the server’s sender.')}
          </div>
          <div className="ms-auto flex flex-wrap justify-end gap-[9px]">
            {hasSender ? (
              <Button type="button" variant="ghost" data-testid="workspace-sender-clear" disabled={busy} onClick={() => clear.mutate()}>
                {t('studio:workspaceSender.clear', 'Use the server’s sender')}
              </Button>
            ) : null}
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
              {t('studio:workspaceSender.cancel', 'Cancel')}
            </Button>
            <Button type="submit" form={formId} data-testid="workspace-sender-save" disabled={busy} aria-busy={save.isPending}>
              <Send aria-hidden="true" className="size-4" />
              {t('studio:workspaceSender.save', 'Save sender')}
            </Button>
          </div>
        </SheetFooter>
      </Sheet>
    </>
  );
}
