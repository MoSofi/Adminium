// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Step 5 — bring your team (45-onboarding.md §2, comp step "Bring your team").
 *
 * Invitations are real here: `POST /users` mints one and answers with the
 * activation link and whether it was also emailed (`teamApi.ts`). On an install
 * with no SMTP — which a fresh `npx` install is — `emailSent` comes back false
 * and the link is the ONLY copy that will ever exist, because the server stores
 * a hash of it. So the link is shown for exactly those invitations, next to the
 * person it belongs to, rather than behind a banner that could be dismissed.
 *
 * No role picker (45 DEP-20). The comp draws Admin / Editor / Viewer pills, but
 * sending a role with the invitation additionally requires
 * `system:roles:manage`, and roles are a decision worth making on the Team page
 * with the whole permission matrix visible — not on the fifth screen of a
 * wizard someone is trying to finish.
 */
import { Mail } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { Alert, Avatar, Button, InputGroup, MonoText } from '@adminium/ui';

import { t } from '../../../i18n/t.js';
import { CopyButton } from '../../../studio/connect/CopyButton.js';
import { activationLink, createUser, type UserInvite } from '../../../team/teamApi.js';

export interface InvitedPerson {
  email: string;
  emailSent: boolean;
  invite: UserInvite;
}

export interface TeamStepProps {
  invited: readonly InvitedPerson[];
  onInvited: (person: InvitedPerson) => void;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The part before the `@` — a name the server requires and nobody was asked for. */
export function nameFromEmail(email: string): string {
  const local = email.trim().split('@')[0] ?? '';
  return local === '' ? email.trim() : local;
}

export function TeamStep({ invited, onInvited }: TeamStepProps) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function invite(): void {
    const address = email.trim();
    if (address === '') return;
    if (!EMAIL_PATTERN.test(address)) {
      setError(t('onboarding:team.invalidEmail', 'Enter a valid email address.'));
      return;
    }
    if (invited.some((person) => person.email === address)) {
      setError(t('onboarding:team.duplicate', 'That person has already been invited.'));
      return;
    }

    setBusy(true);
    setError(null);
    void createUser({ email: address, name: nameFromEmail(address) })
      .then((reply) => {
        onInvited({ email: address, emailSent: reply.emailSent, invite: reply.invite });
        setEmail('');
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof Error
            ? cause.message
            : t('onboarding:team.failed', 'That invitation could not be created.'),
        );
      })
      .finally(() => setBusy(false));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    invite();
  }

  return (
    <div className="flex flex-col gap-4">
      {invited.length === 0 ? null : (
        <ul className="flex flex-col gap-2.5">
          {invited.map((person) => (
            <li
              key={person.email}
              className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3"
            >
              <div className="flex items-center gap-3">
                <Avatar name={person.email} size="sm" />
                <span className="min-w-0 flex-1 truncate text-body font-semibold text-fg">
                  {person.email}
                </span>
                {person.emailSent ? (
                  <span className="text-caption text-fg-muted">
                    {t('onboarding:team.emailed', 'Invitation emailed')}
                  </span>
                ) : null}
              </div>
              {person.emailSent ? null : (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2 p-2.5">
                  <MonoText className="min-w-0 flex-1 break-all text-caption">
                    {activationLink(window.location.origin, person.invite.activationPath)}
                  </MonoText>
                  <CopyButton
                    value={activationLink(window.location.origin, person.invite.activationPath)}
                    label={t('onboarding:team.copyLink', 'Copy link')}
                    copiedLabel={t('onboarding:team.copied', 'Copied')}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-start gap-2">
        <InputGroup
          type="email"
          autoComplete="off"
          className="flex-1"
          aria-label={t('onboarding:team.emailLabel', 'Teammate’s email')}
          placeholder={t('onboarding:team.placeholder', 'teammate@company.com')}
          value={email}
          iconLeading={<Mail />}
          onKeyDown={onKeyDown}
          onChange={(event) => {
            setError(null);
            setEmail(event.target.value);
          }}
        />
        <Button variant="soft" onClick={invite} loading={busy} disabled={email.trim() === ''}>
          {t('onboarding:team.invite', 'Invite')}
        </Button>
      </div>

      {error === null ? null : <Alert tone="danger" role="alert" title={error} />}

      <p className="text-caption text-fg-subtle">
        {t(
          'onboarding:team.note',
          'Invitations without email show a link you send yourself. It is shown once — Adminium keeps only a hash of it.',
        )}
      </p>
    </div>
  );
}
