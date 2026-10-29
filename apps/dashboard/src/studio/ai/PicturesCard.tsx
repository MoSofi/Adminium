// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings → AI → Pictures made with AI.
 *
 * Each picture the Designer makes is charged to the account of the key it is
 * made with, so the workspace holds it to three counts: a person's day,
 * everybody's day, and one chat turn. 0 turns each off: unlike the voice
 * minutes above, where 0 means no limit, said on each field.
 *
 * Which service makes the pictures is chosen in the Designer's picture
 * dialog, by someone who manages AI settings.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button, Card, CardBody, CardHeader, FormField, IconTile, Input, Spinner } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { api } from '../../app/api.js';
import { ASSISTANT_SETTINGS_QUERY_KEY } from './AllowanceCard.js';
import { aiApi } from './api.js';
import { LIVE_KEY, type DesignerLive } from './DesignerLiveCard.js';

type Field = 'perDay' | 'perDayAll' | 'perTurn';
const MAX: Readonly<Record<Field, number>> = { perDay: 10_000, perDayAll: 100_000, perTurn: 50 };

export function PicturesCard() {
  // Only where the Designer runs (a project's `design` server, or a live server with it switched on): elsewhere these counts govern nothing.
  const live = useQuery({ queryKey: LIVE_KEY, queryFn: () => api.get<DesignerLive>('/api/v1/designer/live'), retry: false, staleTime: 30_000 });
  const shown = live.data !== undefined && (live.data.mode === 'local' || live.data.on);
  return shown ? <PicturesLimits /> : null;
}

function PicturesLimits() {
  const queryClient = useQueryClient();
  const toasts = useAppToasts();
  const settings = useQuery({ queryKey: ASSISTANT_SETTINGS_QUERY_KEY, queryFn: () => aiApi.getAssistantSettings() });
  const save = useMutation({
    mutationFn: (pictures: Partial<Record<Field, number>>) => aiApi.putAssistantSettings({ pictures }),
    onSuccess: (next) => queryClient.setQueryData(ASSISTANT_SETTINGS_QUERY_KEY, next),
    onError: () => {
      toasts.push({ variant: 'error', title: t('studio:settingsAi.pictures.saveFailed', 'Could not save that. Try again.') });
    },
  });
  const saved = settings.data?.pictures;
  const [values, setValues] = useState<Record<Field, string>>({ perDay: '', perDayAll: '', perTurn: '' });
  useEffect(() => {
    if (saved !== undefined) setValues({ perDay: String(saved.perDay), perDayAll: String(saved.perDayAll), perTurn: String(saved.perTurn) });
  }, [saved?.perDay, saved?.perDayAll, saved?.perTurn]);
  const parsed = (field: Field): number | null => {
    const text = values[field].trim();
    return /^\d{1,6}$/.test(text) && Number(text) <= MAX[field] ? Number(text) : null;
  };
  const fields: { field: Field; label: string }[] = [
    { field: 'perDay', label: t('studio:settingsAi.pictures.perDay', 'Pictures a person may make in a day') },
    { field: 'perDayAll', label: t('studio:settingsAi.pictures.perDayAll', 'Pictures everybody together may make in a day') },
    { field: 'perTurn', label: t('studio:settingsAi.pictures.perTurn', 'Pictures one Designer chat turn may make') },
  ];
  const valid = fields.every(({ field }) => parsed(field) !== null);
  const changed = saved !== undefined && fields.some(({ field }) => parsed(field) !== saved[field]);
  return (
    <Card data-testid="assistant-pictures-card">
      <CardHeader className="flex items-center gap-3">
        <IconTile tone="accent" size="md" icon={<Sparkles />} />
        <div className="min-w-0 flex-1">
          <h3 className="text-section text-fg">{t('studio:settingsAi.pictures.title', 'Pictures made with AI')}</h3>
          <p className="m-0 text-pretty text-[12.5px] leading-[1.5] text-fg-muted">
            {t('studio:settingsAi.pictures.what', 'Each picture the Designer makes is charged to the account of the key it is made with. The service is chosen in the Designer’s picture dialog.')}
          </p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-[18px]">
        {saved === undefined ? (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            {fields.map(({ field, label }) => (
              <FormField key={field} className="min-w-[200px] max-w-[320px] flex-1" label={label} helper={t('studio:settingsAi.pictures.zero', '0 turns making pictures off')}>
                <Input inputMode="numeric" value={values[field]} data-testid={`assistant-pictures-${field}`} onChange={(event) => setValues((before) => ({ ...before, [field]: event.target.value }))} />
              </FormField>
            ))}
            <Button
              type="button"
              data-testid="assistant-pictures-save"
              disabled={!valid || !changed}
              loading={save.isPending}
              onClick={() => {
                const next = Object.fromEntries(fields.map(({ field }) => [field, parsed(field)]).filter(([field, value]) => value !== null && value !== saved[field as Field]));
                save.mutate(next as Partial<Record<Field, number>>);
              }}
            >
              {t('studio:settingsAi.pictures.save', 'Save')}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
