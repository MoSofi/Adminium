// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Asked before the build page is left with text typed in the Code tab and not
 * saved: by a link inside the app (the dialog here), and by closing or
 * reloading the tab (the browser's own question). Nothing typed, nothing asked.
 */
import { useEffect, type ReactNode } from 'react';
import { useBlocker } from '@tanstack/react-router';
import { FilePenLine } from 'lucide-react';
import { Button, Modal, ModalHeader } from '@adminium/ui';

import { t } from '../../i18n/t.js';

export function LeaveGuard({ count }: { /** How many files hold unsaved text. */ count: number }): ReactNode {
  const unsaved = count > 0;
  const blocker = useBlocker({ shouldBlockFn: () => unsaved, enableBeforeUnload: false, disabled: !unsaved, withResolver: true });
  // Closing or reloading the tab: only the browser can ask, in its own words.
  useEffect(() => {
    if (!unsaved) return;
    const hold = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', hold);
    return () => window.removeEventListener('beforeunload', hold);
  }, [unsaved]);
  const asking = blocker.status === 'blocked';
  return (
    <Modal open={asking} onOpenChange={(open) => (open ? undefined : blocker.reset?.())} size="md" className="max-w-[440px] rounded-[16px] leading-[normal]">
      <ModalHeader
        hideClose
        closeLabel={t('designer:model.close', 'Close')}
        tone="warn"
        icon={<FilePenLine />}
        title={t('designer:code.leaveTitle', 'Leave without saving?')}
        subtitle={<p className="m-0 mt-1.5 text-pretty text-[13px] leading-[1.6] text-fg-muted">{t('designer:code.leaveBody', 'You have unsaved changes in {count, plural, one {# file} other {# files}}. They are lost if you leave.', { count })}</p>}
        className="gap-[14px] px-[22px] pb-0 pt-[22px] [&>div:first-child]:size-[38px] [&>div:first-child]:rounded-[11px] [&>div:first-child_svg]:size-[19px]"
      />
      <div className="flex justify-end gap-2 p-[20px_22px]">
        <Button variant="secondary" size="lg" onClick={() => blocker.reset?.()} className="rounded-[10px] text-[13px] font-bold">
          {t('designer:code.leaveStay', 'Stay')}
        </Button>
        <Button variant="primary" size="lg" onClick={() => blocker.proceed?.()} className="rounded-[10px] text-[13px] font-bold">
          {t('designer:code.leaveGo', 'Leave')}
        </Button>
      </div>
    </Modal>
  );
}
