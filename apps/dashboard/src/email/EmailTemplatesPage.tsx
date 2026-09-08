// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/email-templates` — the manager (39-email-templates-and-campaigns.md
 * §3.6). The route's search carries what a link can ask for: `kind` picks
 * the tray (the campaign-sent notice links here with `kind=campaign`),
 * `archived` opens archived mode, and `open=<id>` goes straight to the
 * editor — the shape `email.campaign.sent`'s `actionUrl` uses.
 */
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect } from 'react';

import { EmailManager } from './manager/Manager.js';
import type { EmailTemplatesSearch } from './search.js';

export function EmailTemplatesPage() {
  const search = useSearch({ strict: false }) as EmailTemplatesSearch;
  const navigate = useNavigate();
  const open = search.open;

  useEffect(() => {
    if (open === undefined) return;
    void navigate({ to: '/email-templates/$id', params: { id: open }, replace: true });
  }, [open, navigate]);

  return <EmailManager initialTab={search.kind ?? 'template'} initialArchived={search.archived ?? false} />;
}
