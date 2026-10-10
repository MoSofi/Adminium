// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings → AI → Voice (comp `Milo Settings`, card E).
 *
 * Two decisions of the workspace, each a switch that saves as it is flipped:
 *
 *  - whether people may SPEAK to the assistant (off on a new workspace: a
 *    recording leaves the browser), with how many minutes a person may in a
 *    day;
 *  - whether the assistant may READ ITS REPLIES ALOUD (on: the browser's own
 *    voice does it, and nothing leaves the browser; each person still
 *    switches it on for themselves).
 *
 * The sentence under the first switch says who writes the words down HERE:
 * the workspace's model service when it can, otherwise each person's own
 * browser. The server knows which; the card does not guess.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mic } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { Button, Card, CardBody, CardHeader, FormField, IconTile, Input, Spinner, Switch } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { ASSISTANT_SETTINGS_QUERY_KEY } from './AllowanceCard.js';
import { aiApi } from './api.js';

export function VoiceCard({ name }: { name: string }) {
  const queryClient = useQueryClient();
  const toasts = useAppToasts();
  const ids = useId();
  const settings = useQuery({ queryKey: ASSISTANT_SETTINGS_QUERY_KEY, queryFn: () => aiApi.getAssistantSettings() });
  const save = useMutation({
    mutationFn: (voice: { input?: boolean; dailyMinutes?: number; output?: boolean }) => aiApi.putAssistantSettings({ voice }),
    onSuccess: (next) => queryClient.setQueryData(ASSISTANT_SETTINGS_QUERY_KEY, next),
    onError: () => {
      toasts.push({ variant: 'error', title: t('studio:settingsAi.voice.saveFailed', 'Could not save that. Try again.') });
    },
  });

  const saved = settings.data?.voice.dailyMinutes;
  const [minutes, setMinutes] = useState('');
  useEffect(() => {
    if (saved !== undefined) setMinutes(String(saved));
  }, [saved]);
  const parsed = /^\d{1,4}$/.test(minutes.trim()) ? Number(minutes.trim()) : null;
  const valid = parsed !== null && parsed <= 1_440;

  return (
    <Card data-testid="assistant-voice-card">
      <CardHeader className="flex items-center gap-3">
        <IconTile tone="accent" size="md" icon={<Mic />} />
        <div className="min-w-0 flex-1">
          <h3 className="text-section text-fg">{t('studio:settingsAi.voice.title', 'Voice')}</h3>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-[18px]">
        {settings.data === undefined ? (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-[3px] pt-px">
                <span id={`${ids}-speak`} className="text-[13.5px] font-bold text-fg">
                  {t('studio:settingsAi.voice.speak', 'Speak to {name}', { name })}
                </span>
                <span id={`${ids}-speak-what`} className="text-pretty text-[12.5px] leading-[1.5] text-fg-muted">
                  {settings.data.voice.writtenBy === 'provider'
                    ? t('studio:settingsAi.voice.speakProvider', 'What a person says is sent to your AI provider to be written down. Nothing is kept.')
                    : t('studio:settingsAi.voice.speakBrowser', 'Your AI provider does not write speech down, so each person’s own browser does, where it can. Nothing is kept.')}
                </span>
              </div>
              <Switch
                data-testid="assistant-voice-input"
                aria-labelledby={`${ids}-speak`}
                aria-describedby={`${ids}-speak-what`}
                checked={settings.data.voice.input}
                disabled={save.isPending}
                onCheckedChange={(checked) => save.mutate({ input: checked })}
              />
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <FormField
                className="min-w-[200px] max-w-[320px] flex-1"
                label={t('studio:settingsAi.voice.minutes', 'Minutes a person may dictate in a day')}
                helper={t('studio:settingsAi.voice.minutesHint', '0 means no limit')}
              >
                <Input inputMode="numeric" value={minutes} data-testid="assistant-voice-minutes" onChange={(event) => setMinutes(event.target.value)} />
              </FormField>
              <Button
                type="button"
                data-testid="assistant-voice-minutes-save"
                disabled={!valid || parsed === saved}
                loading={save.isPending}
                onClick={() => parsed !== null && save.mutate({ dailyMinutes: parsed })}
              >
                {t('studio:settingsAi.voice.save', 'Save')}
              </Button>
            </div>

            <div className="flex items-start gap-3 border-t border-border pt-4">
              <div className="flex min-w-0 flex-1 flex-col gap-[3px] pt-px">
                <span id={`${ids}-aloud`} className="text-[13.5px] font-bold text-fg">
                  {t('studio:settingsAi.voice.aloud', '{name} reads its replies aloud', { name })}
                </span>
                <span id={`${ids}-aloud-what`} className="text-pretty text-[12.5px] leading-[1.5] text-fg-muted">
                  {t('studio:settingsAi.voice.aloudWhat', 'Uses the browser’s own voices. Each person switches it on for themselves.')}
                </span>
              </div>
              <Switch
                data-testid="assistant-voice-output"
                aria-labelledby={`${ids}-aloud`}
                aria-describedby={`${ids}-aloud-what`}
                checked={settings.data.voice.output}
                disabled={save.isPending}
                onCheckedChange={(checked) => save.mutate({ output: checked })}
              />
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
