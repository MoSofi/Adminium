// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Settings → Connections: "Allow databases on this server"
 * (Trial Mode comp, view 7, lines 305–313).
 *
 * A production server refuses a source database on its own loopback, because
 * with host networking that is every service on the box. The operator can
 * name the one database it runs there (`ADMINIUM_DATABASE_HOSTS`); this
 * switch is the other way in, for the person who set Postgres up next to
 * Adminium. Two hands, like the live Designer's switch (`DesignerLiveCard`):
 * the operator lets it exist (`ADMINIUM_LOCAL_DATABASES`), and a Super Admin
 * switches it on with their password.
 *
 * Three states, as the comp draws them:
 *   off     the switch, the help line.
 *   on      the switch on, and "Turned on by {name}, {date}" with `history`.
 *   locked  the operator set `ADMINIUM_LOCAL_DATABASES=off`, or runs a trial or a
 *           hosted installation: the chip "Set by the operator"
 *           (`settings/SetByOperator.tsx`), the switch OFF and disabled (never drawn on: the
 *           plan's ruling over the comp's drawing, H1-D12a), and the hosts the
 *           operator allows. Never hidden, always explained: the switch stays
 *           in the tab order with `aria-disabled` and points at that line.
 *
 * Someone who is not a Super Admin gets a 403 and no card.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, History } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Button, Card, CardBody, CardHeader, FormField, IconTile, Input, Switch } from '@adminium/ui';

import { api, ApiError } from '../../app/api.js';
import { getI18nInstance, t } from '../../i18n/t.js';
import { isSetByOperator, SetByOperatorChip } from '../../settings/SetByOperator.js';

export interface LocalDatabases {
  allowed: boolean;
  on: boolean;
  /** Set by the operator: `not-allowed` (`ADMINIUM_LOCAL_DATABASES=off`), `trial-mode` or `hosted-mode`. */
  reason: string | null;
  hosts: string[];
  turnedOn: { by: string; at: number } | null;
  loopbackAllowed: boolean;
}

export const LOCAL_DATABASES_KEY = ['settings', 'local-databases'] as const;
const PATH = '/api/v1/settings/local-databases';

function refusal(error: unknown): string {
  const reason = error instanceof ApiError ? (error.details as { reason?: unknown } | undefined)?.reason : undefined;
  if (reason === 'PASSWORD') return t('studio:settingsHub.localDatabases.wrongPassword', 'That is not your password.');
  if (isSetByOperator(error) || reason === 'not-allowed') return t('studio:settingsHub.localDatabases.lockedRefused', 'The server’s operator has locked this off.');
  return t('studio:settingsHub.localDatabases.failed', 'The switch could not be changed. Try again.');
}

/** "Turned on by {name}, {date}": day and short month, in the reader's order ("Nov 10" in en-US, "10 Nov" in en-GB). */
function turnedOnLine(turnedOn: { by: string; at: number }): string {
  const date = new Intl.DateTimeFormat(getI18nInstance()?.language ?? 'en-US', { day: 'numeric', month: 'short' }).format(new Date(turnedOn.at));
  return t('studio:settingsHub.localDatabases.turnedOn', 'Turned on by {name}, {date}', { name: turnedOn.by, date });
}

/** A host as the comp draws it in the locked line: mono, on a chip. */
function HostChip({ host }: { host: string }): ReactNode {
  return <code className="rounded-[5px] bg-surface-3 px-1.5 py-px font-mono text-[12px] text-fg">{host}</code>;
}

