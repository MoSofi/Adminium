// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings → AI: the live Designer's switch (Designer Pieces, piece 3).
 *
 * Adminium Designer lets a person have a model write an app into this
 * server's project, and with a yes each time, server code. On a server
 * people reach over a network that is three steps away: the operator allows
 * it (`ADMINIUM_DESIGNER=live`), a Super Admin switches it on here with their
 * password, and whoever uses it holds the permission. This card is the
 * second step, and it says where the other two stand.
 *
 * Without the operator's step the switch is off and disabled, with one line
 * saying so. On `adminium design` there is nothing to switch: one line.
 * Someone who may not use the Designer does not see the card at all.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ArrowRight, WandSparkles } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, FormField, IconTile, Input, ToggleRow } from '@adminium/ui';

import { api, ApiError } from '../../app/api.js';
import { systemInfoQuery } from '../../app/capabilities.js';
import { t } from '../../i18n/t.js';

export interface DesignerLive {
  mode: 'local' | 'live';
  allowed: boolean;
  on: boolean;
  project: boolean;
  reason: 'not-allowed' | 'no-project' | 'disk-not-kept' | 'no-bundler' | 'not-writable' | null;
}

const LIVE_KEY = ['designer', 'live'] as const;

function reasonLine(reason: NonNullable<DesignerLive['reason']>): string {
  switch (reason) {
    case 'not-allowed':
      return t('studio:settingsAi.designer.notAllowed', 'The server’s operator has not allowed this. They set ADMINIUM_DESIGNER=live in the server’s environment.');
    case 'no-project':
      return t('studio:settingsAi.designer.noProject', 'The Designer builds apps into a project folder, and this server runs without one.');
    case 'disk-not-kept':
      return t('studio:settingsAi.designer.diskNotKept', 'It was switched off: the project folder did not come back after a restart, so what the Designer builds here would be lost. Keep the folder on a disk that stays.');
    case 'no-bundler':
      return t('studio:settingsAi.designer.noBundler', 'The project has no esbuild, which the Designer builds screens with. Install it in the project: npm install --save-dev esbuild');
    case 'not-writable':
      return t('studio:settingsAi.designer.notWritable', 'The project folder cannot be written to.');
  }
}

export function DesignerLiveCard(): ReactNode {
  const queryClient = useQueryClient();
  const live = useQuery({ queryKey: LIVE_KEY, queryFn: () => api.get<DesignerLive>('/api/v1/designer/live'), retry: false, staleTime: 30_000 });
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState('');
  const [refused, setRefused] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: (input: { on: boolean; password?: string }) => api.put<DesignerLive>('/api/v1/designer/live', input),
    onSuccess: async (next) => {
      queryClient.setQueryData(LIVE_KEY, next);
      setAsking(false);
      setPassword('');
      setRefused(null);
      // The sidebar and the /design route read whether the Designer is there from the system's own document.
      await queryClient.invalidateQueries({ queryKey: systemInfoQuery().queryKey });
    },
    onError: (error) => {
      setRefused(error instanceof ApiError ? error.message : t('studio:settingsAi.designer.failed', 'The switch could not be changed.'));
    },
  });

  // Not there for someone who may not use the Designer (403), nor on a server too old to have it (404).
  if (live.data === undefined) return null;
  const state = live.data;

  return (
    <Card data-testid="designer-live-card">
      <CardHeader className="flex items-center gap-3">
        <IconTile>
          <WandSparkles aria-hidden="true" />
        </IconTile>
        <div className="min-w-0 flex-1">
          <h3 className="text-section text-fg">{t('studio:settingsAi.designer.title', 'Adminium Designer')}</h3>
          <p className="text-caption text-fg-subtle">
            {t(
              'studio:settingsAi.designer.lead',
              'Lets people with the permission describe an app and have a model write it into this project: tables, pages, screens and, with a yes each time, server code. Every turn is recorded in the audit log.',
            )}
          </p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        {state.mode === 'local' ? (
          <p className="m-0 text-body text-fg-muted">{t('studio:settingsAi.designer.local', 'Adminium Designer is running on this machine (adminium design).')}</p>
        ) : (
          <>
            <ToggleRow
              label={t('studio:settingsAi.designer.switch', 'Adminium Designer on this server')}
              description={t(
                'studio:settingsAi.designer.switchLine',
                'What it builds is served to your staff like any app: screens a model wrote run in their browsers, with what their roles may do.',
              )}
              checked={state.on || asking}
              disabled={!state.allowed || !state.project || change.isPending}
              onCheckedChange={(checked) => {
                setRefused(null);
                if (checked) setAsking(true);
                else {
                  setAsking(false);
                  if (state.on) change.mutate({ on: false });
                }
              }}
            />
            {state.reason !== null ? <p className="m-0 text-caption text-fg-muted">{reasonLine(state.reason)}</p> : null}
            {asking && !state.on ? (
              <form
                className="flex flex-wrap items-end gap-2.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (password !== '') change.mutate({ on: true, password });
                }}
              >
                <FormField label={t('studio:settingsAi.designer.password', 'Your password, to switch it on')} className="min-w-[220px] flex-1">
                  <Input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
                </FormField>
                <Button type="submit" disabled={password === '' || change.isPending}>
                  {t('studio:settingsAi.designer.switchOn', 'Switch it on')}
                </Button>
              </form>
            ) : null}
            {refused !== null ? (
              <p role="alert" className="m-0 text-caption font-semibold text-danger">
                {refused}
              </p>
            ) : null}
            {state.on ? (
              <a href="/design" className="inline-flex items-center gap-1.5 self-start text-body font-bold text-accent hover:underline">
                {t('studio:settingsAi.designer.open', 'Open the Designer')}
                <ArrowRight aria-hidden="true" className="size-4 rtl:-scale-x-100" />
              </a>
            ) : null}
          </>
        )}
      </CardBody>
    </Card>
  );
}
