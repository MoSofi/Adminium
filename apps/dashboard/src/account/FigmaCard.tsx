// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The person's Figma connection on their Security page (plan 69, P2-T07; comp `designs/plan-69/Files
 * And Record Files Screen.dc.html`, frames 2s-a to 2s-c), so a token can be seen and taken off without
 * starting an import. It reads the same route as the Designer's "From Figma…" dialog.
 *
 * Connecting happens in the Designer (that is where a token is first needed); here a token is
 * changed in a field of the card (ruled R4) or disconnected, which asks first (R3). A person who
 * cannot use the Designer has no Figma connection, and sees no card.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Frame, Lock } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Button, Card, IconTile } from '@adminium/ui';

import { ApiError } from '../app/api.js';
import { designerApi, designerKeys, figmaQuery } from '../designer/api.js';
import { DisconnectFigma } from '../designer/parts/DisconnectFigma.js';
import { VALUE_MARK, withValue } from '../designer/parts/sentence.js';
import type { FigmaRefusal } from '../designer/api.js';
import { t } from '../i18n/t.js';

export function FigmaCard(): ReactNode {
  const queryClient = useQueryClient();
  const status = useQuery(figmaQuery());
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState('');
  const [refused, setRefused] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const ids = useId();

  const save = useMutation({
    mutationFn: (value: string) => designerApi.saveFigmaToken(value),
    onSuccess: (next) => {
      queryClient.setQueryData(designerKeys.figma, next);
      setEditing(false);
      setToken('');
    },
    onError: (error) => {
      const figma = error instanceof ApiError ? ((error.details ?? {}) as { figma?: FigmaRefusal }).figma : undefined;
      setRefused(
        figma === undefined || figma.kind === 'token'
          ? t('security.figma.refused', 'Figma did not accept this token. Check it and paste it again.')
          : figma.kind === 'network-off'
            ? t('security.figma.off', 'Figma is off on this server: network features are turned off.')
            : t('security.figma.unreachable', 'Figma did not answer. Try again in a moment.'),
      );
    },
  });
  const disconnect = useMutation({
    mutationFn: () => designerApi.removeFigma(),
    onSuccess: (next) => {
      queryClient.setQueryData(designerKeys.figma, next);
      setAsking(false);
      setEditing(false);
    },
  });

  // Asked, and refused (no Designer for this person, or none on this server): no card.
  if (status.data === undefined) return null;
  const data = status.data;
  const connected = data.connected && data.source === 'mine';
  const submit = (): void => {
    if (token.trim() === '' || save.isPending) return;
    setRefused(null);
    save.mutate(token.trim());
  };

  return (
    <Card aria-labelledby={`${ids}-title`} data-testid="security-figma">
      <div className="flex flex-wrap items-start gap-3.5">
        <IconTile tone="neutral" size="md" icon={<Frame />} />
        <div className="min-w-[200px] flex-1">
          <h2 id={`${ids}-title`} className="m-0 text-[14px] font-bold text-fg">
            {t('security.figma.title', 'Figma')}
          </h2>
          {data.source === 'environment' ? (
            <p className="m-0 mt-0.5 text-[12.5px] leading-normal text-fg-muted">{t('security.figma.environment', "Using the Figma token set in this project's environment.")}</p>
          ) : connected ? (
            <>
              <p className="m-0 mt-0.5 text-[13px] leading-normal text-fg">
                {withValue(
                  t('security.figma.connectedAs', 'Connected to Figma as {handle}', { handle: VALUE_MARK }),
                  <span dir="ltr" className="font-mono font-semibold">
                    {data.handle}
                  </span>,
                )}
              </p>
              <p className="m-0 mt-1.5 flex items-start gap-1.5 text-[12.5px] leading-normal text-fg-muted">
                <Lock aria-hidden="true" className="mt-[3px] size-[13px] shrink-0" />
                {t('security.figma.kept', 'Kept encrypted on this server for you only. Only your own imports use it.')}
              </p>
            </>
          ) : (
            <p className="m-0 mt-0.5 text-[12.5px] leading-normal text-fg-muted">{t('security.figma.none', "Not connected. Connect Figma from the Designer's Attach menu, From Figma…")}</p>
          )}
        </div>
        {connected ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              className="min-h-9 font-bold"
              onClick={() => {
                setEditing(true);
                setRefused(null);
              }}
            >
              {t('security.figma.changeToken', 'Change token')}
            </Button>
            <Button variant="secondary" className="min-h-9 font-bold text-danger hover:bg-danger-soft" onClick={() => setAsking(true)}>
              {t('security.figma.disconnect', 'Disconnect')}
            </Button>
          </div>
        ) : null}
      </div>
      {editing && connected ? (
        <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-4">
          <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
            <label htmlFor={`${ids}-token`} className="text-[12px] font-semibold">
              {t('security.figma.newToken', 'New token')}
            </label>
            <input
              id={`${ids}-token`}
              type="password"
              autoFocus
              value={token}
              placeholder="figd_…"
              spellCheck={false}
              autoComplete="off"
              dir="ltr"
              aria-invalid={refused !== null}
              aria-describedby={refused === null ? undefined : `${ids}-error`}
              onChange={(event) => {
                setToken(event.target.value);
                setRefused(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submit();
                }
              }}
              className={`rounded-[10px] border px-3 py-2.5 font-mono text-[13px] text-fg outline-none focus-visible:outline-2 focus-visible:outline-accent ${refused === null ? 'border-border-strong bg-surface-2' : 'border-danger bg-danger-soft'}`}
            />
          </div>
          <Button
            variant="secondary"
            className="h-[42px] font-bold"
            onClick={() => {
              setEditing(false);
              setToken('');
              setRefused(null);
            }}
          >
            {t('security.figma.cancel', 'Cancel')}
          </Button>
          <Button className="h-[42px] font-bold" disabled={token.trim() === '' && !save.isPending} loading={save.isPending} onClick={submit}>
            {t('security.figma.saveToken', 'Save token')}
          </Button>
          {refused === null ? null : (
            <div id={`${ids}-error`} role="alert" className="flex w-full items-start gap-1.5 text-[12.5px] font-semibold leading-normal text-danger">
              <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span>{refused}</span>
            </div>
          )}
        </div>
      ) : null}
      <DisconnectFigma
        open={asking}
        onOpenChange={setAsking}
        busy={disconnect.isPending}
        onConfirm={() => disconnect.mutate()}
        words={{
          title: t('security.figma.disconnectTitle', 'Disconnect Figma?'),
          body: t('security.figma.disconnectBody', 'Your imports already in the Designer stay.'),
          cancel: t('security.figma.cancel', 'Cancel'),
          disconnect: t('security.figma.disconnect', 'Disconnect'),
          close: t('security.figma.close', 'Close'),
        }}
      />
    </Card>
  );
}
