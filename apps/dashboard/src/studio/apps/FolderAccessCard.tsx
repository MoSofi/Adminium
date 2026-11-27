// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Public access", on the page of an app that runs from the project folder,
 * on a server where a person is the one who allows it: a project with no
 * config file to say so (a trial, or the hosted installation it became),
 * whose apps the Designer writes.
 *
 * Such an app is installed with no public access: its customer screens open
 * and can read or save nothing. This card lists what they would do, in the
 * same words the install check uses, and takes the yes: "Allow this public
 * access". Once it is open the card says what is allowed and can take it
 * back. When the app later asks for more, the more waits here for another
 * yes, and what was allowed goes on as it was.
 *
 * The list is the server's reading of the installed app, never the app's own
 * words for itself, and the yes is sent with the list's checksum: if the app
 * changed in between, the server refuses and the card shows the new list.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, MonoText } from '@adminium/ui';
import { Dot, Globe } from 'lucide-react';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { answerFolderAccess, folderAccessKey, folderAccessQuery, type FolderAccessView } from './appsApi.js';
import { CARD, CardTitle } from './appPageParts.js';
import { PublicAccessAsks, PublicAccessWarnings, publicAccessBlocked } from './PublicAccessInstallCard.js';
import { gainOf } from './PublicWiderCard.js';

type Access = NonNullable<FolderAccessView['publicAccess']>;

/** The entries open now, and those a yes would add: a list each, in the plan's own shape. */
export function splitAccess(view: Access): { open: Access['access']; waiting: Access['access'] } {
  const held = view.access.endpoints.filter((endpoint) => endpoint.onUpdate === 'held');
  const rest = view.access.endpoints.filter((endpoint) => endpoint.onUpdate !== 'held');
  return {
    // What is open is said plainly: the warnings and the keys a yes would make belong to what waits.
    open: { ...view.access, endpoints: held, opensWithoutStaff: [], phoneKey: 'held' },
    waiting: { ...view.access, endpoints: rest },
  };
}

export function FolderAccessCard({ appKey, onChanged, onNotice }: { appKey: string; onChanged: () => Promise<void>; onNotice: (message: string) => void }) {
  const queryClient = useQueryClient();
  const { data } = useQuery(folderAccessQuery(appKey));
  const [error, setError] = useState<string | null>(null);
  const [leftOut, setLeftOut] = useState<{ ref: string; reason: string }[]>([]);

  const answer = useMutation({
    mutationFn: (allow: boolean) => {
      const checksum = data?.publicAccess?.checksum ?? '';
      return answerFolderAccess(appKey, allow ? { allow: true, checksum } : { allow: false });
    },
    onSuccess: async (reply, allow) => {
      setError(null);
      setLeftOut(reply.publicAccess?.skipped ?? []);
      queryClient.setQueryData(folderAccessKey(appKey), reply);
      onNotice(allow ? t('studio:folderAccess.allowed', 'Public access allowed.') : t('studio:folderAccess.takenBack', 'Public access taken back.'));
      await onChanged();
    },
    onError: async (cause: Error) => {
      // The app changed since the list was read: the new list is fetched, and nothing was allowed.
      const stale = cause instanceof ApiError && cause.status === 409;
      setError(stale ? t('studio:folderAccess.changed', 'The app changed since this list was shown. Check it again, then allow it.') : cause.message);
      if (stale) await queryClient.invalidateQueries({ queryKey: folderAccessKey(appKey) });
    },
  });

  const view = data?.publicAccess ?? null;
  // Somewhere a person does not decide, or an app that asks for nothing: no card.
  if (data === undefined || data.decides !== 'person' || view === null) return null;

  const { open, waiting } = splitAccess(view);
  const asksMore = view.waiting > 0;
  const blocked = publicAccessBlocked(waiting);
  const busy = answer.isPending;

  return (
    <section className={CARD} aria-labelledby="app-folder-access-title" data-testid="app-folder-access" data-state={view.open ? (asksMore ? 'more' : 'open') : 'closed'}>
      <CardTitle icon={<Globe />}>
        <span id="app-folder-access-title">{t('studio:appPublicAccess.title', 'Public access')}</span>
      </CardTitle>

      {view.open && open.endpoints.length > 0 ? (
        <div data-role="folder-access-open">
          <p className="mb-2.5 text-[12.5px] leading-[1.5] text-fg-muted">
            {t('studio:folderAccess.openIntro', 'Allowed. The app’s customer screens can:')}
          </p>
          <PublicAccessAsks access={open} />
        </div>
      ) : null}

      {asksMore ? (
        <div data-role="folder-access-waiting">
          <p className="mb-2.5 text-[12.5px] leading-[1.5] text-fg-muted">
            {view.open
              ? t('studio:folderAccess.moreIntro', 'The app now asks for more. Until someone allows it, its customer screens go on with what was allowed. They would also:')
              : t('studio:folderAccess.closedIntro', 'Nobody has allowed this yet, so the app’s customer screens open and can read or save nothing. They need to:')}
          </p>
          <PublicAccessAsks access={waiting} />
          {view.wider.length > 0 ? (
            <div data-role="folder-access-wider">
              <p className="mb-2 text-[12.5px] leading-[1.5] text-fg-muted">
                {t('studio:folderAccess.widerIntro', 'And where they already can, they would see or do more:')}
              </p>
              <ul className="mb-[13px] flex flex-col gap-[7px]">
                {view.wider.map((row) => (
                  <li key={row.ref} className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] leading-[1.45]" data-endpoint={row.ref}>
                    <Dot aria-hidden className="size-3.5 shrink-0 self-center text-warn" />
                    <MonoText className="font-bold">{row.ref}</MonoText>
                    <span className="text-fg-muted">{gainOf(row)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {error === null ? null : (
        <div className="mb-3">
          <Alert tone="danger" title={t('studio:folderAccess.failed', 'Public access was not changed')}>
            {error}
          </Alert>
        </div>
      )}
      {leftOut.length === 0 ? null : (
        <div className="mb-3" data-role="folder-access-left-out">
          <Alert tone="warn" title={t('studio:folderAccess.leftOut', 'Allowed, with this left out:')}>
            <ul className="flex flex-col gap-1">
              {leftOut.map((entry) => (
                <li key={entry.ref}>
                  <MonoText>{entry.ref}</MonoText>: {entry.reason}
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-[9px]">
        {asksMore ? (
          <Button disabled={busy || blocked} onClick={() => answer.mutate(true)} data-role="folder-access-allow">
            {t('studio:appPublicAccess.allow', 'Allow this public access')}
          </Button>
        ) : null}
        {view.open ? (
          <Button variant="secondary" disabled={busy || !view.access.canGrant} onClick={() => answer.mutate(false)} data-role="folder-access-take-back">
            {t('studio:folderAccess.takeBack', 'Take it back')}
          </Button>
        ) : null}
      </div>
      <p className="mt-[9px] text-[11.5px] leading-[1.45] text-fg-subtle">
        {!view.access.canGrant
          ? t('studio:publicWider.notYours', 'Only someone who may manage API keys can allow this.')
          : view.open
            ? t('studio:folderAccess.takeBackHelp', 'Taking it back closes the app’s customer screens to everyone at once. You can allow it again here.')
            : t('studio:folderAccess.allowHelp', 'Anyone who can open the app’s customer screens can then do this, with no sign-in. You can take it back here.')}
      </p>
      <PublicAccessWarnings access={view.access} />
    </section>
  );
}
