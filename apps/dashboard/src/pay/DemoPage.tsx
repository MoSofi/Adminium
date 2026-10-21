// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The demo payment service's pretend hosted page: what a provider's page is
 * to a real checkout. Staff only, test mode only, no money. Each button is
 * one of the demo's cards; the page then sends the browser back to the pay
 * page's way back, which asks the server how it stands, as it would after a
 * real provider.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useT } from '@adminium/i18n/react';

import { driveDemo, fetchDemo, mayGoTo, type DemoCheckout } from './api.js';
import { money } from './money.js';

const ACTIONS = [
  { action: 'succeeds', key: 'pay:demo.succeeds', fallback: 'Pay: the card succeeds' },
  { action: 'fails', key: 'pay:demo.fails', fallback: 'Pay: the card is declined' },
  { action: 'needs-a-step', key: 'pay:demo.needsStep', fallback: 'Pay: the bank asks for a step' },
  { action: 'settles-late', key: 'pay:demo.settlesLate', fallback: 'Pay: the money arrives later' },
] as const;

export function DemoPage({ attempt, locale }: { attempt: string; locale: string }): ReactNode {
  const t = useT();
  const [checkout, setCheckout] = useState<DemoCheckout | null>(null);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchDemo(attempt)
      .then(setCheckout)
      .catch(() => setGone(true));
  }, [attempt]);

  async function press(action: string): Promise<void> {
    setBusy(true);
    try {
      const { back } = await driveDemo(attempt, action);
      if (mayGoTo(back, window.location.href)) window.location.assign(back);
    } catch {
      setGone(true);
      setBusy(false);
    }
  }

  return (
    <div className="pp-page">
      <div role="note" className="pp-test">
        {t('pay:testBand', 'Test page — no money moves.')}
      </div>
      <main className="pp-main" data-solo="">
        <div className="pp-col">
          <h1 className="pp-h1">{t('pay:demo.title', 'Demo payment service')}</h1>
          <p className="pp-small">{t('pay:demo.staff', 'Staff only. A pretend payment service: no money moves and no card is needed.')}</p>
          {gone ? <p className="pp-small">{t('pay:demo.gone', 'This demo payment cannot be continued. Go back to the pay page.')}</p> : null}
          {checkout === null ? null : (
            <div className="pp-card pp-hero">
              <span className="pp-micro">
                <bdi dir="ltr" className="pp-mono">
                  {checkout.label}
                </bdi>
              </span>
              <bdi dir="ltr" className="pp-amount">
                {money(checkout.amount, checkout.currency, locale)}
              </bdi>
            </div>
          )}
          {checkout === null ? null : (
            <section className="pp-ways">
              {checkout.status === 'requires_action' ? (
                <button type="button" className="pp-way pp-way-primary" aria-disabled={busy} onClick={() => !busy && void press('finish-step')}>
                  <span className="pp-way-text">
                    <span className="pp-way-label">{t('pay:demo.finishStep', "Finish the bank's step")}</span>
                  </span>
                </button>
              ) : (
                ACTIONS.map((one, index) => (
                  <button key={one.action} type="button" className={index === 0 ? 'pp-way pp-way-primary' : 'pp-way'} aria-disabled={busy} onClick={() => !busy && void press(one.action)}>
                    <span className="pp-way-text">
                      <span className="pp-way-label">{t(one.key, one.fallback)}</span>
                    </span>
                  </button>
                ))
              )}
              <button type="button" className="pp-text-button" aria-disabled={busy} onClick={() => !busy && void press('leave')}>
                {t('pay:demo.leave', 'Leave without paying')}
              </button>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
