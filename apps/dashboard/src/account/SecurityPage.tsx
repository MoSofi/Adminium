/**
 * `/account/security` — password, active sessions, and two-factor.
 *
 * The 2FA calls (`/auth/2fa/enroll`, `/activate`, `/disable`) have existed in
 * `routes/auth` since M2 with no screen behind them: an account could be forced
 * into a TOTP challenge at login and had no way to set one up. This is that
 * screen.
 *
 * TWO ONE-TIME SECRETS, HANDLED THE SAME WAY AS THE API KEY. Enrolment returns
 * the TOTP `secret` once (encrypted at rest, never re-read) and activation
 * returns ten recovery codes once (stored hashed). Both live in COMPONENT
 * STATE and never become mutation data — `useMutation` keeps whatever the
 * mutationFn resolves to, for the page lifetime plus gcTime, in the devtools
 * Mutations tab and in anything that serialises the QueryClient. See
 * `api-keys/ApiKeysPage.tsx` for the same reasoning at length.
 *
 * NO QR CODE. The comp-era design showed one; this build has no QR encoder and
 * adding an image dependency to render a secret is not a trade worth making
 * here. The `otpauth://` URL is offered as a copyable link — every
 * authenticator accepts it, and the base32 secret is there for manual entry.
 * A fake QR (a placeholder square) would be worse than none.
 *
 * SIGNING YOURSELF OUT is deliberately not offered: the current session has no
 * revoke control, because a list of near-identical user agents is exactly where
 * that misclick happens, and `/auth/logout` is one click away in the topbar.
 */
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { KeyRound, Monitor, ShieldCheck, ShieldOff } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  FormField,
  IconTile,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  MonoText,
  SecretInput,
} from '@adminium/ui';
import { tagForLocale, type LocaleId } from '@adminium/i18n';

import { bootstrapQuery } from '../app/bootstrap.js';
import { PageActions } from '../shell/PageActionsProvider.js';
import { PageSurface } from '../shell/PageSurface.js';
import { t } from '../i18n/t.js';
import { CopyButton } from '../studio/connect/CopyButton.js';
import {
  SESSIONS_QUERY_KEY,
  activate2fa,
  changePassword,
  deviceLabel,
  disable2fa,
  enroll2fa,
  formatSince,
  formatStamp,
  revokeSession,
  sessionsQuery,
  sortSessions,
  type SessionDto,
  type TotpEnrollment,
} from './securityApi.js';

export function SecurityPage(): ReactNode {
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const localeTag = tagForLocale(bootstrap.prefs.locale as LocaleId);
  const [now] = useState(() => Date.now());

  return (
    <PageSurface width="content" className="flex flex-col gap-5">
      <PageActions
        title={t('security.title', 'Security')}
        subtitle={t('security.subtitle', 'Your password, your second factor, and everywhere you are signed in.')}
      />

      <PasswordCard />
      <TwoFactorCard enabled={bootstrap.user.totpEnabled} />
      <SessionsCard localeTag={localeTag} now={now} />
    </PageSurface>
  );
}

// --- password ----------------------------------------------------------------

function PasswordCard(): ReactNode {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const change = useMutation({
    mutationFn: changePassword,
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setConfirm('');
    },
  });

  // The mismatch is caught here rather than by the server because the server
  // never sees the confirmation field — it is a typing check, not a rule.
  const mismatch = confirm !== '' && next !== confirm;
  const canSubmit = current !== '' && next !== '' && !mismatch && next === confirm && !change.isPending;

  return (
    <Card>
      <CardHeader className="flex items-center gap-3">
        <IconTile tone="accent" size="md" icon={<KeyRound />} />
        <h2 className="text-section text-fg">{t('security.password.title', 'Password')}</h2>
      </CardHeader>
      <CardBody>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            change.mutate({ currentPassword: current, newPassword: next });
          }}
        >
          <FormField label={t('security.password.current', 'Current password')} required>
            <Input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </FormField>
          <FormField
            label={t('security.password.new', 'New password')}
            required
            helper={t('security.password.helper', 'At least 8 characters.')}
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
          </FormField>
          <FormField
            label={t('security.password.confirm', 'Confirm new password')}
            required
            {...(mismatch
              ? { error: t('security.password.mismatch', 'The two passwords do not match.') }
              : {})}
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </FormField>

          {change.error === null ? null : (
            <Alert
              role="alert"
              tone="danger"
              title={t('security.password.failed', 'Could not change your password')}
              body={change.error.message}
              data-testid="security-password-error"
            />
          )}
          {change.isSuccess ? (
            <Alert
              role="status"
              tone="pos"
              title={t('security.password.changed', 'Password changed')}
              body={t(
                'security.password.changedBody',
                'Use the new password the next time you sign in. Sessions on other devices are unaffected — revoke them below if you want them signed out.',
              )}
              data-testid="security-password-ok"
            />
          ) : null}

          <div className="flex justify-end">
            <Button type="submit" disabled={!canSubmit} loading={change.isPending}>
              {t('security.password.submit', 'Change password')}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

