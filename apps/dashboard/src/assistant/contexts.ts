// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the modal says on each of the four pages.
 *
 * EVERY KEY IS A LITERAL, and that is why this file is long rather than
 * clever. A key assembled from a variable cannot be checked against the eight
 * bundles, so a typo in one renders as a raw dotted string to everybody —
 * `adminium/no-dynamic-i18n-key` forbids it and `key-coverage.test.ts`
 * resolves every literal through the catalogue. The four branches below are
 * the price of that guarantee.
 *
 * WHY THE COPY IS HERE AND NOT ON THE SERVER. The server answers with FACTS —
 * how many templates, which connection, how many readable tables — and this
 * file turns them into sentences. A sentence composed on the server would be
 * English on the wire, and English on the wire cannot be translated.
 *
 * The actions are fixed per page and fixed in ORDER. They are not a list the
 * model contributes to: what a person may do with a draft is a product
 * decision, and a model that could name its own buttons could name one that
 * writes.
 */
import { t } from '../i18n/t.js';
import type { AssistantContext } from './api.js';

/** What a button on the result card does. */
export type AssistantActionId = 'save' | 'test-send' | 'sample' | 'editor';

export interface AssistantActionSpec {
  id: AssistantActionId;
  label: string;
  icon: string;
  /** The accent button; at most one per page. */
  primary: boolean;
  /**
   * Whether this button changes anything. A read-only action stays available
   * to a session that may not save, and needs no confirmation.
   */
  writes: boolean;
}

export interface AssistantSuggestion {
  icon: string;
  label: string;
}

/** The named facts the server measured, which the sentences below interpolate. */
export interface AssistantFactValues {
  templates?: number;
  campaigns?: number;
  invoices?: number;
  reports?: number;
  tables?: number;
  connection?: string;
  /** The shape a template's number takes before one is minted. */
  pattern?: string;
  /** `true` when this session may save on this page — the blurb says so plainly. */
  write?: boolean;
}

export interface AssistantCopy {
  /** The header pill: the page this session was opened from. */
  page: string;
  pageIcon: string;
  /** The header's one-line summary of what it knows. */
  blurb: string;
  greeting: string;
  greetingSub: string;
  placeholder: string;
  suggestions: AssistantSuggestion[];
  /** The steps card's title once the work is done and the model named none. */
  workTitle: string;
  actions: AssistantActionSpec[];
  /** The scope chip's left half; the report page names its connection instead. */
  scopePrimary: string;
}

