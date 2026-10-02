// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "This link has been used" — what `/design` shows with no session, when the
 * server signs its owner in with the one-use link `adminium design` opens.
 * A second tab, a copied link, a reload after the session ended: each lands
 * here, and the way back in is to run the command again.
 *
 * Designer Pieces, piece 4. The command is always left-to-right. Our tokens win
 * over the comp's dark code strip: a quiet `surface-2` line, as the dashboard
 * shows commands elsewhere.
 */
import { useState, type ReactNode } from 'react';
import { Check, Copy, Hexagon, Link2Off } from 'lucide-react';

import { t } from '../i18n/t.js';
import { useDesignerMessages } from './designerMessages.js';

export const DESIGN_COMMAND = 'npx @adminiumjs/adminium design';

export function SpentLinkPage(): ReactNode {
  useDesignerMessages();
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    void navigator.clipboard?.writeText(DESIGN_COMMAND).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-bg p-6 text-fg">
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 items-center justify-center rounded-lg bg-accent text-accent-fg" aria-hidden="true">
          <Hexagon className="size-4" />
        </span>
        <span className="text-[15px] font-extrabold tracking-tight">{t('designer:brand', 'Adminium Designer')}</span>
      </div>
      <div className="flex w-full max-w-[460px] flex-col items-center rounded-2xl border border-border bg-surface px-7 pb-7 pt-8 text-center shadow-md">
        <div className="mb-4 flex size-[46px] items-center justify-center rounded-[13px] bg-surface-3 text-fg-muted" aria-hidden="true">
          <Link2Off className="size-[22px]" />
        </div>
        <h1 className="m-0 text-xl font-extrabold tracking-tight">{t('designer:spent.title', 'This link has been used')}</h1>
        <p className="mt-2 text-[13.5px] leading-normal text-fg-muted">{t('designer:spent.body', 'Run the design command again to open Adminium Designer.')}</p>
        <div dir="ltr" className="mt-5 flex w-full items-center gap-2 rounded-xl border border-border bg-surface-2 py-1.5 pe-1.5 ps-3.5 text-start">
          <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap py-1.5 font-mono text-[12.5px] text-fg">{DESIGN_COMMAND}</code>
          <button
            type="button"
            onClick={copy}
            aria-label={t('designer:spent.copy', 'Copy the command')}
            title={copied ? t('designer:spent.copied', 'Copied') : t('designer:spent.copy', 'Copy the command')}
            className="flex size-[34px] shrink-0 items-center justify-center rounded-[9px] border border-border bg-surface text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {copied ? <Check className="size-[15px]" aria-hidden="true" /> : <Copy className="size-[15px]" aria-hidden="true" />}
          </button>
        </div>
      </div>
    </main>
  );
}
