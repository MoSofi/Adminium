// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The snippet maker (comp `Calendars and Embeds.dc.html`, board 4): an app's
 * screen on the owner's website. Pick the app, the screen and how it shows,
 * name the website it goes on, and copy two lines.
 *
 * The preview frames the real screen, small and inert, from this server, once
 * somebody presses for it: `frame-ancestors` keeps `'self'` for it. A website not on the list is said
 * plainly, with the one press that adds it, and the preview then shows what
 * that website would show: nothing yet.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { checkWebsiteLines } from '@adminium/add-on-contracts/forms/websites';
import { Alert, Button, Card, FormField, Input, RadioCard, RadioGroup, Select } from '@adminium/ui';

import { getI18nInstance, t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { addWebsites, embedsQuery, PRIVACY_WEBSITES_QUERY_KEY, websitesQuery, type EmbedApp, type EmbedWords } from './privacyApi.js';
import { LABEL_MAX, pathOf, snippetOf, type SnippetMode } from './snippet.js';
import { websiteLineWords } from './websiteWords.js';

/** A manifest's word, in the reader's language, else its language's nearest, else US English. */
export function wordsOf(words: EmbedWords | null, locale: string, fallback: string): string {
  if (words === null) return fallback;
  if (typeof words === 'string') return words;
  const language = locale.split('-')[0];
  return words[locale] ?? Object.entries(words).find(([tag]) => tag.split('-')[0] === language)?.[1] ?? words['en-US'] ?? fallback;
}

function modeWords(mode: SnippetMode): { title: string; help: string } {
  switch (mode) {
    case 'inline':
      return { title: t('studio:privacy.websites.maker.inline', 'Inline'), help: t('studio:privacy.websites.maker.inlineHelp', 'Sits in the page') };
    case 'button':
      return { title: t('studio:privacy.websites.maker.button', 'Button'), help: t('studio:privacy.websites.maker.buttonHelp', 'Opens on press') };
    case 'floating':
      return { title: t('studio:privacy.websites.maker.floating', 'Floating'), help: t('studio:privacy.websites.maker.floatingHelp', 'Stays in a corner') };
  }
}

export function SnippetMaker({ origin }: { origin: string | null }): ReactNode {
  const apps = useQuery(embedsQuery());
  if (apps.data === undefined || apps.data.length === 0) return null;
  return <Maker apps={apps.data} origin={origin ?? window.location.origin} />;
}

function Maker({ apps, origin }: { apps: EmbedApp[]; origin: string }): ReactNode {
  const toasts = useAppToasts();
  const queryClient = useQueryClient();
  const websites = useQuery(websitesQuery());
  const locale = getI18nInstance()?.language ?? 'en-US';
  const [appKey, setAppKey] = useState(apps[0]!.app);
  const [path, setPath] = useState(apps[0]!.screens[0]!.path);
  const [picked, setPicked] = useState<SnippetMode>(apps[0]!.modes[0]!);
  const [value, setValue] = useState('');
  const [typed, setTyped] = useState<string | null>(null);
  const [site, setSite] = useState('');
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  // The app's own screen runs only once somebody asks to see it, not by opening this tab.
  const [live, setLive] = useState(false);

  const app = apps.find((one) => one.app === appKey) ?? apps[0]!;
  const screen = app.screens.find((one) => one.path === path) ?? app.screens[0]!;
  const mode = app.modes.includes(picked) ? picked : app.modes[0]!;
  const appName = wordsOf(app.name, locale, app.app);
  const words = typed ?? appName.slice(0, LABEL_MAX);
  const choose = screen.choose;
  const chosen = choose !== null && choose.values.some((one) => one.value === value) ? { query: choose.query, value } : null;
  const snippet = snippetOf({ origin, app: app.app, mount: app.mount, path: screen.path, choice: chosen, mode, words });
  const framed = `${app.mount}${pathOf(screen.path, chosen)}${chosen === null ? '?' : '&'}frame=1&mode=inline`;

  const listed = (websites.data?.websites ?? []).map((one) => one.origin);
  const typedSite = site.trim();
  const check = typedSite === '' ? null : checkWebsiteLines([typedSite], { self: origin, listed })[0]!;
  const notListed = check?.code === 'ok';
  const isListed = check?.code === 'listed';
  const blocked = notListed || (check !== null && !isListed);

  function changeApp(next: string): void {
    const nextApp = apps.find((one) => one.app === next) ?? apps[0]!;
    setAppKey(nextApp.app);
    setPath(nextApp.screens[0]!.path);
    setValue('');
    setTyped(null);
    setOpen(false);
    setLive(false);
  }

  async function addSite(): Promise<void> {
    setAdding(true);
    try {
      queryClient.setQueryData(PRIVACY_WEBSITES_QUERY_KEY, await addWebsites([typedSite]));
      toasts.push({ variant: 'success', title: t('studio:privacy.websites.added', 'Added') });
    } catch {
      void queryClient.invalidateQueries({ queryKey: PRIVACY_WEBSITES_QUERY_KEY });
      toasts.push({ variant: 'error', title: t('studio:privacy.websites.addFailed', 'The websites were not added. Try again.') });
    } finally {
      setAdding(false);
    }
  }

  const frame = <iframe title={t('studio:privacy.websites.maker.preview', 'Preview')} src={framed} sandbox="allow-scripts allow-same-origin" tabIndex={-1} className="pointer-events-none size-full border-0 bg-surface" />;

  return (
    <Card className="flex flex-col gap-3.5" data-testid="privacy-maker">
      <h2 className="text-[14.5px] font-bold">{t('studio:privacy.websites.maker.heading', 'Show an app’s screen on your website')}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t('studio:privacy.websites.maker.app', 'App')}>
          <Select value={app.app} onChange={(event) => changeApp(event.target.value)} data-testid="privacy-maker-app">
            {apps.map((one) => (
              <option key={one.app} value={one.app}>
                {wordsOf(one.name, locale, one.app)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('studio:privacy.websites.maker.screen', 'Screen')}>
          <Select
           
            value={screen.path}
            onChange={(event) => {
              setPath(event.target.value);
              setValue('');
            }}
            data-testid="privacy-maker-screen"
          >
            {app.screens.map((one) => (
              <option key={one.path} value={one.path}>
                {wordsOf(one.label, locale, one.path)}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <RadioGroup
        aria-label={t('studio:privacy.websites.maker.way', 'How it shows')}
        value={mode}
        onValueChange={(next) => {
          setPicked(next as SnippetMode);
          setOpen(false);
        }}
        className="grid gap-2 sm:grid-cols-3"
      >
        {app.modes.map((one) => {
          const said = modeWords(one);
          return <RadioCard key={one} value={one} title={said.title} description={said.help} data-testid={`privacy-maker-way-${one}`} />;
        })}
      </RadioGroup>
      <div className="grid gap-3 sm:grid-cols-2">
        {choose === null ? null : (
          <FormField label={wordsOf(choose.title, locale, t('studio:privacy.websites.maker.choice', 'Open on a particular one'))}>
            <Select value={chosen?.value ?? ''} onChange={(event) => setValue(event.target.value)} data-testid="privacy-maker-choice">
              <option value="">{wordsOf(choose.any, locale, t('studio:privacy.websites.maker.any', 'Any'))}</option>
              {choose.values.map((one) => (
                <option key={one.value} value={one.value}>
                  {one.label}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        <FormField label={mode === 'inline' ? t('studio:privacy.websites.maker.linkWords', 'The link’s words, if the screen can’t load') : t('studio:privacy.websites.maker.words', 'The button’s words')}>
          <Input value={words} maxLength={LABEL_MAX} onChange={(event) => setTyped(event.target.value)} data-testid="privacy-maker-words" />
        </FormField>
        <FormField label={t('studio:privacy.websites.maker.site', 'The website it goes on')}>
          <Input dir="ltr" mono value={site} placeholder="https://" spellCheck={false} autoCapitalize="off" onChange={(event) => setSite(event.target.value)} data-testid="privacy-maker-site" />
        </FormField>
      </div>
      {notListed ? (
        <Alert tone="warn" title={t('studio:privacy.websites.maker.notListed', 'This website isn’t allowed to show your screens yet.')} data-testid="privacy-maker-warning">
          <Button variant="secondary" size="sm" className="mt-1.5 max-sm:min-h-11" loading={adding} onClick={() => void addSite()} data-testid="privacy-maker-add">
            {t('studio:privacy.websites.maker.add', 'Add {site}', { site: check.origin ?? typedSite })}
          </Button>
        </Alert>
      ) : check !== null && !isListed ? (
        <p className="text-[12.5px] font-semibold text-danger" data-testid="privacy-maker-site-error">
          {websiteLineWords(check.code)}
        </p>
      ) : null}
      <div>
        <h3 className="mb-1.5 text-[12.5px] font-bold">{t('studio:privacy.websites.maker.preview', 'Preview')}</h3>
        <div className="overflow-hidden rounded-[10px] border border-border bg-surface-2">
          <div dir="ltr" className="truncate border-b border-border bg-surface-3 px-3 py-1.5 text-start font-mono text-[11.5px] text-fg-muted">
            {typedSite === '' ? origin : typedSite}
          </div>
          <div className="relative h-[320px]" data-testid="privacy-maker-preview">
            {blocked ? (
              <div className="flex h-full flex-col items-center justify-center gap-1 p-4 text-center" data-testid="privacy-maker-blocked">
                <p className="text-[13px] font-bold">{t('studio:privacy.websites.maker.nothing', 'Nothing shows here yet')}</p>
                <p className="text-[12.5px] text-fg-muted">{t('studio:privacy.websites.maker.nothingWhy', 'This website isn’t on your list, so your screens refuse to load on it.')}</p>
              </div>
            ) : mode === 'inline' ? (
              live ? (
                frame
              ) : (
                <div className="flex h-full items-center justify-center">
                  <Button variant="secondary" onClick={() => setLive(true)} data-testid="privacy-maker-show">
                    {t('studio:privacy.websites.maker.show', 'Show the real screen')}
                  </Button>
                </div>
              )
            ) : (
              <>
                <div className={mode === 'floating' ? 'absolute bottom-3 end-3' : 'flex h-full items-center justify-center'}>
                  <Button onClick={() => setOpen(true)} data-testid="privacy-maker-launcher">
                    {words}
                  </Button>
                </div>
                {open ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 p-3">
                    <div className="flex size-full max-w-[420px] flex-col overflow-hidden rounded-[12px] bg-surface">
                      <div className="flex justify-end border-b border-border p-1">
                        <Button variant="secondary" size="sm" onClick={() => setOpen(false)} data-testid="privacy-maker-close">
                          {t('studio:privacy.websites.maker.close', 'Close')}
                        </Button>
                      </div>
                      <div className="min-h-0 flex-1">{frame}</div>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <h3 className="text-[12.5px] font-bold">{t('studio:privacy.websites.maker.snippet', 'The snippet')}</h3>
          <Button
            variant="secondary"
            size="sm"
            className="max-sm:min-h-11"
            aria-label={t('studio:privacy.websites.maker.copyLabel', 'Copy the snippet')}
            iconLeft={copied ? <Check className="size-[13px]" /> : <Copy className="size-[13px]" />}
            onClick={() => {
              void navigator.clipboard?.writeText(snippet).then(() => setCopied(true));
            }}
          >
            {copied ? t('studio:privacy.websites.copied', 'Copied') : t('studio:privacy.websites.copy', 'Copy')}
          </Button>
        </div>
        <pre dir="ltr" className="m-0 overflow-x-auto whitespace-pre-wrap break-all rounded-[10px] bg-surface-3 p-3 text-start font-mono text-[12px]" data-testid="privacy-maker-snippet">
          {snippet}
        </pre>
        <p className="mt-1.5 text-[12.5px] leading-normal text-fg-muted">{t('studio:privacy.websites.maker.strict', 'If your website sets a content security policy, allow {origin} in its script-src and frame-src.', { origin })}</p>
      </div>
    </Card>
  );
}