export function contextCopy(
  context: AssistantContext,
  values: AssistantFactValues,
  name: string,
): AssistantCopy {
  const args = { ...values, name, write: values.write === true };
  switch (context) {
    case 'email':
      return {
        page: t('assistant:email.page', 'Email templates'),
        pageIcon: 'mail',
        blurb: t(
          'assistant:email.blurb',
          'Knows this page: {templates, plural, one {# template} other {# templates}} · {campaigns, plural, one {# campaign} other {# campaigns}} · branding',
          args,
        ),
        greeting: t(
          'assistant:email.greeting',
          'I can see your email templates — the block format, your branding, and the variables each template can use.',
          args,
        ),
        greetingSub: t(
          'assistant:email.greetingSub',
          'Describe the email you need and I will draft it in Adminium’s template format, then you can test-send it before saving.',
          args,
        ),
        placeholder: t('assistant:email.placeholder', 'Describe the template you need…'),
        suggestions: [
          { icon: 'credit-card', label: t('assistant:email.chip1', 'Draft a reminder for an unpaid invoice') },
          { icon: 'hourglass', label: t('assistant:email.chip2', 'Create an appointment reminder, 3 days out') },
          { icon: 'languages', label: t('assistant:email.chip3', 'Localise the Welcome template into German') },
        ],
        workTitle: t('assistant:email.workTitle', 'Drafted a new email template'),
        scopePrimary: t('assistant:email.scopePrimary', 'email_templates'),
        actions: [
          { id: 'test-send', label: t('assistant:email.action1', 'Send test email'), icon: 'send', primary: false, writes: true },
          { id: 'editor', label: t('assistant:email.action2', 'Open in editor'), icon: 'pen-tool', primary: false, writes: true },
          { id: 'save', label: t('assistant:email.action3', 'Save template'), icon: 'save', primary: true, writes: true },
        ],
      };
    case 'invoice-template':
      return {
        page: t('assistant:invoiceTemplate.page', 'Invoice templates'),
        pageIcon: 'file-text',
        blurb: t(
          'assistant:invoiceTemplate.blurb',
          'Knows this page: {templates, plural, one {# template} other {# templates}} · numbering {pattern} · {invoices, plural, one {# invoice} other {# invoices}}',
          args,
        ),
        greeting: t(
          'assistant:invoiceTemplate.greeting',
          'I can see your invoice templates, your numbering scheme and the tax lines your templates use.',
          args,
        ),
        greetingSub: t(
          'assistant:invoiceTemplate.greetingSub',
          'Tell me the template you need and I will build it to Adminium’s invoice format, then render a sample with real account data.',
          args,
        ),
        placeholder: t('assistant:invoiceTemplate.placeholder', 'Describe the invoice template you need…'),
        suggestions: [
          { icon: 'euro', label: t('assistant:invoiceTemplate.chip1', 'Create a template for EU clients with reverse-charge VAT') },
          { icon: 'alarm-clock', label: t('assistant:invoiceTemplate.chip2', 'Add a late-fee notice section to one of my templates') },
          { icon: 'palette', label: t('assistant:invoiceTemplate.chip3', 'Match one of my templates to our branding colours') },
        ],
        workTitle: t('assistant:invoiceTemplate.workTitle', 'Built a new invoice template'),
        scopePrimary: t('assistant:invoiceTemplate.scopePrimary', 'invoice_templates'),
        actions: [
          { id: 'sample', label: t('assistant:invoiceTemplate.action1', 'Preview another sample'), icon: 'eye', primary: false, writes: false },
          { id: 'editor', label: t('assistant:invoiceTemplate.action2', 'Open in editor'), icon: 'pen-tool', primary: false, writes: true },
          { id: 'save', label: t('assistant:invoiceTemplate.action3', 'Save template'), icon: 'save', primary: true, writes: true },
        ],
      };
    case 'invoices':
      return {
        page: t('assistant:invoices.page', 'Invoices'),
        pageIcon: 'receipt',
        blurb: t(
          'assistant:invoices.blurb',
          'Knows this page: {invoices, plural, one {# invoice} other {# invoices}} · {templates, plural, one {# template} other {# templates}} · your role can {write, select, true {write} other {read}}',
          args,
        ),
        greeting: t(
          'assistant:invoices.greeting',
          'I can see the invoice table, your templates, and the places invoice data can come from.',
          args,
        ),
        greetingSub: t(
          'assistant:invoices.greetingSub',
          'Tell me who to bill and I will ask which template to use and where to pull the lines from before drafting anything.',
          args,
        ),
        placeholder: t('assistant:invoices.placeholder', 'e.g. create an invoice for a customer for last month…'),
        suggestions: [
          { icon: 'file-plus', label: t('assistant:invoices.chip1', 'Create an invoice for a customer for last month') },
          { icon: 'clock', label: t('assistant:invoices.chip2', 'Draft an invoice from last month’s unbilled entries') },
          { icon: 'bell', label: t('assistant:invoices.chip3', 'List the invoices that are past their due date') },
        ],
        workTitle: t('assistant:invoices.workTitle', 'Drafted an invoice'),
        scopePrimary: t('assistant:invoices.scopePrimary', 'invoices'),
        actions: [
          { id: 'editor', label: t('assistant:invoices.action1', 'Open in editor'), icon: 'pen-tool', primary: false, writes: true },
          { id: 'save', label: t('assistant:invoices.action2', 'Create draft invoice'), icon: 'file-plus', primary: true, writes: true },
        ],
      };
    case 'report':
      return {
        page: t('assistant:report.page', 'Report builder'),
        pageIcon: 'bar-chart-3',
        blurb: t(
          'assistant:report.blurb',
          'Knows this page: {reports, plural, one {# report} other {# reports}} · {connection} · {tables, plural, one {# readable table} other {# readable tables}}',
          args,
        ),
        greeting: t(
          'assistant:report.greeting',
          'I can see your report library and the {tables, plural, one {# table} other {# tables}} your role can read in {connection}.',
          args,
        ),
        greetingSub: t(
          'assistant:report.greetingSub',
          'Name the tables and layout, or just tell me the question and I will choose the sources and show you why.',
          args,
        ),
        placeholder: t('assistant:report.placeholder', 'Ask for a report, or name the tables to use…'),
        suggestions: [
          { icon: 'wand-2', label: t('assistant:report.chip1', 'Which customers take the most support time? You pick the sources') },
          { icon: 'table-2', label: t('assistant:report.chip2', 'Build a retention report from customers and orders') },
          { icon: 'layout-template', label: t('assistant:report.chip3', 'Create a monthly operational review template') },
        ],
        workTitle: t('assistant:report.workTitle', 'Built the report'),
        scopePrimary: t('assistant:report.scopePrimary', 'reports'),
        actions: [
          { id: 'sample', label: t('assistant:report.action1', 'Run full preview'), icon: 'play', primary: false, writes: false },
          { id: 'editor', label: t('assistant:report.action2', 'Open in builder'), icon: 'pen-tool', primary: false, writes: true },
          { id: 'save', label: t('assistant:report.action3', 'Save report'), icon: 'save', primary: true, writes: true },
        ],
      };
  }
}

