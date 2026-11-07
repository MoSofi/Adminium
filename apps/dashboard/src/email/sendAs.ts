// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Send as" on an email template, over `GET /api/v1/email-templates/send-as-options`
 * and `PUT /api/v1/email-templates/:id/send-as` (`routes/email-templates/`).
 * Shapes mirror the server's Zod replies (`emailSendAsOptionsReply`,
 * `emailSendAsReply`): change both together.
 *
 * The choice belongs to every language of the template and is saved at once,
 * outside the editor's draft: it is who the mail goes as, not what it says.
 */
import { queryOptions } from '@tanstack/react-query';

import { api } from '../app/api.js';
import { EMAIL_DOCUMENTS_KEY } from './queries.js';

/** "Send as" the server's own sender, whatever the record. */
export const SEND_AS_SERVER = 'server';

export interface SendAsOptions {
  /** The server's From; null while no mail is set up. */
  server: string | null;
  /**
   * The workspaces this person sees. `from` is the workspace's own From, sent
   * only to those who manage senders (null otherwise); `hasSender` says
   * whether it has one, for everyone.
   */
  workspaces: { id: string; name: string; from: string | null; hasSender: boolean }[];
}

export const sendAsOptionsQuery = () =>
  queryOptions({
    queryKey: [...EMAIL_DOCUMENTS_KEY, 'send-as-options'] as const,
    queryFn: () => api.get<SendAsOptions>('/api/v1/email-templates/send-as-options'),
    staleTime: 30_000,
  });

export const sendAsApi = {
  set: (documentId: string, sendAs: string | null) =>
    api.put<{ key: string; sendAs: string | null }>(`/api/v1/email-templates/${encodeURIComponent(documentId)}/send-as`, { sendAs }),
};
