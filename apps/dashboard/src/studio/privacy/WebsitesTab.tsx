// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Your websites" (comp `Privacy And Public Pages.dc.html`, board 5): the
 * websites that may show a form or the chat in a frame.
 *
 *  - The list, each with who listed it and when, and "Remove" (at once).
 *  - The add box: one website per line, each line checked as it is typed
 *    with the very check the server holds the save to
 *    (`@adminium/add-on-contracts/forms/websites`), its mark and message in a
 *    polite live list; "Add" stays off while any line fails. The save is all
 *    or none, and a refusal the server finds (the list changed meanwhile)
 *    shows on its line the same way.
 *  - "Put it on your website": the loader line on this server's public
 *    address, to copy.
 *
 * A listed website only frames a form and talks to it; it never reaches the
 * data (the note at the card's foot says so).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX, Copy, Check, Globe, ShieldCheck } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { checkWebsiteLines, type WebsiteLine, type WebsiteLineCode } from '@adminium/add-on-contracts/forms/websites';
import { Alert, Button, Card, Skeleton, Textarea } from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { getI18nInstance, t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { PublicReach } from './PublicReach.js';
import { addWebsites, PRIVACY_WEBSITES_QUERY_KEY, reachQuery, removeWebsite, websitesQuery, type ListedWebsite, type WebsitesList } from './privacyApi.js';

function locale(): string {
  return getI18nInstance()?.language ?? 'en-US';
}

/** One line's message, by its code (the server answers codes; the page words them). */
export function websiteLineWords(code: WebsiteLineCode): string {
  switch (code) {
    case 'one-per-line':
      return t('studio:privacy.websites.line.onePerLine', 'One website per line, no *');
    case 'https':
      return t('studio:privacy.websites.line.https', 'Use https://');
    case 'address':
      return t('studio:privacy.websites.line.address', 'Not a website address');
    case 'path':
      return t('studio:privacy.websites.line.path', 'Just the address, no path');
    case 'self':
      return t('studio:privacy.websites.line.self', "That's this server's own address");
    case 'listed':
      return t('studio:privacy.websites.line.listed', 'Already on the list');
    case 'ok':
      return t('studio:privacy.websites.line.ok', 'Ready to add');
  }
}

/** The lines of the add box worth checking: each trimmed, the empty ones left out. */
export function linesOf(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

export function WebsitesTab(): ReactNode {
  const websites = useQuery(websitesQuery());
  const reach = useQuery(reachQuery());
  return (
    <div className="flex flex-col gap-3.5">
      <PublicReach />
      {websites.isError ? (
        <Alert tone="danger" title={t('studio:privacy.websites.loadFailed', 'The websites could not be loaded. Try again.')} />
      ) : websites.data === undefined ? (
        <Skeleton className="h-[320px] w-full" />
      ) : (
        <WebsitesCard list={websites.data} self={reach.data?.origin ?? null} />
      )}
      <EmbedCard origin={reach.data?.origin ?? null} />
    </div>
  );
}

function WebsitesCard({ list, self }: { list: WebsitesList; self: string | null }): ReactNode {
  const ids = useId();
  const toasts = useAppToasts();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  /** What the server said of the lines last sent, while they are unchanged. */
  const [refused, setRefused] = useState<{ text: string; lines: WebsiteLine[]; tooMany: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const lines = linesOf(text);
  const fromServer = refused !== null && refused.text === text ? refused : null;
  const checks = fromServer?.lines ?? checkWebsiteLines(lines, { self, listed: list.websites.map((site) => site.origin) });
  const tooMany = fromServer?.tooMany === true || list.websites.length + lines.length > list.max;
  const bad = checks.some((line) => line.code !== 'ok');
  const canAdd = lines.length > 0 && !bad && !tooMany && !busy;
  const date = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' });

  const put = (next: WebsitesList) => queryClient.setQueryData(PRIVACY_WEBSITES_QUERY_KEY, next);

  async function add(): Promise<void> {
    setBusy(true);
    try {
      put(await addWebsites(lines));
      setText('');
      setRefused(null);
      toasts.push({ variant: 'success', title: t('studio:privacy.websites.added', 'Added') });
    } catch (error) {
      const details = error instanceof ApiError ? (error.details as { lines?: WebsiteLine[]; tooMany?: boolean } | undefined) : undefined;
      if (error instanceof ApiError && error.status === 422 && Array.isArray(details?.lines)) {
        setRefused({ text, lines: details.lines, tooMany: details.tooMany === true });
        void queryClient.invalidateQueries({ queryKey: PRIVACY_WEBSITES_QUERY_KEY });
      } else {
        toasts.push({ variant: 'error', title: t('studio:privacy.websites.addFailed', 'The websites were not added. Try again.') });
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(site: ListedWebsite): Promise<void> {
    setRemoving(site.origin);
    try {
      put(await removeWebsite(site.origin));
      toasts.push({ variant: 'success', title: t('studio:privacy.websites.removed', 'Removed {url}', { url: site.origin }) });
    } catch {
      void queryClient.invalidateQueries({ queryKey: PRIVACY_WEBSITES_QUERY_KEY });
      toasts.push({ variant: 'error', title: t('studio:privacy.websites.removeFailed', '{url} was not removed. Try again.', { url: site.origin }) });
    } finally {
      setRemoving(null);
    }
  }

  const headingId = `${ids}-heading`;
  const fieldId = `${ids}-field`;
  const helpId = `${ids}-help`;
  const listId = `${ids}-checks`;
  return (
    <Card padded={false} className="overflow-hidden" data-testid="privacy-websites">
      <div className="border-b border-border p-[var(--card-pad)]">
        <h2 id={headingId} className="text-[14.5px] font-bold">
          {t('studio:privacy.websites.listHeading', 'Websites that may show your forms and chat')}
        </h2>
      </div>
      {list.websites.length === 0 ? (
        <p className="border-b border-border px-[var(--card-pad)] py-3.5 text-body-sm text-fg-muted" data-testid="privacy-websites-none">
          {t('studio:privacy.websites.none', 'None yet. A form shows on another website only once that website is on this list.')}
        </p>
      ) : (
        <ul className="m-0 list-none p-0" data-testid="privacy-websites-list">
          {list.websites.map((site) => (
            <li key={site.origin} className="flex flex-wrap items-center gap-3 border-b border-border px-[var(--card-pad)] py-[var(--row-pad,12px)]">
              <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-surface-3 text-fg-muted">
                <Globe className="size-4" />
              </span>
              <div className="min-w-[180px] flex-1">
                <span dir="ltr" className="break-all font-mono text-[13px] font-semibold">
                  {site.origin}
                </span>
                <div className="mt-px text-[11.5px] text-fg-subtle">
                  {site.addedBy === null
                    ? t('studio:privacy.websites.addedOn', 'Added {date}', { date: date.format(new Date(site.addedAt)) })
                    : t('studio:privacy.websites.addedBy', 'Added by {name} · {date}', { name: site.addedBy.name, date: date.format(new Date(site.addedAt)) })}
                </div>
              </div>
              <Button
                variant="secondary"
                className="text-danger max-sm:min-h-11"
                aria-label={t('studio:privacy.websites.removeLabel', 'Remove {url}', { url: site.origin })}
                disabled={removing !== null}
                loading={removing === site.origin}
                onClick={() => void remove(site)}
              >
                {t('studio:privacy.websites.remove', 'Remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-col gap-2.5 p-[var(--card-pad)]"
        onSubmit={(event) => {
          event.preventDefault();
          if (canAdd) void add();
        }}
      >
        <label htmlFor={fieldId} className="text-[12.5px] font-bold">
          {t('studio:privacy.websites.addLabel', 'Add a website')}
        </label>
        <Textarea
          id={fieldId}
          dir="ltr"
          rows={4}
          mono
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          value={text}
          error={bad || tooMany}
          aria-describedby={`${helpId} ${listId}`}
          onChange={(event) => setText(event.target.value)}
          className="bg-surface-2 text-start text-[12.5px] leading-[1.6]"
          data-testid="privacy-websites-field"
        />
        <p id={helpId} className="text-[11.5px] text-fg-subtle">
          {t('studio:privacy.websites.addHelp', 'One website per line, starting with https://.')}
        </p>
        <ul id={listId} aria-live="polite" className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="privacy-websites-checks">
          {checks.map((line, index) => {
            const ok = line.code === 'ok';
            return (
              <li key={`${String(index)}:${line.line}`} className="flex items-start gap-2 text-[12.5px] leading-normal" data-code={line.code}>
                {ok ? <CircleCheck aria-hidden className="mt-0.5 size-[15px] shrink-0 text-pos" /> : <CircleX aria-hidden className="mt-0.5 size-[15px] shrink-0 text-danger" />}
                <span className="min-w-0 flex-1">
                  <span dir="ltr" className="break-all font-mono text-[12px] text-fg">
                    {line.line.trim()}
                  </span>
                  <span className="text-fg-subtle"> · </span>
                  <span className={ok ? 'font-semibold text-pos' : 'font-semibold text-danger'}>{websiteLineWords(line.code)}</span>
                </span>
              </li>
            );
          })}
          {tooMany ? (
            <li className="flex items-start gap-2 text-[12.5px] font-semibold text-danger" data-code="too-many">
              <CircleX aria-hidden className="mt-0.5 size-[15px] shrink-0" />
              {t('studio:privacy.websites.tooMany', 'The list holds at most {max} websites. Remove one first.', { max: list.max })}
            </li>
          ) : null}
        </ul>
        <div>
          <Button type="submit" disabled={!canAdd} loading={busy} data-testid="privacy-websites-add">
            {t('studio:privacy.websites.add', 'Add')}
          </Button>
        </div>
      </form>
      <p className="flex items-start gap-2 border-t border-border bg-surface-2 px-[var(--card-pad)] py-3 text-[12.5px] text-fg-muted">
        <ShieldCheck aria-hidden className="mt-0.5 size-[15px] shrink-0 text-info" />
        {t('studio:privacy.websites.note', 'A listed website can show your forms and chat in a frame. It never gets access to your data.')}
      </p>
    </Card>
  );
}

/** "Put it on your website": the loader line, on this server's public address. */
function EmbedCard({ origin }: { origin: string | null }): ReactNode {
  const ids = useId();
  const [copied, setCopied] = useState(false);
  // Before a public address is set, the line names the address this page was opened on: the reach card says what to fix.
  const line = `<script src="${origin ?? window.location.origin}/x/embed.js" async></script>`;
  return (
    <Card className="flex flex-col gap-2.5" data-testid="privacy-embed">
      <h2 id={`${ids}-embed`} className="text-[14.5px] font-bold">
        {t('studio:privacy.websites.embedHeading', 'Put it on your website')}
      </h2>
      <div className="flex items-center gap-1.5 rounded-[10px] bg-surface-3 p-1 ps-3">
        <code dir="ltr" className="min-w-0 flex-1 break-all text-start font-mono text-[12px]" data-testid="privacy-embed-line">
          {line}
        </code>
        <Button
          variant="secondary"
          size="sm"
          className="max-sm:min-h-11"
          aria-label={t('studio:privacy.websites.copyLabel', 'Copy the loader line')}
          iconLeft={copied ? <Check className="size-[13px]" /> : <Copy className="size-[13px]" />}
          onClick={() => {
            void navigator.clipboard?.writeText(line).then(() => setCopied(true));
          }}
        >
          {copied ? t('studio:privacy.websites.copied', 'Copied') : t('studio:privacy.websites.copy', 'Copy')}
        </Button>
      </div>
      <p className="text-[12.5px] leading-normal text-fg-muted">
        {t('studio:privacy.websites.embedLine', "Then add a form or the chat where you want it. Each form's Share tab has its own line.")}
      </p>
    </Card>
  );
}
