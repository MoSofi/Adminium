// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The e-mail consent panel on the dashboard's record page: the shared panel
 * (`ConsentPanel.tsx`) over the dashboard's own session, its toasts, and the
 * query the record page asked the panel through (`consentApi.ts`), which it
 * reads again after every change.
 *
 * Loaded lazily, with its words (`common:consent.*`, a group en-US keeps out
 * of the entry chunk), only on a record of a table an app declares as people.
 */
import { useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { useCommonWords } from '../i18n/commonWords.js';
import { getI18nInstance } from '../i18n/t.js';
import { useAppToasts } from '../pages/toasts.js';
import { consentQueryKey, dashboardConsentClient } from './consentApi.js';
import { ConsentPanel } from './ConsentPanel.js';
import type { ConsentPanelView, ConsentRecordRef } from './consentTypes.js';

export interface RecordConsentPanelProps {
  record: ConsentRecordRef;
  view: ConsentPanelView;
  name: string | null;
  address: string | null;
}

export default function RecordConsentPanel({ record, view, name, address }: RecordConsentPanelProps): ReactNode {
  useCommonWords();
  const toasts = useAppToasts();
  const queryClient = useQueryClient();
  return (
    <ConsentPanel
      record={record}
      view={view}
      client={dashboardConsentClient}
      name={name}
      address={address}
      locale={getI18nInstance()?.language ?? 'en-US'}
      onChanged={() => queryClient.invalidateQueries({ queryKey: consentQueryKey(record) })}
      notify={(message, tone) => toasts.push({ variant: tone, title: message })}
    />
  );
}