// --- two-factor --------------------------------------------------------------

function TwoFactorCard({ enabled }: { enabled: boolean }): ReactNode {
  const queryClient = useQueryClient();
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [disabling, setDisabling] = useState(false);
  const [password, setPassword] = useState('');

  const enroll = useMutation({
    // The secret is lifted into state and NOT returned — see the header.
    mutationFn: async (): Promise<{ started: true }> => {
      setEnrollment(await enroll2fa());
      return { started: true };
    },
  });

  const activate = useMutation({
    mutationFn: async (input: string): Promise<{ activated: true }> => {
      setRecoveryCodes(await activate2fa(input));
      return { activated: true };
    },
    onSuccess: async () => {
      setEnrollment(null);
      setCode('');
      await queryClient.invalidateQueries({ queryKey: bootstrapQuery().queryKey });
    },
  });

  const disable = useMutation({
    mutationFn: disable2fa,
    onSuccess: async () => {
      setDisabling(false);
      setPassword('');
      setRecoveryCodes(null);
      await queryClient.invalidateQueries({ queryKey: bootstrapQuery().queryKey });
    },
  });

  return (
    <Card>
      <CardHeader className="flex items-center gap-3">
        <IconTile tone="accent" size="md" icon={<ShieldCheck />} />
        <h2 className="text-section flex-1 text-fg">
          {t('security.twoFactor.title', 'Two-factor authentication')}
        </h2>
        <Badge tone={enabled ? 'pos' : 'neutral'} dot data-testid="security-2fa-state">
          {enabled ? t('security.twoFactor.on', 'On') : t('security.twoFactor.off', 'Off')}
        </Badge>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        <p className="text-body-sm text-fg-muted">
          {t(
            'security.twoFactor.body',
            'An authenticator app generates a 6-digit code that Adminium asks for after your password.',
          )}
        </p>

        {/* Shown once, right after activation — the ten codes are stored hashed. */}
        {recoveryCodes === null ? null : (
          <Alert
            tone="warn"
            data-testid="security-recovery-codes"
            title={t('security.twoFactor.recovery.title', 'Save your recovery codes')}
            body={
              <div className="flex flex-col gap-2">
                <p className="text-body-sm">
                  {t(
                    'security.twoFactor.recovery.body',
                    'Each code signs you in once if you lose your authenticator. They are shown only now.',
                  )}
                </p>
                <MonoText className="break-all text-caption">{recoveryCodes.join(' ')}</MonoText>
                <div>
                  <CopyButton
                    value={recoveryCodes.join('\n')}
                    label={t('security.twoFactor.recovery.copy', 'Copy codes')}
                    copiedLabel={t('team.invite.copied', 'Copied')}
                  />
                </div>
              </div>
            }
          />
        )}

        {enabled ? (
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setDisabling(true)} data-testid="security-2fa-disable">
              {t('security.twoFactor.disable', 'Turn off two-factor')}
            </Button>
          </div>
        ) : enrollment === null ? (
          <div className="flex justify-end">
            <Button
              loading={enroll.isPending}
              onClick={() => enroll.mutate()}
              data-testid="security-2fa-enroll"
            >
              {t('security.twoFactor.enroll', 'Set up two-factor')}
            </Button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (code.trim() === '' || activate.isPending) return;
              activate.mutate(code.trim());
            }}
          >
            <FormField
              label={t('security.twoFactor.secret', 'Setup key')}
              helper={t(
                'security.twoFactor.secretHelper',
                'Paste the setup link into your authenticator, or type the key in by hand.',
              )}
            >
              <SecretInput
                readOnly
                value={enrollment.secret}
                revealLabel={t('security.twoFactor.reveal', 'Show setup key')}
                hideLabel={t('security.twoFactor.hide', 'Hide setup key')}
                copyLabel={t('security.twoFactor.copyKey', 'Copy setup key')}
                copiedLabel={t('team.invite.copied', 'Copied')}
              />
            </FormField>

            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2 p-3">
              <MonoText className="min-w-0 flex-1 break-all text-caption">
                {enrollment.otpauthUrl}
              </MonoText>
              <CopyButton
                value={enrollment.otpauthUrl}
                label={t('security.twoFactor.copyLink', 'Copy setup link')}
                copiedLabel={t('team.invite.copied', 'Copied')}
              />
            </div>

            <FormField label={t('security.twoFactor.code', 'Code from your app')} required>
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                maxLength={20}
              />
            </FormField>

            {activate.error === null ? null : (
              <Alert
                role="alert"
                tone="danger"
                title={t('security.twoFactor.activateFailed', 'That code was not accepted')}
                body={activate.error.message}
              />
            )}

            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                type="button"
                disabled={activate.isPending}
                onClick={() => {
                  setEnrollment(null);
                  setCode('');
                  enroll.reset();
                }}
              >
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button type="submit" disabled={code.trim() === ''} loading={activate.isPending}>
                {t('security.twoFactor.activate', 'Turn on two-factor')}
              </Button>
            </div>
          </form>
        )}

        {enroll.error === null ? null : (
          <Alert
            role="alert"
            tone="danger"
            title={t('security.twoFactor.enrollFailed', 'Could not start setup')}
            body={enroll.error.message}
          />
        )}
      </CardBody>

      {disabling ? (
        <DisableTwoFactorDialog
          busy={disable.isPending}
          error={disable.error === null ? null : disable.error.message}
          password={password}
          onPasswordChange={setPassword}
          onClose={() => {
            setDisabling(false);
            setPassword('');
            disable.reset();
          }}
          onConfirm={() => disable.mutate({ password })}
        />
      ) : null}
    </Card>
  );
}

