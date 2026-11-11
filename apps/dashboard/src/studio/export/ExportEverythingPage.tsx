// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Server settings → Export everything (`/studio/settings/export`), for
 * Super Admins.
 *
 * One file with everything made in this installation (the instance archive's
 * export variant, no passwords, secrets or keys), made on the server and
 * downloaded ONCE: "Download everything" → "Preparing your file… N%" → the
 * file's name and size with one "Download". After the download the page is
 * back at "Download everything"; a file left waiting expires and the page says
 * so. Then how to move it: `adminium import-zip <file>` on a server, or the
 * desktop app's File → "Open a project…"; and "Put this online", unless the
 * operator switched it off.
 *
 * On the desktop the project has its own "Export this project…" (the
 * Designer's project menu), and this page points there instead.
 */
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Check, Copy, Download, FileArchive, Globe, Loader, Minus, Monitor, Package, Server, SquareArrowOutUpRight } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { getFormatters } from '@adminium/i18n';
import { Alert, Button, Card, ProgressBar } from '@adminium/ui';
import { Link } from '@tanstack/react-router';

import { ApiError } from '../../app/api.js';
import { bootstrapQuery } from '../../app/bootstrap.js';
import { showsDeployLink, systemInfoQuery } from '../../app/capabilities.js';
import { getI18nInstance, t } from '../../i18n/t.js';
import { docsUrl, PUT_ONLINE_URL } from '../../kb/docsLinks.js';
import { getDesktopApi, isDesktopRuntime } from '../../lib/desktop-runtime.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { EXPORT_STATE_KEY, IMPORT_COMMAND, exportDownloadHref, exportStateQuery, startExport, type ExportView } from './exportApi.js';

const SUPER_ADMIN_ROLE = 'super-admin';
/** Where "export the database" leads: the docs on dumping a database on another host. */
export const DATABASE_ROWS_DOCS = docsUrl('self-hosting/export-everything#database-rows');

function formatBytes(bytes: number): string {
  return getFormatters(getI18nInstance()?.language ?? 'en-US').bytes(bytes);
}

/** A 34 px square holding a 16 px icon. */
function Tile({ icon }: { icon: ReactNode }): ReactNode {
  return (
    <span aria-hidden="true" className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] bg-surface-3 text-fg-muted [&_svg]:size-4">
      {icon}
    </span>
  );
}

/** "The database rows, unless you export the database": the link sits where each language puts it. */
function RowsLeftOut(): ReactNode {
  // `{link}` is handed itself back, so the sentence arrives with the marker in place, in any word order.
  const sentence = t('studio:exportEverything.out.rows', 'The database rows, unless you {link}', { link: '{link}' });
  const [before, after = ''] = sentence.split('{link}');
  return (
    <span>
      {before}
      <a href={DATABASE_ROWS_DOCS} target="_blank" rel="noreferrer noopener" className="font-bold text-accent hover:underline">
        {t('studio:exportEverything.out.rowsLink', 'export the database')}
      </a>
      {after}
    </span>
  );
}

