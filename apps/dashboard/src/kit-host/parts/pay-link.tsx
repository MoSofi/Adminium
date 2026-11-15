// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A record's pay link, mounted on an app's own screen: "Copy pay link" copies
 * the record's current link when there is one — never retiring the link a
 * customer already holds — and makes one only when there is none; it then
 * says until when the link works. Over the person's own session: making a
 * link needs the record's update grant, as on the dashboard's panel.
 */
import { useMaybeT } from '@adminium/i18n/react';
import { useMemo, useRef, useState, type ReactNode } from 'react';

import type { KitMounted, PayLinkProps } from '../contract.js';
import { paymentsClient, PaymentRefused } from '../payments-client.js';
import { mountReact } from '../root.js';

import './files.css';

type Said = { kind: 'idle' } | { kind: 'copied'; until: number } | { kind: 'shown'; url: string } | { kind: 'failed'; message: string };

function PayLink({ props }: { props: PayLinkProps }): ReactNode {
  const t = useMaybeT();
  const latest = useRef(props);
  latest.current = props;
  const client = useMemo(() => paymentsClient(() => latest.current.csrfToken, () => latest.current.fetch), []);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Said>({ kind: 'idle' });

  const copy = async (): Promise<void> => {
    setBusy(true);
    try {
      const link = (await client.currentLink(props.payable)) ?? (await client.makeLink(props.payable)).link;
      try {
        await navigator.clipboard.writeText(link.url);
        setSaid({ kind: 'copied', until: link.expiresAt });
      } catch {
        // The browser would not copy: the address is shown to copy by hand.
        setSaid({ kind: 'shown', url: link.url });
      }
    } catch (error) {
      setSaid({ kind: 'failed', message: error instanceof PaymentRefused ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const day = (at: number): string => new Intl.DateTimeFormat(props.locale, { dateStyle: 'medium' }).format(new Date(at));
  return (
    <div className="adm-kit-field" data-part="kit-pay-link">
      <div className="adm-kit-files-actions">
        <button type="button" className="adm-kit-button" disabled={busy} onClick={() => void copy()} data-testid="kit-pay-link-copy">
          {t('payments:panel.copyLink', 'Copy pay link')}
        </button>
      </div>
      {said.kind === 'copied' ? (
        <p role="status" className="adm-kit-files-count" data-testid="kit-pay-link-copied">
          {t('payments:panel.toast.copied', 'Pay link copied.')} {t('payments:panel.linkLine', 'Pay link made {made} · works until {until}', { made: day(Date.now()), until: day(said.until) })}
        </p>
      ) : said.kind === 'shown' ? (
        <p role="status" className="adm-kit-files-count">
          {t('payments:panel.toast.copyFailed', 'The pay link is made, but this browser would not copy it: {url}', { url: said.url })}
        </p>
      ) : said.kind === 'failed' ? (
        <p role="alert" className="adm-kit-files-error">
          {t('payments:panel.toast.failed', 'That did not work: {message}', { message: said.message })}
        </p>
      ) : null}
    </div>
  );
}

export default function mountPayLink(element: Element, props: PayLinkProps): Promise<KitMounted<PayLinkProps>> {
  return mountReact<PayLinkProps>('pay-link', element, props, (now) => <PayLink props={now} />);
}