/**
 * Turning 2FA off asks for the password, because the endpoint does: it is the
 * one control on this page that REMOVES a protection, and a session left open
 * on a shared machine is exactly the threat the second factor was there for.
 */
function DisableTwoFactorDialog(props: {
  busy: boolean;
  error: string | null;
  password: string;
  onPasswordChange: (next: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}): ReactNode {
  return (
    <Modal
      open
      size="sm"
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <ModalHeader
        tone="danger"
        icon={<ShieldOff />}
        title={t('security.twoFactor.disableTitle', 'Turn off two-factor authentication')}
        subtitle={t(
          'security.twoFactor.disableBody',
          'Your account goes back to password-only, and your recovery codes stop working.',
        )}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody>
        <form
          id="disable-2fa"
          onSubmit={(event) => {
            event.preventDefault();
            if (props.password !== '' && !props.busy) props.onConfirm();
          }}
        >
          {/* The password IS the confirmation gate — the endpoint requires it,
              so a type-to-confirm word on top would be friction that proves
              nothing the password does not already prove. */}
          <FormField label={t('security.twoFactor.disablePassword', 'Your password')} required>
            <Input
              type="password"
              autoComplete="current-password"
              value={props.password}
              onChange={(event) => props.onPasswordChange(event.target.value)}
              autoFocus
            />
          </FormField>
          {props.error === null ? null : (
            <Alert
              role="alert"
              tone="danger"
              className="mt-4"
              title={t('security.twoFactor.disableFailed', 'Could not turn off two-factor')}
              body={props.error}
            />
          )}
        </form>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={props.onClose} disabled={props.busy}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button
          type="submit"
          form="disable-2fa"
          variant="destructive"
          disabled={props.password === ''}
          loading={props.busy}
          data-testid="security-2fa-disable-confirm"
        >
          {t('security.twoFactor.disableConfirm', 'Turn it off')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// --- sessions ----------------------------------------------------------------

function SessionsCard({ localeTag, now }: { localeTag: string; now: number }): ReactNode {
  const queryClient = useQueryClient();
  const sessions = useQuery(sessionsQuery());
  const [revoking, setRevoking] = useState<SessionDto | null>(null);

  const revoke = useMutation({
    mutationFn: (session: SessionDto) => revokeSession(session.id),
    onSuccess: async () => {
      setRevoking(null);
      await queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
    },
  });

  const rows = useMemo(() => sortSessions(sessions.data ?? []), [sessions.data]);

  return (
    <Card padded={false}>
      <CardHeader className="flex items-center gap-3">
        <IconTile tone="accent" size="md" icon={<Monitor />} />
        <h2 className="text-section flex-1 text-fg">{t('security.sessions.title', 'Signed in')}</h2>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        {sessions.isError ? (
          <Alert
            role="alert"
            tone="danger"
            title={t('security.sessions.failed', 'Could not read your sessions')}
            body={t(
              'security.sessions.failedBody',
              'This list is the only place that shows where your account is signed in, so treat an empty one as unknown rather than as none.',
            )}
          />
        ) : null}

        {rows.map((session) => {
          const device = deviceLabel(session.userAgent);
          const seen = formatSince(session.lastSeenAt, localeTag, now);
          return (
            <div
              key={session.id}
              data-testid="security-session"
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-2 p-3"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="truncate text-body-sm font-semibold text-fg">
                    {device ?? t('security.sessions.unknownDevice', 'Unrecognised device')}
                  </span>
                  {session.current ? (
                    <Badge tone="pos">{t('security.sessions.thisDevice', 'This device')}</Badge>
                  ) : null}
                </div>
                <span className="truncate text-caption text-fg-subtle">
                  {session.ip === null
                    ? t('security.sessions.noIp', 'No IP recorded')
                    : t('security.sessions.ip', 'IP {ip}', { ip: session.ip })}
                </span>
                {session.userAgent === null ? null : (
                  <MonoText className="truncate text-caption text-fg-subtle">{session.userAgent}</MonoText>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-caption text-fg-muted">
                  {seen === null
                    ? t('security.sessions.seenUnknown', 'Last seen: unknown')
                    : t('security.sessions.seen', 'Last seen {since}', { since: seen })}
                </span>
                <span className="text-caption text-fg-subtle">
                  {t('security.sessions.expires', 'Expires {at}', {
                    at: formatStamp(session.expiresAt, localeTag) ?? '',
                  })}
                </span>
              </div>
              {session.current ? null : (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={revoke.isPending}
                  onClick={() => setRevoking(session)}
                >
                  {t('security.sessions.revoke', 'Sign out')}
                </Button>
              )}
            </div>
          );
        })}

        {!sessions.isError && rows.length === 0 ? (
          <p className="text-body-sm text-fg-muted">
            {t('security.sessions.loading', 'Looking for other signed-in devices…')}
          </p>
        ) : null}
      </CardBody>

      {revoking === null ? null : (
        <Modal
          open
          size="sm"
          onOpenChange={(open) => {
            if (!open) setRevoking(null);
          }}
        >
          <ModalHeader
            tone="danger"
            icon={<Monitor />}
            title={t('security.sessions.revokeTitle', 'Sign this device out')}
            subtitle={t(
              'security.sessions.revokeBody',
              'The session ends immediately and whoever is using it has to sign in again.',
            )}
            closeLabel={t('common.close', 'Close')}
          />
          <ModalBody>
            <MonoText className="break-all text-caption text-fg-muted">
              {revoking.userAgent ?? revoking.id}
            </MonoText>
            {revoke.error === null ? null : (
              <Alert
                role="alert"
                tone="danger"
                className="mt-4"
                title={t('security.sessions.revokeFailed', 'Could not sign that device out')}
                body={revoke.error.message}
              />
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={() => setRevoking(null)} disabled={revoke.isPending}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              loading={revoke.isPending}
              onClick={() => revoke.mutate(revoking)}
              data-testid="security-session-revoke"
            >
              {t('security.sessions.revoke', 'Sign out')}
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </Card>
  );
}
