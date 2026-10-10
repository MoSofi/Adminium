// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the assistant may do beyond reading: four switches and a cap.
 *
 * EACH SWITCH IS ITS OWN DECISION and is saved as it is flipped: turning one
 * on never moves another, and the line above them always says the whole
 * state in a sentence, because four switches are easy to misread as a group.
 *
 * A SWITCH IS NOT A GRANT. On, it lets the assistant PROPOSE that kind of
 * action to a person who could do it themselves on that table or page; the
 * person confirms each time. The sentences under the switches say so.
 *
 * Shown only to someone who may change workspace settings: who lets the
 * assistant write is a workspace decision, not the model's operator's.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { Button, Card, CardBody, CardHeader, FormField, IconTile, Input, Spinner, Switch } from '@adminium/ui';

import { getI18nInstance, t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { ASSISTANT_SETTINGS_QUERY_KEY } from './AllowanceCard.js';
import { aiApi, type AssistantAbilities } from './api.js';

export const ABILITY_KEYS = ['create', 'change', 'send', 'delete'] as const;
export type AbilityKey = (typeof ABILITY_KEYS)[number];

/** The verb of an ability, as it stands in the state line. */
function verb(key: AbilityKey | 'read'): string {
  switch (key) {
    case 'read':
      return t('studio:settingsAi.abilities.verb.read', 'read');
    case 'create':
      return t('studio:settingsAi.abilities.verb.create', 'create');
    case 'change':
      return t('studio:settingsAi.abilities.verb.change', 'change');
    case 'send':
      return t('studio:settingsAi.abilities.verb.send', 'send');
    case 'delete':
      return t('studio:settingsAi.abilities.verb.delete', 'delete');
  }
}

function listed(words: string[], type: 'conjunction' | 'disjunction'): string {
  const language = getI18nInstance()?.language ?? 'en-US';
  // English as the design writes it, with no comma before the last word ("read, create and change").
  const locale = language.toLowerCase().startsWith('en') ? 'en-GB' : language;
  try {
    return new Intl.ListFormat(locale, { style: 'long', type }).format(words);
  } catch {
    return words.join(', ');
  }
}

/** The whole state in one sentence, built from the four switches. */
export function abilitiesLine(abilities: AssistantAbilities, name: string): string {
  const on = ABILITY_KEYS.filter((key) => abilities[key]);
  const off = ABILITY_KEYS.filter((key) => !abilities[key]);
  if (on.length === 0) return t('studio:settingsAi.abilities.onlyRead', '{name} can only read.', { name });
  const can = t('studio:settingsAi.abilities.can', '{name} can {list}.', { name, list: listed([verb('read'), ...on.map(verb)], 'conjunction') });
  if (off.length === 0) return can;
  return `${can} ${t('studio:settingsAi.abilities.cannot', 'It cannot {list}.', { list: listed(off.map(verb), 'disjunction') })}`;
}

function sentence(key: AbilityKey): { label: string; what: string } {
  switch (key) {
    case 'create':
      return {
        label: t('studio:settingsAi.abilities.create', 'Create'),
        what: t('studio:settingsAi.abilities.createWhat', 'Add a row, or save a new template, report or rule. You confirm each one.'),
      };
    case 'change':
      return {
        label: t('studio:settingsAi.abilities.change', 'Change'),
        what: t('studio:settingsAi.abilities.changeWhat', 'Edit a row or a saved document. You confirm each one.'),
      };
    case 'send':
      return {
        label: t('studio:settingsAi.abilities.send', 'Send'),
        what: t('studio:settingsAi.abilities.sendWhat', 'Send an existing email template to people in this workspace. You confirm each one.'),
      };
    case 'delete':
      return {
        label: t('studio:settingsAi.abilities.delete', 'Delete'),
        what: t('studio:settingsAi.abilities.deleteWhat', 'Remove a row or a document. You confirm each one.'),
      };
  }
}

export interface AbilitiesCardProps {
  /** What the assistant is called here. */
  name: string;
}

export function AbilitiesCard({ name }: AbilitiesCardProps) {
  const queryClient = useQueryClient();
  const toasts = useAppToasts();
  const ids = useId();
  const settings = useQuery({ queryKey: ASSISTANT_SETTINGS_QUERY_KEY, queryFn: () => aiApi.getAssistantSettings() });
  const save = useMutation({
    mutationFn: (body: { abilities?: Partial<AssistantAbilities>; maxRows?: number; staffAddresses?: boolean }) => aiApi.putAssistantSettings(body),
    onSuccess: (next) => queryClient.setQueryData(ASSISTANT_SETTINGS_QUERY_KEY, next),
    onError: () => {
      toasts.push({ variant: 'error', title: t('studio:settingsAi.abilities.saveFailed', 'Could not save that. Try again.') });
    },
  });

  const savedRows = settings.data?.maxRows;
  const ceiling = settings.data?.maxRowsCeiling ?? 50;
  const [rows, setRows] = useState('');
  useEffect(() => {
    if (savedRows !== undefined) setRows(String(savedRows));
  }, [savedRows]);
  const parsedRows = /^\d{1,3}$/.test(rows.trim()) ? Number(rows.trim()) : null;
  const rowsValid = parsedRows !== null && parsedRows >= 1 && parsedRows <= ceiling;

  return (
    <Card data-testid="assistant-abilities-card">
      <CardHeader className="flex items-center gap-3">
        <IconTile tone="accent" size="md" icon={<ShieldCheck />} />
        <div className="min-w-0 flex-1">
          <h3 className="text-section text-fg">{t('studio:settingsAi.abilities.title', 'What {name} may do', { name })}</h3>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-[18px]">
        {settings.data === undefined ? (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        ) : (
          <>
            <p
              role="status"
              data-testid="assistant-abilities-line"
              className="rounded-[10px] bg-accent-soft-solid px-[13px] py-[11px] text-[13px] font-bold leading-[1.45] text-fg"
            >
              {abilitiesLine(settings.data.abilities, name)}
            </p>

            <ul className="flex flex-col gap-4">
              {ABILITY_KEYS.map((key) => {
                const { label, what } = sentence(key);
                const labelId = `${ids}-${key}`;
                return (
                  <li key={key} className="flex items-start gap-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-[3px] pt-px">
                      <span id={labelId} className="text-[13.5px] font-bold text-fg">
                        {label}
                      </span>
                      <span id={`${labelId}-what`} className="text-pretty text-[12.5px] leading-[1.5] text-fg-muted">
                        {what}
                      </span>
                    </div>
                    <Switch
                      data-testid={`assistant-ability-${key}`}
                      aria-labelledby={labelId}
                      aria-describedby={`${labelId}-what`}
                      checked={settings.data.abilities[key]}
                      disabled={save.isPending}
                      onCheckedChange={(checked) => save.mutate({ abilities: { [key]: checked } })}
                    />
                  </li>
                );
              })}
            </ul>

            <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
              <FormField
                className="min-w-[200px] max-w-[280px] flex-1"
                label={t('studio:settingsAi.abilities.rows', 'Rows in one confirmation')}
                helper={t('studio:settingsAi.abilities.rowsHint', '1 to {max}', { max: ceiling })}
              >
                <Input inputMode="numeric" value={rows} data-testid="assistant-max-rows" onChange={(event) => setRows(event.target.value)} />
              </FormField>
              <Button
                type="button"
                data-testid="assistant-max-rows-save"
                disabled={!rowsValid || parsedRows === savedRows}
                loading={save.isPending}
                onClick={() => parsedRows !== null && save.mutate({ maxRows: parsedRows })}
              >
                {t('studio:settingsAi.abilities.save', 'Save')}
              </Button>
            </div>

            {/* Where it is, not what it may do: the same switches hold on an app's own address. */}
            <div className="flex items-start gap-3 border-t border-border pt-4">
              <div className="flex min-w-0 flex-1 flex-col gap-[3px] pt-px">
                <span id={`${ids}-staff`} className="text-[13.5px] font-bold text-fg">
                  {t('studio:settingsAi.abilities.staffAddresses', 'On your apps’ staff addresses')}
                </span>
                <span id={`${ids}-staff-what`} className="text-pretty text-[12.5px] leading-[1.5] text-fg-muted">
                  {t(
                    'studio:settingsAi.abilities.staffAddressesWhat',
                    'Show {name}’s button on an app’s own staff screens, to the people whose role may use {name}. A customer side never has it.',
                    { name },
                  )}
                </span>
              </div>
              <Switch
                data-testid="assistant-staff-addresses"
                aria-labelledby={`${ids}-staff`}
                aria-describedby={`${ids}-staff-what`}
                checked={settings.data.staffAddresses}
                disabled={save.isPending}
                onCheckedChange={(checked) => save.mutate({ staffAddresses: checked })}
              />
            </div>

            <p className="text-pretty text-[12.5px] leading-[1.55] text-fg-muted">
              {t(
                'studio:settingsAi.abilities.never',
                '{name} never changes permissions, people, connections, the database’s structure, or these settings.',
                { name },
              )}
            </p>
          </>
        )}
      </CardBody>
    </Card>
  );
}