function Holds(): ReactNode {
  const inFile = [
    t('studio:exportEverything.holds.pages', 'Pages'),
    t('studio:exportEverything.holds.tables', 'Tables’ settings'),
    t('studio:exportEverything.holds.roles', 'Roles'),
    t('studio:exportEverything.holds.views', 'Views'),
    t('studio:exportEverything.holds.apps', 'Apps’ settings'),
    t('studio:exportEverything.holds.files', 'Uploaded files'),
  ];
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <div className="flex flex-col gap-2">
        <div className="text-[11px] font-bold uppercase tracking-[.05em] text-pos">{t('studio:exportEverything.inFile', 'In the file')}</div>
        <ul className="flex flex-col gap-[7px] text-[13px]">
          {inFile.map((item) => (
            <li key={item} className="flex items-center gap-2">
              <Check className="size-[15px] shrink-0 text-pos" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-2">
        <div className="text-[11px] font-bold uppercase tracking-[.05em] text-fg-subtle">{t('studio:exportEverything.leftOut', 'Left out')}</div>
        <ul className="flex flex-col gap-[7px] text-[13px] text-fg-muted">
          <li className="flex items-center gap-2">
            <Minus className="size-[15px] shrink-0 text-fg-subtle" aria-hidden="true" />
            {t('studio:exportEverything.out.passwords', 'People’s passwords')}
          </li>
          <li className="flex items-center gap-2">
            <Minus className="size-[15px] shrink-0 text-fg-subtle" aria-hidden="true" />
            {t('studio:exportEverything.out.secrets', 'Secrets and keys')}
          </li>
          <li className="flex items-start gap-2">
            <Minus className="mt-0.5 size-[15px] shrink-0 text-fg-subtle" aria-hidden="true" />
            <RowsLeftOut />
          </li>
        </ul>
      </div>
    </div>
  );
}

/** Idle, preparing, ready, expired or failed: the part of the card below the line. */
function DownloadState(): ReactNode {
  const client = useQueryClient();
  const state = useQuery(exportStateQuery());
  /** The id whose download was pressed: the page is back at "Download everything" at once. */
  const [taken, setTaken] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: startExport,
    onSuccess: (reply) => {
      setTaken(null);
      client.setQueryData(EXPORT_STATE_KEY, reply);
    },
  });

  const view: ExportView | null = state.data?.export ?? null;
  const shown = view !== null && view.id === taken ? null : view;
  const busy = start.isPending;

  const button = (
    <div>
      <Button variant="primary" size="md" iconLeft={<Download className="size-[15px]" />} onClick={() => start.mutate()} disabled={busy} data-testid="export-download-everything">
        {t('studio:exportEverything.downloadEverything', 'Download everything')}
      </Button>
    </div>
  );
  const refused = start.error instanceof ApiError ? start.error.message : start.error === null ? null : t('studio:exportEverything.startFailed', 'The export could not be started.');

  if (shown === null || shown.state === 'expired' || shown.state === 'failed') {
    return (
      <div className="flex flex-col gap-3">
        {shown?.state === 'expired' ? (
          <Alert tone="info" title={t('studio:exportEverything.expired', 'That file expired before it was downloaded. Download everything again.')} />
        ) : null}
        {shown?.state === 'failed' ? <Alert tone="danger" title={t('studio:exportEverything.failed', 'The file could not be made.')} body={shown.message} /> : null}
        {refused === null ? null : <Alert tone="warn" title={refused} />}
        {button}
      </div>
    );
  }

  if (shown.state === 'preparing') {
    return (
      <div role="status" className="flex flex-col gap-2" data-testid="export-preparing">
        <div className="flex items-center gap-2 text-[13px] font-bold">
          <Loader className="size-[15px] text-accent motion-safe:animate-spin" aria-hidden="true" />
          {t('studio:exportEverything.preparing', 'Preparing your file… {percent}%', { percent: shown.percent })}
        </div>
        <ProgressBar value={shown.percent} className="h-2 rounded-lg" animated={false} label={t('studio:exportEverything.progressLabel', 'Preparing your file')} />
      </div>
    );
  }

  return (
    <div role="status" className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-3.5 py-3" data-testid="export-ready">
      <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-pos-soft text-pos">
        <FileArchive className="size-[17px]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[12.5px] font-semibold">{shown.fileName}</div>
        <div className="text-[12px] text-fg-muted">{t('studio:exportEverything.ready', 'Ready · {size}', { size: formatBytes(shown.bytes) })}</div>
      </div>
      <Button asChild variant="primary" size="md">
        <a href={exportDownloadHref(shown.id)} download={shown.fileName} onClick={() => setTaken(shown.id)}>
          <Download className="size-[15px]" aria-hidden="true" />
          {t('studio:exportEverything.download', 'Download')}
        </a>
      </Button>
    </div>
  );
}

