// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The assistant's daily allowance: the number, and who used how much today.
 *
 * Its own card and its own route because it is its own decision: choosing a
 * model needs the permission to run one, and deciding what the assistant may
 * cost needs the permission to change workspace settings. The page shows this
 * card only to someone who holds the second.
 *
 * The day is counted in UTC, so it turns over for everybody at one instant;
 * the hint says when that is in the reader's own time.
 */
import { getFormatters } from '@adminium/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Hourglass } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge, Button, Card, CardBody, CardHeader, FormField, IconTile, Input, Spinner } from '@adminium/ui';

import { getI18nInstance, t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { aiApi, type AssistantSettings } from './api.js';

export const ASSISTANT_SETTINGS_QUERY_KEY = ['assistant', 'settings'] as const;

function fmt() {
  return getFormatters(getI18nInstance()?.language ?? 'en-US');
}

export interface AllowanceCardProps {
  /** What the assistant is called here. */
  name: string;
}

export function AllowanceCard({ name }: AllowanceCardProps) {
  const queryClient = useQueryClient();
  const toasts = useAppToasts();
  const settings = useQuery({ queryKey: ASSISTANT_SETTINGS_QUERY_KEY, queryFn: () => aiApi.getAssistantSettings() });
  const [draft, setDraft] = useState('');
  const saved = settings.data?.dailyTokens;
  useEffect(() => {
    if (saved !== undefined) setDraft(String(saved));
  }, [saved]);

  const parsed = /^\d{1,10}$/.test(draft.trim()) ? Number(draft.trim()) : null;
  const valid = parsed !== null && parsed <= 1_000_000_000;
  const dirty = parsed !== saved;

  const save = useMutation({
    mutationFn: (dailyTokens: number) => aiApi.putAssistantSettings({ dailyTokens }),
    onSuccess: (next) => {
      queryClient.setQueryData(ASSISTANT_SETTINGS_QUERY_KEY, next);
      toasts.push({ variant: 'success', title: t('studio:settingsAi.allowance.saved', 'Allowance saved') });
    },
    onError: () => {
      toasts.push({ variant: 'error', title: t('studio:settingsAi.allowance.saveFailed', 'Could not save the allowance. Try again.') });
    },
  });

  return (
    <Card data-testid="assistant-allowance-card">
      <CardHeader className="flex items-center gap-3">
        <IconTile tone="accent" size="md" icon={<Hourglass />} />
        <div className="min-w-0 flex-1">
          <h3 className="text-section text-fg">{t('studio:settingsAi.allowance.title', 'Daily allowance')}</h3>
          <p className="text-caption text-fg-subtle">
            {t('studio:settingsAi.allowance.subtitle', 'How much of {name} one person may use in a day.', { name })}
          </p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        {settings.data === undefined ? (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <FormField
                className="min-w-[220px] flex-1"
                label={t('studio:settingsAi.allowance.field', 'Tokens a person may use in a day')}
                helper={t(
                  'studio:settingsAi.allowance.hint',
                  '0 means no limit. A day is counted in UTC, so it starts again for everyone at the same moment: {time} your time.',
                  { time: fmt().time(settings.data.today.resetsAt) },
                )}
              >
                <Input
                  inputMode="numeric"
                  value={draft}
                  data-testid="assistant-daily-tokens"
                  onChange={(event) => setDraft(event.target.value)}
                />
              </FormField>
              <Button
                type="button"
                data-testid="assistant-allowance-save"
                disabled={!dirty || !valid}
                loading={save.isPending}
                onClick={() => parsed !== null && save.mutate(parsed)}
              >
                {t('studio:settingsAi.allowance.save', 'Save')}
              </Button>
            </div>

            <TodayTable settings={settings.data} name={name} />
            <Roles settings={settings.data} name={name} />
          </>
        )}
      </CardBody>
    </Card>
  );
}

function TodayTable({ settings, name }: { settings: AssistantSettings; name: string }) {
  const limit = settings.dailyTokens;
  return (
    <div className="border-t border-border pt-4">
      <h4 className="text-body-sm font-bold text-fg">{t('studio:settingsAi.allowance.today', 'Today')}</h4>
      {settings.today.people.length === 0 ? (
        <p className="mt-1 text-caption text-fg-subtle">{t('studio:settingsAi.allowance.empty', 'Nobody has used {name} today.', { name })}</p>
      ) : (
        <table className="mt-2 w-full text-body-sm" data-testid="assistant-allowance-today">
          <thead>
            <tr className="text-start text-caption text-fg-subtle">
              <th scope="col" className="py-1 text-start font-semibold">{t('studio:settingsAi.allowance.person', 'Person')}</th>
              <th scope="col" className="py-1 text-end font-semibold">{t('studio:settingsAi.allowance.questions', 'Questions')}</th>
              <th scope="col" className="py-1 text-end font-semibold">{t('studio:settingsAi.allowance.tokens', 'Tokens')}</th>
            </tr>
          </thead>
          <tbody>
            {settings.today.people.map((row) => (
              <tr key={row.userId} className="border-t border-border">
                <td className="py-1.5 text-fg">
                  <span className="me-2">{row.name}</span>
                  {limit > 0 && row.tokens >= limit ? <Badge tone="warn">{t('studio:settingsAi.allowance.atLimit', 'At the limit')}</Badge> : null}
                </td>
                <td className="py-1.5 text-end font-mono tabular-nums text-fg-muted">{fmt().number(row.turns)}</td>
                <td className="py-1.5 text-end font-mono tabular-nums text-fg">{fmt().number(row.tokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Roles({ settings, name }: { settings: AssistantSettings; name: string }) {
  return (
    <div className="border-t border-border pt-4">
      <h4 className="text-body-sm font-bold text-fg">{t('studio:settingsAi.allowance.roles', 'Roles that may use {name}', { name })}</h4>
      {settings.roles.length === 0 ? (
        <p className="mt-1 text-caption text-fg-subtle">{t('studio:settingsAi.allowance.rolesNone', 'Only Super Admin may use {name}.', { name })}</p>
      ) : (
        <>
          <ul className="mt-2 flex flex-wrap gap-1.5" data-testid="assistant-allowance-roles">
            {settings.roles.map((role) => (
              <li key={role.id}>
                <Badge tone="neutral">{role.name}</Badge>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-caption text-fg-subtle">{t('studio:settingsAi.allowance.rolesHint', 'Set in each role’s permissions.')}</p>
        </>
      )}
    </div>
  );
}