export interface ConfirmCopy {
  title: string;
  body: string;
  button: string;
  /** The REAL audit key this action writes — the row the trail will carry. */
  auditKey: string;
  icon: string;
}

/**
 * What the confirm dialog says before a write.
 *
 * `open` picks the body that also promises the editor, which is what makes
 * *Open in editor* from a manager honest about creating a row.
 */
export function confirmCopy(
  context: AssistantContext,
  options: { name: string; title: string; open: boolean },
): ConfirmCopy {
  const args = { name: options.name, title: options.title };
  // The REAL key, not the comp's `milo.email_template.create` mock: the row
  // this action leaves is the one the Audit Log will show, and a confirm that
  // named a different one would be a promise nothing keeps.
  const auditKey = `assistant.${context}.create`;
  switch (context) {
    case 'email':
      return {
        title: t('assistant:email.confirm.title', 'Save as a new template?'),
        body: options.open
          ? t(
              'assistant:email.confirm.bodyOpen',
              '{name} will create “{title}” as a draft in Email templates and open it in the editor.',
              args,
            )
          : t(
              'assistant:email.confirm.body',
              '{name} will create “{title}” as a draft in Email templates. Nothing is sent to customers until you set it live.',
              args,
            ),
        button: t('assistant:email.confirm.button', 'Save as draft'),
        auditKey,
        icon: 'save',
      };
    case 'invoice-template':
      return {
        title: t('assistant:invoiceTemplate.confirm.title', 'Save as a new invoice template?'),
        body: options.open
          ? t(
              'assistant:invoiceTemplate.confirm.bodyOpen',
              '{name} will add “{title}” to Invoice templates as a draft and open it in the editor.',
              args,
            )
          : t(
              'assistant:invoiceTemplate.confirm.body',
              '{name} will add “{title}” to Invoice templates as a draft. Existing invoices are untouched.',
              args,
            ),
        button: t('assistant:invoiceTemplate.confirm.button', 'Save as draft'),
        auditKey,
        icon: 'save',
      };
    case 'invoices':
      return {
        title: t('assistant:invoices.confirm.title', 'Create this draft invoice?'),
        body: options.open
          ? t(
              'assistant:invoices.confirm.bodyOpen',
              '{name} will add this invoice to Invoices as a draft and open it in the editor.',
              args,
            )
          : t(
              'assistant:invoices.confirm.body',
              '{name} will add this invoice to Invoices as a draft. No customer rows are changed until you send it.',
              args,
            ),
        button: t('assistant:invoices.confirm.button', 'Create draft'),
        auditKey,
        icon: 'file-plus',
      };
    case 'report':
      return {
        title: t('assistant:report.confirm.title', 'Save this report?'),
        body: options.open
          ? t(
              'assistant:report.confirm.bodyOpen',
              '{name} will add “{title}” to Reports and open it in the builder.',
              args,
            )
          : t(
              'assistant:report.confirm.body',
              '{name} will add “{title}” to Reports. It runs on demand — no schedule until you set one.',
              args,
            ),
        button: t('assistant:report.confirm.button', 'Save report'),
        auditKey,
        icon: 'save',
      };
  }
}

