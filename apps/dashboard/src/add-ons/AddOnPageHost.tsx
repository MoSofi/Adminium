// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The host for a page an ADD-ON owns: `/add-ons/<key>/<ref>` (51 §1.3).
 *
 * One route serves every add-on page there will ever be, so this component
 * answers three questions before it renders anything: does this add-on
 * contribute pages at all, does it have one at this address, and can its module
 * be fetched and checked. Each of those has its own sentence on screen, because
 * each has a different answer — install it, check the URL, or something is
 * wrong with the package.
 *
 * **A blank screen is the one outcome this route may never produce.** It is
 * also the default outcome of getting any of this subtly wrong: a bundle that
 * brought its own react-query hangs in an empty provider, a module whose
 * integrity fails imports as nothing, and a page component that throws takes
 * the shell down with it if nothing catches it. Hence the named states, the
 * error boundary, and the runtime installed BEFORE the import
 * (`ensureAddOnRuntime`, awaited inside `loadAddOnModule`).
 *
 * The rail's `addOnNav` is the source of truth for what exists — it already
 * lists every page an enabled add-on declares — and the add-ons list reply
 * supplies the URL and the integrity to pin for the module.
 */
import { Component, Suspense, use, useEffect, useState, type ReactNode } from 'react';
import { useParams } from '@tanstack/react-router';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Button, EmptyState, Spinner } from '@adminium/ui';

import { addOnNavOf, bootstrapQuery, type AddOnNavPage } from '../app/bootstrap.js';
import { addOnsQuery } from '../studio/add-ons/addOnsApi.js';
import { t } from '../i18n/t.js';
import { addOnMessagesReady } from './addOnMessages.js';
import { isComponent, loadAddOnModule } from './client.js';

/** What an add-on page module's default export must be: a component. */
type PageComponent = (props: Record<string, never>) => ReactNode;

type MountState =
  | { status: 'loading' }
  | { status: 'ready'; Component: PageComponent }
  | { status: 'failed'; error: Error };

/**
 * A page's own crash, kept off the shell.
 *
 * A class component because that is still the only way to catch a render
 * error in React, and the code being caught here is code this repository did
 * not write.
 */
class PageBoundary extends Component<{ children: ReactNode; onError: (error: Error) => void }, { crashed: boolean }> {
  override state = { crashed: false };

  static getDerivedStateFromError(): { crashed: boolean } {
    return { crashed: true };
  }

  override componentDidCatch(error: Error): void {
    this.props.onError(error);
  }

  override render(): ReactNode {
    return this.state.crashed ? null : this.props.children;
  }
}

function Failed({ title, body, onRetry }: { title: string; body: string; onRetry?: () => void }) {
  return (
    <EmptyState
      title={title}
      body={body}
      actions={
        onRetry === undefined ? undefined : (
          <Button onClick={onRetry}>{t('addOns:retry', 'Try again')}</Button>
        )
      }
    />
  );
}

/**
 * Loads the module for one page and renders it, or says why it cannot.
 *
 * `useQuery`, not `useSuspenseQuery`: this component is already rendering a
 * spinner for the module load, so a second suspension would need a boundary
 * above it for no gain — and a suspending read with no boundary renders
 * NOTHING at all, which is the failure this file exists to avoid.
 */
