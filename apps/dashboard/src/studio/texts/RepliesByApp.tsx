// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Each app's replies switch, for the holder of the Texts set-up right
 * (`GET/PUT /texts/replies`).
 *
 * On: a customer's reply to that app's texts is kept as a conversation. Off:
 * it is not kept at all, and the sender gets one fixed answer saying the
 * number is not read, at most once a month. An app's manifest says where its
 * switch starts: Clinic starts off, because patients may text symptoms, so
 * turning such an app on asks first and says why.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquareOff } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Alert, Badge, Button, Drawer, DrawerBody, DrawerHeader, Modal, ModalBody, ModalFooter, ModalHeader, Skeleton, Switch } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { setReplies, switchesKey, switchesQuery, threadsKey, type RepliesSwitch } from './conversationsApi.js';
import { failureWords } from './conversationWords.js';
import { activeLocale, stamp } from './textsWords.js';

function Row({ one, onAsk, busy, onFlip }: { one: RepliesSwitch; onAsk: (one: RepliesSwitch) => void; busy: boolean; onFlip: (one: RepliesSwitch, next: 'on' | 'off') => void }) {
  const id = `texts-replies-${one.app}`;
  return (
    <li className="flex flex-col gap-1.5 border-b border-border py-3 last:border-b-0" data-testid="texts-replies-row" data-app={one.app}>
      <div className="flex items-center gap-3">
        <label htmlFor={id} className="min-w-0 flex-1 text-[13.5px] font-semibold">
          {one.name}
        </label>
        <Badge tone={one.replies === 'on' ? 'pos' : 'neutral'}>{one.replies === 'on' ? t('studio:texts.replies.on', 'Replies kept') : t('studio:texts.replies.off', 'Replies off')}</Badge>
        <Switch
          id={id}
          checked={one.replies === 'on'}
          disabled={busy}
          onCheckedChange={(checked) => (checked && one.starts === 'off' ? onAsk(one) : onFlip(one, checked ? 'on' : 'off'))}
          data-testid="texts-replies-switch"
        />
      </div>
      {one.starts === 'off' ? (
        <p className="text-[12px] text-fg-muted" data-testid="texts-replies-starts-off">
          {t('studio:texts.replies.startsOff', 'Off when installed: customers of this app may text things as private as symptoms.')}
        </p>
      ) : null}
      {one.changedBy !== null && one.changedAt !== null ? (
        <p className="text-[11.5px] text-fg-subtle">
          {t('studio:texts.replies.changedBy', 'Changed by {name}', { name: one.changedBy.label })}{' '}
          <bdi dir="ltr" className="font-mono">
            {stamp(one.changedAt, activeLocale())}
          </bdi>
        </p>
      ) : null}
    </li>
  );
}

function TurnOn({ one, busy, onClose, onYes }: { one: RepliesSwitch; busy: boolean; onClose: () => void; onYes: () => void }) {
  return (
    <Modal open size="sm" role="alertdialog" onOpenChange={(open) => (open || busy ? undefined : onClose())}>
      <ModalHeader tone="warn" title={t('studio:texts.replies.askTitle', 'Keep replies to {app}?', { app: one.name })} closeLabel={t('studio:texts.close', 'Close')} />
      <ModalBody className="flex flex-col gap-2 text-[13px]" data-testid="texts-replies-ask">
        <p>{t('studio:texts.replies.askBody', 'This app starts with replies off because its customers may text things as private as symptoms. Once on, whatever they write is kept here for a year and can be read by everyone allowed to read this app’s texts.')}</p>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" autoFocus disabled={busy} onClick={onClose}>
          {t('studio:texts.cancel', 'Cancel')}
        </Button>
        <Button loading={busy} onClick={onYes} data-testid="texts-replies-ask-yes">
          {t('studio:texts.replies.askYes', 'Turn replies on')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export function RepliesByApp({ onClose }: { onClose: () => void }): ReactNode {
  const client = useQueryClient();
  const switches = useQuery(switchesQuery());
  const [asking, setAsking] = useState<RepliesSwitch | null>(null);
  const flip = useMutation({
    mutationFn: (input: { app: string; replies: 'on' | 'off' }) => setReplies(input.app, input.replies),
    onSuccess: () => {
      setAsking(null);
      void client.invalidateQueries({ queryKey: switchesKey });
      void client.invalidateQueries({ queryKey: threadsKey });
    },
  });
  const apps = switches.data?.apps ?? [];
  return (
    <Drawer open size="md" onOpenChange={(open) => (open ? undefined : onClose())}>
      <DrawerHeader icon={<MessageSquareOff />} title={t('studio:texts.replies.title', 'Replies by app')} subtitle={t('studio:texts.replies.subtitle', 'Whether a customer’s reply to an app’s texts is kept as a conversation.')} closeLabel={t('studio:texts.close', 'Close')} />
      <DrawerBody className="flex flex-col gap-3 text-[13px]" data-testid="texts-replies">
        <p className="text-fg-muted" data-testid="texts-replies-not-read">
          {t('studio:texts.replies.notRead', 'When an app’s replies are off, the reply is not kept. The sender gets one fixed answer, at most once a month: “This number is not read”, with your phone or e-mail. A STOP still works.')}
        </p>
        {flip.isError ? <Alert tone="danger" role="alert" title={t('studio:texts.saveFailed', 'This could not be saved')} body={failureWords(flip.error)} /> : null}
        {switches.isError ? (
          <Alert tone="danger" role="alert" title={t('studio:texts.loadFailed', 'This could not be loaded')} body={failureWords(switches.error)} />
        ) : switches.data === undefined ? (
          <Skeleton className="h-[160px] w-full" />
        ) : apps.length === 0 ? (
          <p data-testid="texts-replies-none">{t('studio:texts.replies.none', 'No app is installed yet.')}</p>
        ) : (
          <ul>
            {apps.map((one) => (
              <Row key={one.app} one={one} busy={flip.isPending} onAsk={setAsking} onFlip={(row, next) => flip.mutate({ app: row.app, replies: next })} />
            ))}
          </ul>
        )}
        {switches.data === undefined ? null : (
          <p className="text-[12px] text-fg-muted" data-testid="texts-replies-no-app">
            {switches.data.noApp === 'on'
              ? t('studio:texts.replies.noAppOn', 'A reply to a text no app sent is kept too.')
              : t('studio:texts.replies.noAppOff', 'A reply to a text no app sent is not kept, because some app here has its replies off.')}
          </p>
        )}
      </DrawerBody>
      {asking === null ? null : <TurnOn one={asking} busy={flip.isPending} onClose={() => setAsking(null)} onYes={() => flip.mutate({ app: asking.app, replies: 'on' })} />}
    </Drawer>
  );
}