/** What the server reported an action did. A kind this build does not know says nothing. */
export type EchoKind = 'saved' | 'saved-open' | 'language-added' | 'test-sent' | 'sampled' | 'resampled';

function echoKindOf(echo: Record<string, unknown>): EchoKind | null {
  const kind = typeof echo.kind === 'string' ? echo.kind : '';
  if (kind === 'saved') return echo.open === true ? 'saved-open' : 'saved';
  if (kind === 'language-added' || kind === 'test-sent' || kind === 'sampled' || kind === 'resampled') return kind;
  return null;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * The sentence under the result card after an action ran.
 *
 * The server answers with a FACT (`{ kind: 'saved', … }`) rather than a
 * sentence, for the same reason the blurb is composed here: English on the
 * wire cannot be translated. Each page says it in its own words, because
 * "saved as a draft" means something different on each of them.
 */
export function echoText(
  context: AssistantContext,
  echo: Record<string, unknown>,
  fallbackName: string,
): string | null {
  const kind = echoKindOf(echo);
  if (kind === null) return null;
  const label = typeof echo.label === 'string' ? echo.label : fallbackName;
  const locale = typeof echo.locale === 'string' ? echo.locale : '';
  const to = typeof echo.to === 'string' ? echo.to : '';
  const refreshed = count(echo.refreshed);
  const refused = count(echo.refused);
  switch (context) {
    case 'email':
      switch (kind) {
        case 'saved':
          return t('assistant:email.echo.saved', 'Saved as a draft template.');
        case 'saved-open':
          return t('assistant:email.echo.editor', 'Saved as a draft template. Opening it in the editor.');
        case 'language-added':
          return t('assistant:email.language.saved', 'Added the {locale} variation as a draft.', { locale });
        case 'test-sent':
          return t('assistant:email.echo.test', 'Test sent to {email} with sample data.', { email: to });
        // Only the report page re-runs anything: its blocks hold figures that
        // came from a database, and no other page's do.
        case 'resampled':
          return null;
        case 'sampled':
          return t('assistant:email.echo.sample', 'Rendered a sample for {record}.', { record: label });
      }
      break;
    case 'invoice-template':
      switch (kind) {
        case 'saved':
          return t('assistant:invoiceTemplate.echo.saved', 'Saved as a draft template.');
        case 'saved-open':
          return t('assistant:invoiceTemplate.echo.editor', 'Saved as a draft. Opening it in the editor.');
        case 'language-added':
          return t('assistant:invoiceTemplate.language.saved', 'Added the {locale} variation as a draft.', { locale });
        case 'test-sent':
          return t('assistant:invoiceTemplate.echo.test', 'Test sent to {email}.', { email: to });
        // This page REDRAWS over another record rather than re-running a
        // source, so a `resampled` echo here means the redraw found nothing
        // to draw over — worth saying, because the preview did not move.
        case 'resampled':
          return t('assistant:invoiceTemplate.echo.noSample', 'There is no invoice here to draw a sample from.');
        case 'sampled':
          return t('assistant:invoiceTemplate.echo.sample', 'Rendered a sample for {record}.', { record: label });
      }
      break;
    case 'invoices':
      switch (kind) {
        case 'saved':
          return t('assistant:invoices.echo.saved', 'Created as a draft. It is at the top of the table.');
        case 'saved-open':
          return t('assistant:invoices.echo.editor', 'Created as a draft. Opening it in the invoice editor.');
        case 'language-added':
          return t('assistant:invoices.language.saved', 'Added the {locale} variation as a draft.', { locale });
        case 'test-sent':
          return t('assistant:invoices.echo.test', 'Test sent to {email}.', { email: to });
        // Only the report page re-runs anything: its blocks hold figures that
        // came from a database, and no other page's do.
        case 'resampled':
          return null;
        case 'sampled':
          return t('assistant:invoices.echo.sample', 'Rendered a sample for {record}.', { record: label });
      }
      break;
    case 'report':
      switch (kind) {
        case 'saved':
          return t('assistant:report.echo.saved', 'Saved to Reports. Add a schedule from the report header.');
        case 'saved-open':
          return t('assistant:report.echo.editor', 'Saved to Reports. Opening it in the builder.');
        case 'language-added':
          return t('assistant:report.language.saved', 'Added the {locale} variation as a draft.', { locale });
        case 'test-sent':
          return t('assistant:report.echo.test', 'Test sent to {email}.', { email: to });
        case 'resampled':
          return refused === 0
            ? t(
                'assistant:report.echo.resampled',
                'Re-ran the sources — {n, plural, one {# figure} other {# figures}} updated.',
                { n: refreshed },
              )
            : t(
                'assistant:report.echo.resampledRefused',
                'Re-ran the sources — {n, plural, one {# figure} other {# figures}} updated; {refused, plural, one {# source} other {# sources}} could not be read.',
                { n: refreshed, refused },
              );
        // Reachable only where a re-run had no deps to run with — a story or
        // a harness. In the product this page always re-runs.
        case 'sampled':
          return t('assistant:report.echo.sample', 'Ran the full query for {record}.', { record: label });
      }
      break;
  }
  return null;
}

/**
 * The turn's first step, worded.
 *
 * The server publishes it with the page's named FACTS and no sentence — the
 * same rule the blurb and the detail rows follow, because a sentence composed
 * there is English on the wire. `facts` arrives straight from the page's own
 * `pageFacts`, so this reads exactly what the model was told, in the
 * operator's language.
 */
export function pageReadStep(
  context: AssistantContext,
  facts: Record<string, string | number | boolean>,
): { label: string; detail: string } {
  const args = { ...facts, write: facts.write === true };
  const label = t('assistant:steps.readPage', 'Read this page');
  switch (context) {
    case 'email':
      return {
        label,
        detail: t(
          'assistant:email.readPage',
          'Email templates · {templates, plural, one {# template} other {# templates}} · branding',
          args,
        ),
      };
    case 'invoice-template':
      return {
        label,
        detail: t(
          'assistant:invoiceTemplate.readPage',
          'Invoice templates · {templates, plural, one {# template} other {# templates}} · numbering {pattern}',
          args,
        ),
      };
    case 'invoices':
      return {
        label,
        detail: t(
          'assistant:invoices.readPage',
          'Invoices · {invoices, plural, one {# record} other {# records}} · your role can {write, select, true {write} other {read}}',
          args,
        ),
      };
    case 'report':
      return {
        label,
        detail: t(
          'assistant:report.readPage',
          'Report builder · {reports, plural, one {# report} other {# reports}} · {tables, plural, one {# readable table} other {# readable tables}}',
          args,
        ),
      };
  }
}