function CopyCommand(): ReactNode {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);
  const copy = (): void => {
    void navigator.clipboard?.writeText(IMPORT_COMMAND).then(() => {
      setCopied(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <div className="flex max-w-[420px] items-center gap-2 rounded-[10px] border border-border-strong bg-surface-2 py-1.5 pe-1.5 ps-3">
      <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-fg">{IMPORT_COMMAND}</code>
      <button
        type="button"
        onClick={copy}
        aria-label={t('studio:exportEverything.copyLabel', 'Copy the command')}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-2.5 py-[5px] text-[12px] font-bold text-fg hover:bg-surface-3"
        data-testid="export-copy-command"
      >
        {copied ? (
          <span className="inline-flex items-center gap-1.5 text-pos">
            <Check className="size-[13px]" aria-hidden="true" />
            {t('studio:exportEverything.copied', 'Copied')}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <Copy className="size-[13px]" aria-hidden="true" />
            {t('studio:exportEverything.copy', 'Copy')}
          </span>
        )}
      </button>
    </div>
  );
}

function MoveCard(): ReactNode {
  const heading = useId();
  return (
    <Card aria-labelledby={heading} className="flex flex-col gap-3.5">
      <h2 id={heading} className="text-[14.5px] font-bold">
        {t('studio:exportEverything.move.title', 'Move to another host')}
      </h2>
      <div className="flex items-start gap-3">
        <Tile icon={<Server />} />
        <div className="flex min-w-0 flex-1 flex-col gap-[7px]">
          <div className="text-[13px] font-bold">{t('studio:exportEverything.move.server', 'On your own server')}</div>
          <CopyCommand />
        </div>
      </div>
      <div className="flex items-start gap-3">
        <Tile icon={<Monitor />} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold">{t('studio:exportEverything.move.desktop', 'In the desktop app')}</div>
          <p className="mt-0.5 text-[12.5px] text-fg-muted" data-testid="export-move-desktop">
            <DesktopLine />
          </p>
        </div>
      </div>
    </Card>
  );
}

/** A mark no translation holds: where the menu item's name goes in the sentence around it. */
const ITEM_MARK = '\u2063';

/** "Choose **Open a project** and pick the file.": the desktop's menu item, in bold, where the sentence puts it. */
function DesktopLine(): ReactNode {
  const item = t('studio:exportEverything.move.desktopItem', 'Open a project');
  const parts = t('studio:exportEverything.move.desktopLine', 'Choose {item} and pick the file.', { item: ITEM_MARK }).split(ITEM_MARK);
  return parts.map((part, index) => (
    <span key={index}>
      {index === 0 ? null : <strong className="text-fg">{item}</strong>}
      {part}
    </span>
  ));
}

function PutOnlineCard(): ReactNode {
  return (
    <a
      href={PUT_ONLINE_URL}
      target="_blank"
      rel="noreferrer noopener"
      className="flex items-center gap-3 rounded-[14px] border border-border bg-surface p-[var(--card-pad)] text-fg no-underline shadow-sm hover:border-border-strong hover:text-fg hover:no-underline"
      data-testid="export-put-online"
    >
      <Tile icon={<Globe />} />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-bold">{t('studio:exportEverything.putOnline.title', 'Put this online')}</div>
        <p className="mt-0.5 text-[12.5px] text-fg-muted">{t('studio:exportEverything.putOnline.line', 'Run this installation at its own public address.')}</p>
      </div>
      <SquareArrowOutUpRight className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
    </a>
  );
}

/** On the desktop: the project's own export, in the Designer's project menu. */
function DesktopPointer(): ReactNode {
  const canExport = getDesktopApi()?.project?.export !== undefined;
  return (
    <Card className="flex items-start gap-3" data-testid="export-desktop">
      <Tile icon={<Package />} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h2 className="text-[14.5px] font-bold">{t('studio:exportEverything.desktop.title', 'Export this project…')}</h2>
        <p className="text-[12.5px] text-fg-muted">
          {t(
            'studio:exportEverything.desktop.line',
            'On this computer the project makes its own file: in the Designer, open the project’s menu (its name, top left) and choose Export this project….',
          )}
        </p>
        {canExport ? (
          <div>
            <Button asChild variant="outline" size="md">
              <Link to="/design">{t('studio:exportEverything.desktop.open', 'Open the Designer')}</Link>
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export function ExportEverythingPage(): ReactNode {
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const deployLink = showsDeployLink(useQuery(systemInfoQuery()).data);
  const holdsHeading = useId();
  const superAdmin = bootstrap.roles.includes(SUPER_ADMIN_ROLE);
  const desktop = isDesktopRuntime();

  let body: ReactNode;
  if (!superAdmin) {
    body = (
      <Alert
        tone="info"
        title={t('studio:settingsHub.superAdminOnlyTitle', 'Super admin required')}
        body={t('studio:exportEverything.superAdminOnly', 'Only a super admin can export everything.')}
      />
    );
  } else if (desktop) {
    body = <DesktopPointer />;
  } else {
    body = (
      <>
        <Card aria-labelledby={holdsHeading} className="flex flex-col gap-4">
          <h2 id={holdsHeading} className="text-[14.5px] font-bold">
            {t('studio:exportEverything.holds.title', 'What the download holds')}
          </h2>
          <Holds />
          <div className="h-px bg-border" />
          <DownloadState />
        </Card>
        <MoveCard />
      </>
    );
  }

  return (
    <PageSurface width="page" className="flex max-w-[700px] flex-col gap-4" testId="studio-export-everything">
      <PageActions
        title={t('studio:exportEverything.title', 'Export everything')}
        subtitle={t('studio:exportEverything.subtitle', 'One file with everything you made in this installation.')}
        backTo="/studio/settings"
      />
      {body}
      {superAdmin && deployLink ? <PutOnlineCard /> : null}
    </PageSurface>
  );
}
