// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LANDING PAGE, AS A STRANGER SEES IT (`/x/pages/<slug>`): a chunk of its
 * own, loaded only for a landing page, with the renderer and its styles
 * (`@adminium/add-on-contracts/landing/render`, `landing.css`). A form's page
 * and a chat's window never load a byte of it.
 *
 * THE SHELL is the `/x/` shell every stranger's page has (`../Shell.tsx`):
 * the business's logo and name over the page, the fixed footer under it
 * (its legal name, where to write, the privacy notice, and "Cookie choice" at
 * "Per visitor"). No language menu: a page is written in one language, and
 * the page is drawn in it, its direction with it. Light only, as its owner
 * sees it in the editor.
 *
 * THE PAGE is the renderer's, in `stranger` mode, with what it cannot draw
 * on its own filled here:
 *  - a Form block draws the real form (`FormBlock.tsx`); a block whose form
 *    is not live, or has no version in the page's language, is left out of
 *    the page (the door says null for it), and so is a button whose page or
 *    form is not there;
 *  - a picture is the page's own copy, from the address the door gave
 *    (`Picture.tsx`), with the quiet box when it does not load;
 *  - a feature's icon from the closed list (`icons.tsx`);
 *  - a link to another page, by the address the door gave (null while that
 *    page is not live).
 *
 * THE BANNER, at "Per visitor", is the visitor banner every `/x/` page
 * mounts (`../banner/VisitorBanner.tsx`), docked under the page the same way
 * as on a form's page.
 *
 * WHILE IT LOADS, the header and footer frames and three quiet blocks, with
 * "Loading the page…" said once. A page that is not there, a draft, one
 * switched off: "This page isn't available." A page that cannot be reached
 * says so, with "Try again".
 */
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { switchLocale } from '@adminium/i18n/page';
import { useI18n, useT } from '@adminium/i18n/react';
import { RotateCcw, SearchX, TriangleAlert } from 'lucide-react';
import { LandingPageView } from '@adminium/add-on-contracts/landing/render';
import '@adminium/add-on-contracts/landing/landing.css';

import type { XBusiness } from '../api.js';
import { Icon, MailLink } from '../FormBody.js';
import type { XRoute } from '../route.js';
import { XFooter, XHeader } from '../Shell.js';
import { xLocaleFor } from '../words.js';
import { ACCENTS } from '../XApp.js';
import { fetchLandingPage, type XLandingPage } from './api.js';
import { FormBlock } from './FormBlock.js';
import { featureIcon } from './icons.js';
import { PagePicture } from './Picture.js';
import './pages.css';

const VisitorBanner = lazy(() => import('../banner/VisitorBanner.js'));

const NOBODY: XBusiness = { name: '', legalName: null, email: null, privacyNotice: null, hasLogo: false };

type Live = Extract<XLandingPage, { state: 'live' }>;

/** The page as a stranger is shown it: every Form block whose form is left out goes too. */
function shownPage(data: Live): Live['page'] {
  return { ...data.page, blocks: data.page.blocks.filter((block) => block.kind !== 'form' || (data.forms[block.addOn]?.[block.form] ?? null) !== null) };
}

export function LandingApp({ route }: { route: Extract<XRoute, { kind: 'page' }> }): ReactNode {
  const t = useT();
  const i18n = useI18n();
  const [data, setData] = useState<XLandingPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [live, setLive] = useState('');
  const [docked, setDocked] = useState(false);
  const [reopen, setReopen] = useState(0);

  async function load(): Promise<void> {
    setFailed(false);
    try {
      const next = await fetchLandingPage(route.slug, route.preview);
      if (ACCENTS.has(next.accent)) document.documentElement.dataset['accent'] = next.accent;
      if (next.state === 'live') {
        // The engine's few words (the footer's, a form's) in the page's own language; the page itself is its owner's.
        await switchLocale(i18n, xLocaleFor(next.language, []));
        document.documentElement.lang = next.language;
        document.documentElement.dir = next.dir;
        document.title = next.page.title;
      } else if (next.business.name !== '') {
        document.title = next.business.name;
      }
      setData(next);
    } catch {
      setFailed(true);
      setLive(`${t('x:ending.offline', 'This page could not be reached.')} ${t('x:ending.offlineBody', 'Check your connection and try again.')}`);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const business = data?.business ?? NOBODY;
  const page = data?.state === 'live' ? data : null;
  // Never in a preview: the server says nothing of it there.
  const visitor = page !== null && page.preview !== true ? page.visitor : undefined;

  let body: ReactNode;
  if (page !== null) {
    body = (
      <main className="xp-main">
        <LandingPageView
          page={shownPage(page)}
          language={page.language}
          dir={page.dir}
          mode="stranger"
          slots={{
            form: (block) => {
              const entry = page.forms[block.addOn]?.[block.form] ?? null;
              return entry === null ? null : (
                <FormBlock
                  block={block}
                  entry={entry}
                  pageKey={page.key}
                  preview={page.preview === true}
                  business={business}
                  query={route.query}
                  tag={page.language}
                  rtl={page.dir === 'rtl'}
                  say={setLive}
                />
              );
            },
            picture: (ref, { decorative, alt }) => <PagePicture src={page.pictures[ref.file]} alt={alt} decorative={decorative} />,
            icon: featureIcon,
            pageHref: (key) => page.links[key] ?? null,
          }}
        />
      </main>
    );
  } else if (data !== null || failed) {
    const unavailable = !failed;
    body = (
      <main className="x-main">
        <section className="x-card x-status" data-tone={unavailable ? 'neutral' : 'warning'} aria-labelledby="x-status-title">
          <div className="x-status-head">
            <span className="x-tile">
              <Icon of={unavailable ? SearchX : TriangleAlert} />
            </span>
            <div className="x-status-text">
              <h1 id="x-status-title" className="x-h2">
                {unavailable ? t('x:ending.unavailable', 'This page isn’t available.') : t('x:ending.offline', 'This page could not be reached.')}
              </h1>
              {unavailable ? null : <p>{t('x:ending.offlineBody', 'Check your connection and try again.')}</p>}
            </div>
          </div>
          {unavailable ? null : (
            <button type="button" className="x-button" onClick={() => void load()}>
              <Icon of={RotateCcw} size={16} />
              <span>{t('x:ending.retry', 'Try again')}</span>
            </button>
          )}
          {business.email !== null ? <MailLink email={business.email} icon /> : null}
        </section>
      </main>
    );
  } else {
    body = (
      <main className="xp-loading" aria-busy="true">
        <span role="status" className="x-sr">
          {t('x:pages.loading', 'Loading the page…')}
        </span>
        <div className="xp-quiet" data-size="s" aria-hidden="true" />
        <div className="xp-quiet" data-size="l" aria-hidden="true" />
        <div className="xp-quiet" data-size="m" aria-hidden="true" />
      </main>
    );
  }

  return (
    <div className="x-page xp-page" data-docked={docked ? '' : undefined}>
      <div role="status" aria-live="polite" className="x-sr">
        {live}
      </div>
      <XHeader business={business} />
      {visitor === undefined ? null : (
        <Suspense fallback={null}>
          <VisitorBanner visitor={visitor} privacyNotice={business.privacyNotice} reopen={reopen} onDocked={setDocked} />
        </Suspense>
      )}
      <div className="x-scroll">
        {body}
        <XFooter business={business} onCookieChoice={visitor === undefined ? undefined : () => setReopen((n) => n + 1)} />
      </div>
    </div>
  );
}
