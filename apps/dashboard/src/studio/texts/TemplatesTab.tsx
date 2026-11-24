// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Texts → Templates (comp `Text Templates`, X21–X34).
 *
 * A text is a plain editor with a counter, never the e-mail block canvas.
 *
 *  - The list: each template an app installed, its languages and the most
 *    segments any of them runs to with the sample values.
 *  - The editor: the words, placeholders to insert, the opt-out line the
 *    product adds ("Added for you": counted, never editable), a preview of the
 *    FILLED text in the message's own direction, and the counter on every
 *    keystroke. Where it goes and who it is from change the line and the
 *    count, so both are pickers.
 *  - What a text may not say is refused beside the words, the same rules the
 *    server applies at the save and again at every send.
 */
import { useMutation, useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, Lock, MessageSquareText, Plus } from 'lucide-react';
import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, FormField, IconTile, Input, Select, Spinner, Textarea } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { TEXT_COUNTRIES, countryName } from './textCountries.js';
import { lineWordsQuery } from './textLineWords.js';
import {
  LOCALE_NAMES,
  PLAIN_FOR,
  TEXT_LOCALES,
  composeText,
  localeDir,
  localeTag,
  optOutFor,
  placeholderNames,
  unicodeCharacters,
  withPlainCharacters,
  type Composed,
  type SegmentTable,
  type TextLocale,
  type TextLineWords,
  type TextProblem,
} from './textCounter.js';
import { CounterLine } from './TextCounterView.js';
import { emptyTemplateLanguage, refusalReason, saveTemplateLanguage, smsSetupQuery, templatesKey, textTemplatesQuery, type TextTemplate } from './textsApi.js';
import { activeLocale, cnSentence } from './textsWords.js';

const caption = 'text-[10.5px] font-bold uppercase tracking-[.05em] text-fg-subtle';
const FALLBACK: TextLocale = 'en_US';

/** A stand-in value for a placeholder, from its own name: `{{record.first_name}}` reads "First name". */
export function sampleValue(name: string): string {
  const last = name.slice(name.lastIndexOf('.') + 1).replace(/[_-]+/g, ' ').trim();
  return last === '' ? name : last.charAt(0).toUpperCase() + last.slice(1);
}

interface Preview {
  country: string;
  sender: 'number' | 'name';
  table: SegmentTable;
  values: Record<string, string>;
  business: { name: string; contact: string };
}

function compose(body: string, preview: Preview, repliesReachUs: boolean, words: TextLineWords | undefined): Composed {
  const contact = preview.business.contact.trim();
  return composeText({
    words,
    template: body,
    values: preview.values,
    optOut: optOutFor(preview.sender, preview.country, repliesReachUs),
    country: preview.country,
    business: { name: preview.business.name, ...(contact.includes('@') ? { email: contact } : { phone: contact }) },
    table: preview.table,
  });
}

function bodyOf(template: TextTemplate, locale: string): string | null {
  return template.languages.find((one) => one.locale === locale)?.body ?? null;
}

/** A language's line words once a preview has fetched them; US English until then. */
const cachedWords = (client: QueryClient, locale: string): TextLineWords | undefined => client.getQueryData(lineWordsQuery(locale).queryKey);

/** The most segments any language of a template runs to, with stand-in values. */
function mostSegments(template: TextTemplate, repliesReachUs: boolean, client: QueryClient): number {
  let most = 0;
  for (const language of template.languages) {
    const values = Object.fromEntries(placeholderNames(language.body).map((name) => [name, sampleValue(name)]));
    const composed = compose(language.body, { country: 'US', sender: 'number', table: 'standard', values, business: { name: 'Business', contact: '+1 555 0100' } }, repliesReachUs, cachedWords(client, language.locale));
    most = Math.max(most, composed.estimate.segments);
  }
  return most;
}

// ─── The list ───────────────────────────────────────────────────────────────