function MountedPage({ page }: { page: AddOnNavPage }) {
  const addOns = useQuery(addOnsQuery);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<MountState>({ status: 'loading' });

  const installed = addOns.data?.find((addOn) => addOn.key === page.addOnKey);
  const bundle = installed?.bundles.find((file) => file.path === page.client);

  useEffect(() => {
    if (bundle === undefined) return;
    let alive = true;
    setState({ status: 'loading' });
    loadAddOnModule({ url: bundle.url, integrity: bundle.integrity }).then(
      (value) => {
        if (!alive) return;
        if (!isComponent(value)) {
          setState({
            status: 'failed',
            error: new Error(`${page.client} does not export a component as its default export.`),
          });
          return;
        }
        setState({ status: 'ready', Component: value as PageComponent });
      },
      (error: unknown) => {
        if (alive) {
          setState({ status: 'failed', error: error instanceof Error ? error : new Error(String(error)) });
        }
      },
    );
    return () => {
      alive = false;
    };
  }, [bundle?.url, bundle?.integrity, attempt]);

  // Still asking which bundles this add-on ships.
  if (addOns.isPending) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  /*
   * The LIST failed, which is a different thing from the package being wrong —
   * and telling them apart matters, because this one is worth retrying and the
   * other is not. Found the honest way: a test stub shaped the reply one level
   * too deep, the query resolved to nothing, and the screen blamed the add-on
   * for not shipping a file it ships perfectly well.
   */
  if (addOns.isError) {
    return (
      <Failed
        title={t('addOns:failed.title', 'This page could not be loaded')}
        body={t(
          'addOns.page.listFailed.body',
          'The list of installed add-ons could not be read, so there is no way to tell which file this page should load.',
        )}
        onRetry={() => void addOns.refetch()}
      />
    );
  }

  /*
   * The manifest names a module the package does not serve. The server refuses
   * any path the manifest does not declare, so the honest reading is a broken
   * or half-written package rather than a missing file — and an upgrade is what
   * fixes it, which is why this does not offer a retry.
   */
  if (bundle === undefined) {
    return (
      <Failed
        title={t('addOns:noBundle.title', 'This page could not be loaded')}
        body={t(
          'addOns.page.noBundle.body',
          'The add-on declares this page but does not ship the file it points at. Installing it again, or upgrading it, is what fixes this.',
        )}
      />
    );
  }

  if (state.status === 'failed') {
    return (
      <Failed
        title={t('addOns:failed.title', 'This page could not be loaded')}
        body={t(
          'addOns.page.failed.body',
          'The add-on’s code could not be fetched, or it did not match the fingerprint recorded when it was installed. Nothing from it has been run.',
        )}
        onRetry={() => setAttempt((value) => value + 1)}
      />
    );
  }

  if (state.status === 'loading') {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  const Page = state.Component;
  return (
    <PageBoundary
      onError={(error) => {
        setState({ status: 'failed', error });
      }}
    >
      <Suspense
        fallback={
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        }
      >
        <Page />
      </Suspense>
    </PageBoundary>
  );
}

/**
 * The namespace these states are written in is deferred (`addOnMessages.ts`),
 * so it is awaited before anything here renders a sentence. Without this the
 * first paint of "this add-on is not installed" would be the English fallback
 * even for a reader whose language has it translated.
 */
export function AddOnPageHost() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      }
    >
      <AddOnPageHostMessages />
    </Suspense>
  );
}

function AddOnPageHostMessages() {
  use(addOnMessagesReady());
  return <ResolvedAddOnPage />;
}

function ResolvedAddOnPage() {
  const { key, _splat } = useParams({ from: '/app/add-ons/$key/$' });
  const bootstrap = useSuspenseQuery(bootstrapQuery());
  const pages = addOnNavOf(bootstrap.data).pages.filter((page) => page.addOnKey === key);

  /*
   * The first segment of the splat is the page ref; the rest belongs to the
   * page itself (`documents/42`). An empty splat means the add-on's own root,
   * which resolves to its first declared page — the behaviour `/a/$appKey`
   * already has for a hosted app.
   */
  const ref = (_splat ?? '').split('/')[0] ?? '';
  const page = ref === '' ? pages[0] : pages.find((candidate) => candidate.ref === ref);

  if (pages.length === 0) {
    return (
      <EmptyState
        title={t('addOns:notInstalled.title', 'This add-on is not installed')}
        body={t(
          'addOns.page.notInstalled.body',
          'The page you followed belongs to an add-on this workspace does not have installed, or that has been switched off. An administrator can install it from Studio.',
        )}
      />
    );
  }

  if (page === undefined) {
    return (
      <EmptyState
        title={t('addOns:unknown.title', 'No such page')}
        body={t(
          'addOns.page.unknown.body',
          'This add-on is installed, but it does not have a page at this address.',
        )}
      />
    );
  }

  // Keyed by page: switching between two pages of one add-on is a different
  // module, not a re-render of the same one with new props.
  return <MountedPage key={`${page.addOnKey}/${page.ref}`} page={page} />;
}
