// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/account/confirm-email/$token`: where the link mailed to a new sign-in
 * address lands. It sits inside the signed-in shell, so somebody who is not
 * signed in signs in first and comes back here.
 *
 * NOTHING HAPPENS ON OPENING THE PAGE. A mail scanner or a preview may load a
 * link, so the address moves only when the person presses the button.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { MailCheck } from 'lucide-react';
import { Alert, Button, Card, CardBody, CardHeader, IconTile } from '@adminium/ui';

import { ApiError } from '../app/api.js';
import { bootstrapQuery, type BootstrapData } from '../app/bootstrap.js';
import { t } from '../i18n/t.js';
import { PageSurface } from '../shell/PageSurface.js';
import { confirmEmailChange } from './meApi.js';

export function ConfirmEmailPage() {
  const { token } = useParams({ from: '/app/account/confirm-email/$token' });
  const queryClient = useQueryClient();
  const confirm = useMutation({
    mutationFn: () => confirmEmailChange(token),
    onSuccess: (user) => {
      queryClient.setQueryData<BootstrapData>(bootstrapQuery().queryKey, (prev) => (prev === undefined ? prev : { ...prev, user }));
    },
  });
  const status = confirm.error instanceof ApiError ? confirm.error.status : null;

  return (
    <PageSurface>
      <Card>
        <CardHeader className="flex items-center gap-3">
          <IconTile tone="accent" size="md" icon={<MailCheck />} />
          <h2 className="text-section text-fg">{t('account.confirmEmail.title', 'Confirm your new address')}</h2>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          {confirm.isSuccess ? (
            <Alert role="status" tone="pos" title={t('account.confirmEmail.doneTitle', 'Address changed')} body={t('account.confirmEmail.doneBody', 'Sign in with your new address from now on.')} data-testid="confirm-email-done" />
          ) : (
            <p className="text-body text-fg-muted">{t('account.confirmEmail.body', 'This makes the address in your email your sign-in address for this account.')}</p>
          )}
          {confirm.error === null ? null : (
            <Alert
              role="alert"
              tone="danger"
              title={t('account.confirmEmail.failedTitle', 'This link doesn’t work')}
              body={
                status === 409
                  ? t('account.confirmEmail.takenBody', 'That address now belongs to another account. Choose a different one on your account page.')
                  : status === 410
                    ? t('account.confirmEmail.failedBody', 'It may have expired, been replaced by a newer one, or belong to another account. You can ask for a new one on your account page.')
                    : confirm.error.message
              }
              data-testid="confirm-email-error"
            />
          )}
          <div className="flex justify-end gap-2">
            <Link to="/account" className="inline-flex items-center text-body-sm text-fg-muted hover:text-fg">
              {t('account.confirmEmail.back', 'Back to your account')}
            </Link>
            {confirm.isSuccess ? null : (
              <Button type="button" loading={confirm.isPending} disabled={confirm.isPending} onClick={() => confirm.mutate()} data-testid="confirm-email-action">
                {t('account.confirmEmail.action', 'Confirm address')}
              </Button>
            )}
          </div>
        </CardBody>
      </Card>
    </PageSurface>
  );
}