export function LocalDatabasesCard(): ReactNode {
  const queryClient = useQueryClient();
  const state = useQuery({ queryKey: LOCAL_DATABASES_KEY, queryFn: () => api.get<LocalDatabases>(PATH), retry: false, staleTime: 30_000 });
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState('');
  const [refused, setRefused] = useState<string | null>(null);
  const ids = useId();
  const labelId = `${ids}-label`;
  const helpId = `${ids}-help`;
  const lockedId = `${ids}-locked`;

  const change = useMutation({
    mutationFn: (input: { on: boolean; password?: string }) => api.put<LocalDatabases>(PATH, input),
    onSuccess: (next) => {
      queryClient.setQueryData(LOCAL_DATABASES_KEY, next);
      setAsking(false);
      setPassword('');
      setRefused(null);
    },
    onError: (error) => setRefused(refusal(error)),
  });

  // Not there for someone who is not a Super Admin (403), nor on a server too old to have it (404).
  if (state.data === undefined || typeof state.data.allowed !== 'boolean' || !Array.isArray(state.data.hosts)) return null;
  const current = state.data;
  const locked = !current.allowed;
  const checked = !locked && (current.on || asking);

  const help = (
    <p id={helpId} className="m-0 text-[12.5px] leading-normal text-fg-muted">
      {(() => {
        const [before = '', after = ''] = t(
          'studio:settingsHub.localDatabases.help',
          'Lets connections reach databases running on this same server, like {example}. Only for databases you set up here.',
          { example: '\u0000' },
        ).split('\u0000');
        return (
          <>
            {before}
            <code className="font-mono text-[12px]">localhost:5432</code>
            {after}
          </>
        );
      })()}
    </p>
  );

  return (
    <Card padded={false} data-testid="local-databases-card">
      <CardHeader className="flex items-center justify-start gap-3">
        <IconTile tone="accent" size="md" icon={<Database />} />
        <div className="min-w-0 flex-1">
          <h3 className="text-section text-fg">{t('studio:settingsHub.localDatabases.heading', 'Connections')}</h3>
          <p className="m-0 text-caption text-fg-subtle">{t('studio:settingsHub.localDatabases.subtitle', 'Databases this installation reads and writes.')}</p>
        </div>
      </CardHeader>
      <CardBody>
        <div className="flex items-start gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
            <div className="flex flex-wrap items-center gap-2">
              <span id={labelId} className="text-[13.5px] font-bold text-fg">
                {t('studio:settingsHub.localDatabases.label', 'Allow databases on this server')}
              </span>
              {locked ? <SetByOperatorChip data-testid="local-databases-locked" /> : null}
            </div>
            {help}
            {current.loopbackAllowed ? (
              <p className="m-0 text-[12.5px] text-fg-muted">
                {t('studio:settingsHub.localDatabases.alwaysHere', 'This server already reaches databases on this machine, so this switch changes nothing here.')}
              </p>
            ) : null}
            {locked ? (
              <p id={lockedId} className="m-0 text-[12.5px] text-fg-muted">
                {current.hosts.length === 0 ? (
                  t('studio:settingsHub.localDatabases.lockedNone', 'The operator allows no databases on this server.')
                ) : (
                  <>
                    {t('studio:settingsHub.localDatabases.lockedHosts', 'The operator allows only these hosts:')}{' '}
                    {current.hosts.map((host, i) => (
                      <span key={host}>
                        {i === 0 ? null : ' '}
                        <HostChip host={host} />
                      </span>
                    ))}
                  </>
                )}
              </p>
            ) : null}
            {!locked && current.on && current.turnedOn !== null ? (
              <p className="m-0 mt-0.5 flex items-center gap-1.5 text-[11.5px] text-fg-subtle" data-testid="local-databases-audit">
                <History aria-hidden="true" className="size-[13px] shrink-0" />
                {turnedOnLine(current.turnedOn)}
              </p>
            ) : null}
          </div>
          <Switch
            className="mt-0.5 aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
            checked={checked}
            aria-labelledby={labelId}
            aria-describedby={locked ? `${helpId} ${lockedId}` : helpId}
            // Disabled the way a keyboard can still reach and read: the reason is the line it points at.
            {...(locked ? { 'aria-disabled': true } : {})}
            onCheckedChange={(next) => {
              if (locked || change.isPending) return;
              setRefused(null);
              if (next) setAsking(true);
              else {
                setAsking(false);
                setPassword('');
                if (current.on) change.mutate({ on: false });
              }
            }}
          />
        </div>
        {asking && !current.on && !locked ? (
          <form
            className="mt-3 flex flex-wrap items-end gap-2.5"
            onSubmit={(event) => {
              event.preventDefault();
              if (password !== '') change.mutate({ on: true, password });
            }}
          >
            <FormField label={t('studio:settingsHub.localDatabases.password', 'Your password, to switch it on')} className="min-w-[220px] flex-1">
              <Input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </FormField>
            <Button type="submit" disabled={password === '' || change.isPending}>
              {t('studio:settingsHub.localDatabases.switchOn', 'Switch it on')}
            </Button>
          </form>
        ) : null}
        {refused !== null ? (
          <p role="alert" className="m-0 mt-2 text-caption font-semibold text-danger">
            {refused}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
