// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings → AI: what the page assistant is called here, and what it may read.
 *
 * ITS OWN CARD, NOT PART OF THE PROVIDER FORM. `ProviderConfigForm` is
 * mounted twice — here and as the connect wizard's inline enrichment panel —
 * so a field added to it appears in the middle of somebody's first-run setup,
 * asking them to name an assistant they have not met. This card is only ever
 * on this page.
 *
 * THE SWITCH IS THE PRIVACY DECISION ON THIS SCREEN. Off, the assistant works
 * from documents and schema alone; on, its tools may read rows the operator's
 * own role can read — masked, capped per call, and listed under *Sources read*
 * in every result. It is opt-in and NOT portable: importing a bundle somebody
 * else exported must never be what switches it on.
 *
 * THE SAVE SENDS THE STORED PROVIDER BACK. `PUT /config` requires `provider`
 * (a null would CLEAR it) while every other field is keep-if-omitted, so this
 * card echoes the provider it was given and touches nothing else. A provider
 * draft being typed in the form above is not read: only what is stored is.
 *
 * It invalidates `['bootstrap']` because the *Ask …* button's LABEL comes from
 * there — bootstrap carries the assistant's name so a host page can render the
 * button before the modal's chunk exists. Without this the button keeps the
 * old name until a reload.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, FormField, IconTile, Input, Switch } from '@adminium/ui';

import { bootstrapQuery } from '../../app/bootstrap.js';
import { t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { aiApi, type LlmConfig } from './api.js';
import { CONFIG_QUERY_KEY } from './ProviderConfigForm.js';

export interface AssistantCardProps {
  config: LlmConfig;
}

export function AssistantCard({ config }: AssistantCardProps) {
  const queryClient = useQueryClient();
  const toasts = useAppToasts();
  const [name, setName] = useState(config.assistantName);
  const [rowData, setRowData] = useState(config.assistantRowData);

  const trimmed = name.trim();
  // An empty name would leave every button reading *Ask* with nothing after
  // it, so the save is held rather than the field silently defaulted.
  const valid = trimmed.length > 0 && trimmed.length <= 40;
  const dirty = trimmed !== config.assistantName || rowData !== config.assistantRowData;

  const save = useMutation({
    mutationFn: () =>
      aiApi.putConfig({ provider: config.provider, assistantName: trimmed, assistantRowData: rowData }),
    onSuccess: (saved) => {
      queryClient.setQueryData(CONFIG_QUERY_KEY, saved);
      void queryClient.invalidateQueries({ queryKey: bootstrapQuery().queryKey });
      setName(saved.assistantName);
      setRowData(saved.assistantRowData);
      toasts.push({ variant: 'success', title: t('studio:settingsAi.assistant.saved', 'Assistant settings saved') });
    },
    onError: () => {
      toasts.push({
        variant: 'error',
        title: t('studio:settingsAi.assistant.saveFailed', 'Could not save the assistant settings. Try again.'),
      });
    },
  });

  // The name the switch's own copy talks about is the one ON SCREEN, so the
  // sentence changes as it is typed rather than after it is saved.
  const label = t('studio:settingsAi.assistant.rowData.label', 'Let {name} read table rows', {
    name: trimmed === '' ? config.assistantName : trimmed,
  });

  return (
    <Card data-testid="assistant-card">
      <CardHeader className="flex items-center gap-3">
        <IconTile tone="accent" size="md" icon={<Sparkles />} />
        <div className="min-w-0 flex-1">
          <h3 className="text-section text-fg">{t('studio:settingsAi.assistant.title', 'Assistant')}</h3>
          <p className="text-caption text-fg-subtle">
            {t('studio:settingsAi.assistant.subtitle', 'What it is called here, and what it may read.')}
          </p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        <FormField
          label={t('studio:settingsAi.assistant.name.label', 'Assistant name')}
          helper={t('studio:settingsAi.assistant.name.hint', 'Shown on the Ask button and in the assistant window.')}
        >
          <Input
            value={name}
            maxLength={40}
            data-testid="assistant-name"
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>

        <div className="flex items-center gap-3 border-t border-border pt-4">
          <div className="min-w-0 flex-1">
            <div className="text-body-sm font-bold text-fg">{label}</div>
            <p className="mt-0.5 text-caption text-fg-subtle">
              {t(
                'studio:settingsAi.assistant.rowData.hint',
                'When on, {name} may send rows your role can read to the configured provider — masked, at most 50 per request, and listed under Sources read. When off, it works from documents and schema only.',
                { name: trimmed === '' ? config.assistantName : trimmed },
              )}
            </p>
          </div>
          <Switch checked={rowData} onCheckedChange={setRowData} aria-label={label} data-testid="assistant-row-data" />
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            data-testid="assistant-save"
            disabled={!dirty || !valid}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {t('studio:settingsAi.assistant.save', 'Save')}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
