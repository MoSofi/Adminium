// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Send as" on the template editor's Branding panel: who every language of
 * this template goes as.
 *
 *  - "By the record's workspace" (the default): mail about a record goes as
 *    the sender of the workspace its database is in, else as the server.
 *  - "The server": the server's own sender, whatever the record.
 *  - A workspace: its sender, whatever the record (one with no sender of its
 *    own goes as the server, and says so).
 *
 * Saved at once, outside the editor's draft: it is who the mail goes as,
 * not what it says, and it is the same for every language. Shown only while
 * the server has a workspace; the server's own mail (sign-in, invitations)
 * always goes as the server.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FormField, Select } from '@adminium/ui';

import { t } from '../../../../i18n/t.js';
import { EMAIL_DOCUMENTS_KEY } from '../../../queries.js';
import type { EmailDocumentDetail } from '../../../api.js';
import { SEND_AS_SERVER, sendAsApi, sendAsOptionsQuery, type SendAsOptions } from '../../../sendAs.js';

export interface SendAsFieldProps {
  documentId: string;
  /** The template's "Send as" now (the detail's): null = by the record. */
  sendAs: string | null;
}

/** What the server's option says: its From, when mail is set up. */
function serverLabel(options: SendAsOptions): string {
  return options.server === null
    ? t('email:sendAs.server', 'The server')
    : t('email:sendAs.serverFrom', 'The server · {from}', { from: options.server });
}

export function SendAsField({ documentId, sendAs }: SendAsFieldProps) {
  const queryClient = useQueryClient();
  const options = useQuery(sendAsOptionsQuery());
  const [failed, setFailed] = useState(false);
  const set = useMutation({
    mutationFn: (next: string | null) => sendAsApi.set(documentId, next),
    onMutate: () => setFailed(false),
    onSuccess: (reply) => {
      queryClient.setQueryData([...EMAIL_DOCUMENTS_KEY, 'detail', documentId], (current: EmailDocumentDetail | undefined) =>
        current === undefined ? current : { ...current, sendAs: reply.sendAs },
      );
    },
    onError: () => setFailed(true),
  });

  // No workspace on the server: every mail goes as the server, and there is nothing to choose.
  if (options.data === undefined || options.data.workspaces.length === 0) return null;
  const data = options.data;
  const value = set.isPending && set.variables !== undefined ? (set.variables ?? '') : (sendAs ?? '');
  const chosen = data.workspaces.find((workspace) => workspace.id === value);

  const helper =
    value === ''
      ? t('email:sendAs.helper.byRecord', 'Mail about a record goes from the sender of the workspace its database is in.')
      : value === SEND_AS_SERVER
        ? t('email:sendAs.helper.server', 'Every mail of this template goes from the server’s sender.')
        : chosen !== undefined && chosen.from === null
          ? t('email:sendAs.helper.noSender', '{workspace} has no sender of its own yet, so this template goes from the server’s sender.', { workspace: chosen.name })
          : t('email:sendAs.helper.workspace', 'Every mail of this template goes from {workspace}’s sender, whatever its record.', { workspace: chosen?.name ?? '' });

  return (
    <FormField
      label={t('email:sendAs.label', 'Send as')}
      helper={failed ? undefined : helper}
      error={failed ? t('email:sendAs.failed', 'This could not be saved. Try again.') : undefined}
    >
      <Select
        data-testid="email-send-as"
        value={value}
        disabled={set.isPending}
        aria-busy={set.isPending}
        onChange={(event) => set.mutate(event.target.value === '' ? null : event.target.value)}
      >
        <option value="">{t('email:sendAs.byRecord', 'By the record’s workspace')}</option>
        <option value={SEND_AS_SERVER}>{serverLabel(data)}</option>
        {data.workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.from === null
              ? t('email:sendAs.workspaceNoSender', '{workspace} · no sender yet', { workspace: workspace.name })
              : t('email:sendAs.workspaceFrom', '{workspace} · {from}', { workspace: workspace.name, from: workspace.from })}
          </option>
        ))}
      </Select>
    </FormField>
  );
}