function TemplateList({ templates, repliesReachUs, onOpen }: { templates: readonly TextTemplate[]; repliesReachUs: boolean; onOpen: (key: string) => void }) {
  const client = useQueryClient();
  if (templates.length === 0) {
    return (
      <Card data-testid="texts-templates-empty">
        <EmptyState
          icon={<MessageSquareText />}
          title={t('studio:texts.templates.emptyTitle', 'No app has installed a text template yet')}
          body={t('studio:texts.templates.emptyBody', 'Apps that send texts bring their own templates. Install one from the apps page, and its templates appear here to edit.')}
          actions={
            <Button variant="secondary" onClick={() => window.location.assign('/studio/add-ons')}>
              {t('studio:texts.templates.openApps', 'Open add-ons and apps')}
            </Button>
          }
        />
      </Card>
    );
  }
  return (
    <Card data-testid="texts-templates">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-surface-2">
              {[t('studio:texts.templates.col.name', 'Template'), t('studio:texts.templates.col.app', 'App'), t('studio:texts.templates.col.languages', 'Languages'), t('studio:texts.templates.col.segments', 'Most segments')].map((label) => (
                <th key={label} scope="col" className="whitespace-nowrap border-b border-border px-3 py-2 text-start text-[10.5px] font-bold uppercase tracking-[0.05em] text-fg-subtle first:ps-5">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {templates.map((template) => (
              <tr key={template.key} className="border-b border-border last:border-0" data-testid="texts-template-row">
                <td className="py-2.5 pe-3 ps-5">
                  <button type="button" className="text-start font-bold text-fg hover:underline focus-visible:outline-2 focus-visible:outline-accent" onClick={() => onOpen(template.key)} data-testid={`texts-template-${template.key}`}>
                    {template.name}
                  </button>
                  <bdi dir="ltr" className="block font-mono text-[11px] text-fg-subtle">
                    {template.key}
                  </bdi>
                </td>
                <td className="px-3 py-2.5 text-fg-muted">{template.app ?? '—'}</td>
                <td className="px-3 py-2.5">{t('studio:texts.templates.languagesOf', '{count} of {total}', { count: template.languages.length, total: TEXT_LOCALES.length })}</td>
                <td className="px-3 py-2.5">
                  <bdi dir="ltr" className="font-mono">
                    {mostSegments(template, repliesReachUs, client)}
                  </bdi>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-5 py-2.5 text-[11.5px] text-fg-subtle">{t('studio:texts.templates.segmentsNote', 'Segments are counted with stand-in values and the opt-out line. Each customer’s own values can change it.')}</p>
    </Card>
  );
}

// ─── What the editor refuses ────────────────────────────────────────────────

function problemWords(problem: TextProblem): string {
  switch (problem.kind) {
    case 'empty':
      return t('studio:texts.editor.problem.empty', 'Write the text first.');
    case 'credential':
      return t('studio:texts.editor.problem.credential', 'A text can’t carry a sign-in link, a code, a survey link or a QR value: {names}', { names: problem.names.map((name) => `{{${name}}}`).join(', ') });
    case 'asks-for-yes':
      return t('studio:texts.editor.problem.yes', 'Don’t ask people to reply YES. A YES reply can lift a stop at the provider. Ask people to agree on a form instead.');
    case 'short-link':
      return t('studio:texts.editor.problem.shortLink', 'A public short link is filtered by carriers. Adminium has no link shortener, so leave the link out.');
    case 'missing':
      return t('studio:texts.editor.problem.missing', 'This text won’t send until {names} has a value.', { names: problem.names.map((name) => `{{${name}}}`).join(', ') });
    case 'no-opt-out-contact':
      return t('studio:texts.editor.problem.noContact', 'This sender can’t take a STOP reply, and no phone or e-mail is given for stopping, so it won’t send.');
    case 'too-long':
      return t('studio:texts.editor.problem.tooLong', 'Too long to send. Shorten it.');
  }
}

/** Problems that stop a save. A missing value or contact depends on the customer, so it only warns. */
const BLOCKS_SAVE: ReadonlySet<TextProblem['kind']> = new Set(['empty', 'credential', 'asks-for-yes', 'too-long']);

// ─── The preview ────────────────────────────────────────────────────────────

/** The filled text with each missing placeholder, and each character that alone made it Unicode, marked. */
function Marked({ text, highlight }: { text: string; highlight: readonly string[] }) {
  const parts = text.split(/(\{\{[^{}]*\}\})/g);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith('{{') ? (
          <mark key={index} className="rounded-[3px] bg-danger-soft px-0.5 text-danger" data-testid="texts-preview-missing">
            {part}
          </mark>
        ) : (
          Array.from(part).map((one, at) =>
            highlight.includes(one) ? (
              <mark key={`${index}-${at}`} className="rounded-[3px] bg-warn-soft px-px" data-testid="texts-preview-unicode">
                {one}
              </mark>
            ) : (
              one
            ),
          )
        ),
      )}
    </>
  );
}

/** A few characters made a text Unicode: worth pointing at. A text in Arabic or Chinese is Unicode throughout. */
export const MOST_MARKED = 3;
export function costlyCharacters(text: string): string[] {
  const found = unicodeCharacters(text);
  return found.length <= MOST_MARKED ? found : [];
}

function PhonePreview({ composed, locale, country, fallbackNote }: { composed: Composed; locale: string; country: string; fallbackNote: string | null }) {
  if (country === 'CN') {
    return (
      <div className="flex flex-col items-center gap-2 rounded-[20px] border border-border bg-danger-soft p-5 text-center" data-testid="texts-preview-cn">
        <Ban aria-hidden="true" className="size-5 text-danger" />
        <p className="text-[13px] font-semibold">{cnSentence()}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-[22px] border border-border bg-surface-2 p-4" data-testid="texts-preview">
      <span className={caption}>{t('studio:texts.editor.preview', 'Preview')}</span>
      {fallbackNote === null ? null : <p className="text-[12px] font-semibold text-warn">{fallbackNote}</p>}
      <p lang={localeTag(locale)} dir={localeDir(locale)} className="max-w-[92%] self-start whitespace-pre-wrap rounded-[16px] rounded-ss-[4px] bg-surface px-3 py-2 text-start text-[13.5px] leading-[1.45] shadow-sm [overflow-wrap:anywhere]" data-testid="texts-preview-text">
        <Marked text={composed.line === null ? composed.body : composed.words} highlight={costlyCharacters(composed.body)} />
        {composed.line === null ? null : (
          <>
            {locale.startsWith('zh') ? '' : ' '}
            {/* The product's line, in the text's language: its own isolated run, so a number inside it keeps its place. */}
            <bdi lang={localeTag(locale)} dir={localeDir(locale)} data-testid="texts-preview-line">
              {composed.line}
            </bdi>
          </>
        )}
      </p>
    </div>
  );
}

// ─── The editor ─────────────────────────────────────────────────────────────

function Editor({ template, repliesReachUs, defaultCountry, defaultSender, onBack, onSaved }: { template: TextTemplate; repliesReachUs: boolean; defaultCountry: string; defaultSender: 'number' | 'name'; onBack: () => void; onSaved: (next: TextTemplate) => void }) {
  const ids = useId();
  const locale = activeLocale();
  const area = useRef<HTMLTextAreaElement | null>(null);
  const [language, setLanguage] = useState<TextLocale>(FALLBACK);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const english = bodyOf(template, FALLBACK) ?? template.languages[0]?.body ?? '';
  const stored = bodyOf(template, language);
  const body = drafts[language] ?? stored ?? '';
  const names = useMemo(() => placeholderNames(`${english} ${body}`), [english, body]);
  const [preview, setPreview] = useState<Preview>(() => ({
    country: defaultCountry,
    sender: defaultSender,
    table: defaultCountry === 'CA' ? 'canadaLongCode' : 'standard',
    values: Object.fromEntries(placeholderNames(english).map((name) => [name, sampleValue(name)])),
    business: { name: t('studio:texts.editor.sampleBusiness', 'Your business'), contact: '+1 555 0100' },
  }));
  const values = { ...Object.fromEntries(names.map((name) => [name, sampleValue(name)])), ...preview.values };
  const emptyHere = body.trim() === '';
  const shownBody = emptyHere ? english : body;
  // Each language's opt-out line comes from the shipped catalogue; until a language's words are in, its count waits.
  const lineWords = useQueries({ queries: TEXT_LOCALES.map((one) => lineWordsQuery(one)) });
  const wordsOf = (one: string): TextLineWords | undefined => lineWords[TEXT_LOCALES.indexOf(one as TextLocale)]?.data;
  const shownLocale = emptyHere ? FALLBACK : language;
  const composed = compose(shownBody, { ...preview, values }, repliesReachUs, wordsOf(shownLocale));
  const ownProblems = emptyHere ? [] : compose(body, { ...preview, values }, repliesReachUs, wordsOf(language)).problems;
  const blocking = ownProblems.some((problem) => BLOCKS_SAVE.has(problem.kind));
  const unicode = costlyCharacters(body);
  const plainable = unicode.filter((one) => PLAIN_FOR[one] !== undefined);
  const changed = drafts[language] !== undefined && drafts[language] !== (stored ?? '');
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: () => (emptyHere ? emptyTemplateLanguage(template.key, language) : saveTemplateLanguage(template.key, language, body)),
    onSuccess: (next) => {
      setDrafts((held) => {
        const { [language]: _gone, ...rest } = held;
        return rest;
      });
      onSaved(next);
      void client.invalidateQueries({ queryKey: templatesKey });
    },
  });
  const setBody = (next: string) => setDrafts((held) => ({ ...held, [language]: next }));
  const insert = (name: string) => {
    const element = area.current;
    const token = `{{${name}}}`;
    const at = element?.selectionStart ?? body.length;
    const end = element?.selectionEnd ?? at;
    setBody(body.slice(0, at) + token + body.slice(end));
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(at + token.length, at + token.length);
    });
  };
  const fallbackNote = emptyHere && language !== FALLBACK ? t('studio:texts.editor.fallback', 'People who read {language} get this in English.', { language: LOCALE_NAMES[language] }) : null;
  const countries = TEXT_COUNTRIES.map((one) => ({ code: one.code, name: countryName(one.code, locale) }));
  const languageSegments = (one: TextLocale): number | null => {
    const text = drafts[one] ?? bodyOf(template, one);
    const words = wordsOf(one);
    if (text === null || text.trim() === '' || words === undefined) return null;
    return compose(text, { ...preview, values }, repliesReachUs, words).estimate.segments;
  };

  return (
    <div className="flex flex-col gap-4" data-testid="texts-editor">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" iconLeft={<ArrowLeft className="size-4 rtl:-scale-x-100" />} onClick={onBack} data-testid="texts-editor-back">
          {t('studio:texts.editor.back', 'All templates')}
        </Button>
        <h2 className="text-[16px] font-bold">{template.name}</h2>
        {template.app === null ? null : <Badge tone="neutral">{template.app}</Badge>}
      </div>

      <div role="tablist" aria-label={t('studio:texts.editor.languages', 'Languages')} className="flex flex-wrap gap-1.5" data-testid="texts-editor-languages">
        {TEXT_LOCALES.map((one) => {
          const count = languageSegments(one);
          return (
            <button
              key={one}
              type="button"
              role="tab"
              aria-selected={language === one}
              onClick={() => setLanguage(one)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-semibold focus-visible:outline-2 focus-visible:outline-accent ${language === one ? 'border-accent bg-accent-soft-solid text-fg' : 'border-border bg-surface text-fg-muted'}`}
              data-testid={`texts-language-${one}`}
            >
              <span lang={localeTag(one)}>{LOCALE_NAMES[one]}</span>
              {count === null ? (
                <span className="text-[11px] font-normal text-fg-subtle">{t('studio:texts.editor.emptyChip', 'empty')}</span>
              ) : (
                <bdi dir="ltr" className="rounded-full bg-surface-3 px-1.5 font-mono text-[11px]">
                  {count}
                </bdi>
              )}
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <Card>
          <CardBody className="flex flex-col gap-3">
            <FormField label={t('studio:texts.editor.words', 'The text')} controlId={`${ids}-body`}>
              <Textarea
                ref={area}
                id={`${ids}-body`}
                lang={localeTag(language)}
                dir={localeDir(language)}
                rows={5}
                value={body}
                placeholder={language === FALLBACK ? '' : english}
                onChange={(event) => setBody(event.target.value)}
                data-testid="texts-editor-body"
              />
            </FormField>
            {names.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={caption}>{t('studio:texts.editor.insert', 'Insert')}</span>
                {names.map((name) => (
                  <Button key={name} variant="secondary" size="sm" iconLeft={<Plus className="size-3.5" />} onClick={() => insert(name)} aria-label={t('studio:texts.editor.insertOne', 'Insert {name}', { name: `{{${name}}}` })}>
                    <bdi dir="ltr" className="font-mono text-[11.5px]">{`{{${name}}}`}</bdi>
                  </Button>
                ))}
              </div>
            ) : null}
            <div className="flex items-start gap-2 rounded-[10px] border border-dashed border-border bg-surface-2 px-3 py-2" data-testid="texts-editor-optout">
              <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
              <div className="min-w-0">
                <span className={caption}>{t('studio:texts.editor.addedForYou', 'Added for you')}</span>
                {composed.line === null ? (
                  <p className="text-start text-[12.5px]">{t('studio:texts.editor.ownStop', 'Your text says STOP itself, so nothing is added.')}</p>
                ) : (
                  <p lang={localeTag(shownLocale)} dir={localeDir(shownLocale)} className="text-start text-[12.5px]" data-testid="texts-editor-optout-line">
                    {composed.line}
                  </p>
                )}
                <p className="text-[11.5px] text-fg-subtle">{t('studio:texts.editor.optOutCounts', 'It counts toward the length, and can’t be edited.')}</p>
              </div>
            </div>
            <CounterLine estimate={composed.estimate} />
            {unicode.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 text-[12.5px]" data-testid="texts-editor-unicode">
                <span>
                  {t('studio:texts.editor.unicode', 'This character uses the Unicode rate:')}{' '}
                  {unicode.map((one) => (
                    <mark key={one} className="mx-0.5 rounded-[3px] bg-warn-soft px-1 font-mono">
                      {one}
                    </mark>
                  ))}
                </span>
                {plainable.length > 0 ? (
                  <Button variant="secondary" size="sm" onClick={() => setBody(withPlainCharacters(body))} data-testid="texts-editor-plain">
                    {t('studio:texts.editor.plain', 'Use a plain one')}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {ownProblems.map((problem) => (
              <p key={problem.kind} role="alert" className={`text-[12.5px] font-semibold ${BLOCKS_SAVE.has(problem.kind) ? 'text-danger' : 'text-warn'}`} data-testid={`texts-problem-${problem.kind}`}>
                {problemWords(problem)}
              </p>
            ))}
            {save.isError ? <Alert tone="danger" role="alert" title={t('studio:texts.saveFailed', 'This could not be saved')} body={refusalReason(save.error) === 'asks-for-yes' ? problemWords({ kind: 'asks-for-yes' }) : save.error.message} /> : null}
            <div className="flex flex-wrap gap-2">
              <Button loading={save.isPending} disabled={!changed || blocking || (emptyHere && language === FALLBACK)} onClick={() => save.mutate()} data-testid="texts-editor-save">
                {emptyHere && language !== FALLBACK ? t('studio:texts.editor.saveEmpty', 'Save as empty') : t('studio:texts.save', 'Save')}
              </Button>
              {changed ? (
                <Button variant="ghost" onClick={() => setDrafts((held) => ({ ...held, [language]: stored ?? '' }))}>
                  {t('studio:texts.editor.undo', 'Undo changes')}
                </Button>
              ) : null}
            </div>
          </CardBody>
        </Card>

        <div className="flex flex-col gap-3">
          <PhonePreview composed={composed} locale={emptyHere ? FALLBACK : language} country={preview.country} fallbackNote={fallbackNote} />
          {preview.country === 'TW' ? <p className="text-[12px] font-semibold">{t('studio:texts.editor.taiwan', 'The brand name must open each text.')}</p> : null}
          <Card>
            <CardBody className="flex flex-col gap-3">
              <span className={caption}>{t('studio:texts.editor.whereTo', 'Where it goes and who it is from')}</span>
              <FormField label={t('studio:texts.editor.country', 'Country')} controlId={`${ids}-country`}>
                <Select id={`${ids}-country`} value={preview.country} onChange={(event) => setPreview((held) => ({ ...held, country: event.target.value, table: event.target.value === 'CA' ? 'canadaLongCode' : held.table === 'canadaLongCode' ? 'standard' : held.table }))} data-testid="texts-editor-country">
                  {countries.map((one) => (
                    <option key={one.code} value={one.code}>
                      {one.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={t('studio:texts.editor.sender', 'Sent from')} controlId={`${ids}-sender`}>
                <Select id={`${ids}-sender`} value={preview.sender} onChange={(event) => setPreview((held) => ({ ...held, sender: event.target.value === 'name' ? 'name' : 'number' }))} data-testid="texts-editor-sender">
                  <option value="number">{t('studio:texts.sender.number', 'Number')}</option>
                  <option value="name">{t('studio:texts.sender.name', 'Sender name')}</option>
                </Select>
              </FormField>
              <FormField label={t('studio:texts.editor.table', 'Counted as')} controlId={`${ids}-table`}>
                <Select id={`${ids}-table`} value={preview.table} onChange={(event) => setPreview((held) => ({ ...held, table: event.target.value as SegmentTable }))} data-testid="texts-editor-table">
                  <option value="standard">{t('studio:texts.editor.tableStandard', 'Most countries')}</option>
                  <option value="canadaLongCode">{t('studio:texts.editor.tableCanada', 'Canada, long code')}</option>
                  <option value="tollFree">{t('studio:texts.editor.tableTollFree', 'US and Canada, toll-free')}</option>
                </Select>
              </FormField>
              {!repliesReachUs ? <p className="text-[12px] text-fg-muted">{t('studio:texts.editor.noReplies', 'This server can’t receive STOP replies, so every text gives your phone or e-mail for stopping.')}</p> : null}
            </CardBody>
          </Card>
          <Card>
            <CardBody className="flex flex-col gap-3">
              <span className={caption}>{t('studio:texts.editor.samples', 'Sample values for the preview')}</span>
              {names.map((name) => (
                <FormField key={name} label={<bdi dir="ltr" className="font-mono">{`{{${name}}}`}</bdi>} controlId={`${ids}-v-${name}`}>
                  <Input id={`${ids}-v-${name}`} value={values[name] ?? ''} onChange={(event) => setPreview((held) => ({ ...held, values: { ...held.values, [name]: event.target.value } }))} data-testid={`texts-sample-${name}`} />
                </FormField>
              ))}
              <FormField label={t('studio:texts.editor.businessName', 'Business name')} controlId={`${ids}-business`}>
                <Input id={`${ids}-business`} value={preview.business.name} onChange={(event) => setPreview((held) => ({ ...held, business: { ...held.business, name: event.target.value } }))} />
              </FormField>
              <FormField label={t('studio:texts.editor.businessContact', 'Phone or e-mail for stopping')} helper={t('studio:texts.editor.businessContactHelp', 'For the preview. Texts use the app’s phone, or your e-mail sender’s reply-to address.')} controlId={`${ids}-contact`}>
                <Input id={`${ids}-contact`} dir="ltr" value={preview.business.contact} onChange={(event) => setPreview((held) => ({ ...held, business: { ...held.business, contact: event.target.value } }))} data-testid="texts-sample-contact" />
              </FormField>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ─── The tab ────────────────────────────────────────────────────────────────

export function TemplatesTab({ onOpenSetup }: { onOpenSetup: () => void }): ReactNode {
  const client = useQueryClient();
  const list = useQuery(textTemplatesQuery());
  const setup = useQuery(smsSetupQuery());
  const [open, setOpen] = useState<string | null>(null);
  if (list.isPending) {
    return (
      <div className="flex justify-center p-10">
        <Spinner size="md" />
      </div>
    );
  }
  if (list.isError) return <Alert tone="danger" role="alert" title={t('studio:texts.loadFailed', 'This could not be loaded')} body={list.error.message} />;
  const repliesReachUs = setup.data?.repliesCanArrive ?? false;
  const account = setup.data?.account ?? null;
  const template = open === null ? null : (list.data.data.find((one) => one.key === open) ?? null);
  return (
    <div className="flex flex-col gap-4" data-testid="texts-templates-tab">
      {!list.data.connected ? (
        <Card>
          <CardHeader className="flex flex-wrap items-center gap-3">
            <IconTile tone="warn" icon={<MessageSquareText />} />
            <p className="min-w-[200px] flex-1 text-[13px] font-semibold">{t('studio:texts.templates.notConnected', 'No provider is connected, so these templates send nothing yet.')}</p>
            <Button variant="secondary" size="sm" onClick={onOpenSetup}>
              {t('studio:texts.templates.openSetup', 'Open Setup')}
            </Button>
          </CardHeader>
        </Card>
      ) : null}
      {template === null ? (
        <TemplateList templates={list.data.data} repliesReachUs={repliesReachUs} onOpen={setOpen} />
      ) : (
        <Editor
          key={template.key}
          template={template}
          repliesReachUs={repliesReachUs}
          defaultCountry={account?.defaultCountry ?? 'US'}
          defaultSender={account?.sender?.kind === 'name' || account?.sender?.kind === 'pool' ? 'name' : 'number'}
          onBack={() => setOpen(null)}
          onSaved={(next) => client.setQueryData(templatesKey, (held: { data: TextTemplate[]; connected: boolean } | undefined) => (held === undefined ? held : { ...held, data: held.data.map((one) => (one.key === next.key ? next : one)) }))}
        />
      )}
    </div>
  );
}
