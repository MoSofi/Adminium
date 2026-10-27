// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A person's e-mail consent, mounted on an app's own screen (a CRM's contact
 * page): the very panel the dashboard's record page draws
 * (`consent/ConsentPanel.tsx`), over the person's own session.
 *
 * The part reads the panel itself (`POST /api/v1/consent/panel`) and reads it
 * again after every change it makes, then tells the app (`onChange`) so a line
 * of the app's own, which reads the same route, says the same. Its confirms
 * and its Record consent form open inside the panel, not over the page: the
 * kit styles nothing outside its own element.
 *
 * While it reads it says so; a read that failed (the person may not read the
 * record, the network) is said with "Try again"; a table no app declares as
 * people draws nothing. Another record, table or database in `update` reads
 * again; a new token is used by the next call.
 */
import { useMaybeT } from '@adminium/i18n/react';
import { Button } from '@adminium/ui';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { ConsentPanel } from '../../consent/ConsentPanel.js';
import type { ConsentPanelView, ConsentRecordRef } from '../../consent/consentTypes.js';
import { consentClient } from '../consent-client.js';
import type { ConsentProps, KitMounted } from '../contract.js';
import { mountReact } from '../root.js';

import './consent.css';

type Read = { kind: 'reading' } | { kind: 'failed' } | { kind: 'ready'; view: ConsentPanelView };

function KitConsent({ props }: { props: ConsentProps }): ReactNode {
  const t = useMaybeT();
  // What the app last gave, for the calls made later.
  const latest = useRef(props);
  latest.current = props;
  const client = useMemo(
    () =>
      consentClient(
        () => latest.current.csrfToken,
        () => latest.current.fetch,
      ),
    [],
  );
  const record: ConsentRecordRef = useMemo(() => ({ connectionId: props.connectionId, table: props.table, recordId: props.recordId }), [props.connectionId, props.table, props.recordId]);
  const [read, setRead] = useState<Read>({ kind: 'reading' });
  // The record a reply is for: one that comes back after the app moved to another record is dropped.
  const asked = useRef(record);

  const load = useCallback(async (): Promise<void> => {
    asked.current = record;
    try {
      const view = await client.panel(record);
      if (asked.current === record) setRead({ kind: 'ready', view });
    } catch {
      if (asked.current === record) setRead({ kind: 'failed' });
    }
  }, [client, record]);

  useEffect(() => {
    setRead({ kind: 'reading' });
    void load();
  }, [load]);

  if (read.kind === 'reading') {
    return (
      <p role="status" className="m-0 text-[12.5px] text-fg-muted" data-testid="kit-consent-reading">
        {t('common:consent.panel.loading', 'Loading their e-mail consent…')}
      </p>
    );
  }
  if (read.kind === 'failed') {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2.5 text-[12.5px]" data-testid="kit-consent-failed">
        <span>{t('common:consent.panel.loadFailed', 'Their e-mail consent could not be loaded.')}</span>
        <Button variant="secondary" size="sm" onClick={() => void load()}>
          {t('common:consent.panel.retry', 'Try again')}
        </Button>
      </div>
    );
  }
  // A table no app declares as people has no consent to show.
  if (!read.view.declared) return null;
  return (
    <ConsentPanel
      inline
      record={record}
      view={read.view}
      client={client}
      name={props.name ?? null}
      address={props.address ?? null}
      locale={props.locale}
      onChanged={async () => {
        await load();
        latest.current.onChange?.();
      }}
    />
  );
}

export default function mountConsent(element: Element, props: ConsentProps): Promise<KitMounted<ConsentProps>> {
  return mountReact<ConsentProps>('consent', element, props, (now) => <KitConsent props={now} />);
}
