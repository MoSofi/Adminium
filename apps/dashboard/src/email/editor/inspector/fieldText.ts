// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The inspector's field labels, row labels, nouns and cell placeholders
 * (Appendix C, the comp's `blockSchema`), as literal `t()` calls keyed by
 * the registry's English so the coverage gate sees every key. The registry
 * (`model/blocks.ts`) stays data; this file is where its English becomes
 * copy.
 */
import { t } from '../../../i18n/t.js';

const FIELD_LABELS: Record<string, () => string> = {
  Heading: () => t('email:fields.heading', 'Heading'),
  'Button text': () => t('email:fields.buttonText', 'Button text'),
  'Link URL': () => t('email:fields.linkUrl', 'Link URL'),
  'Height (px)': () => t('email:fields.height', 'Height (px)'),
  Footer: () => t('email:fields.footer', 'Footer'),
  'Placeholder label': () => t('email:fields.placeholderLabel', 'Placeholder label'),
  'Image URL': () => t('email:fields.imageUrl', 'Image URL'),
  'Left column': () => t('email:fields.leftColumn', 'Left column'),
  'Right column': () => t('email:fields.rightColumn', 'Right column'),
  Quote: () => t('email:fields.quote', 'Quote'),
  Attribution: () => t('email:fields.attribution', 'Attribution'),
  HTML: () => t('email:fields.html', 'HTML'),
  Label: () => t('email:fields.label', 'Label'),
  Value: () => t('email:fields.value', 'Value'),
  'Section label': () => t('email:fields.sectionLabel', 'Section label'),
  'Base amount': () => t('email:fields.baseAmount', 'Base amount'),
  Frequency: () => t('email:fields.frequency', 'Frequency'),
  'Next issue date': () => t('email:fields.nextIssueDate', 'Next issue date'),
  'Schedule note': () => t('email:fields.scheduleNote', 'Schedule note'),
  Balance: () => t('email:fields.balance', 'Balance'),
  Earned: () => t('email:fields.earned', 'Earned'),
  Level: () => t('email:fields.level', 'Level'),
  Body: () => t('email:fields.body', 'Body'),
  'Fine print': () => t('email:fields.finePrint', 'Fine print'),
  'Contact name': () => t('email:fields.contactName', 'Contact name'),
  Email: () => t('email:fields.email', 'Email'),
  Phone: () => t('email:fields.phone', 'Phone'),
};

const ROW_LABELS: Record<string, () => string> = {
  Paragraphs: () => t('email:rows.paragraphs', 'Paragraphs'),
  'List items': () => t('email:rows.listItems', 'List items'),
  Links: () => t('email:rows.links', 'Links'),
  Stats: () => t('email:rows.stats', 'Stats'),
  'Line items': () => t('email:rows.lineItems', 'Line items'),
  'Currencies & rates': () => t('email:rows.currencies', 'Currencies & rates'),
  'Tax components': () => t('email:rows.taxComponents', 'Tax components'),
  Codes: () => t('email:rows.codes', 'Codes'),
  Payments: () => t('email:rows.payments', 'Payments'),
  Steps: () => t('email:rows.steps', 'Steps'),
};

const NOUNS: Record<string, () => string> = {
  paragraph: () => t('email:nouns.paragraph', 'paragraph'),
  item: () => t('email:nouns.item', 'item'),
  link: () => t('email:nouns.link', 'link'),
  stat: () => t('email:nouns.stat', 'stat'),
  currency: () => t('email:nouns.currency', 'currency'),
  'tax line': () => t('email:nouns.taxLine', 'tax line'),
  code: () => t('email:nouns.code', 'code'),
  payment: () => t('email:nouns.payment', 'payment'),
  step: () => t('email:nouns.step', 'step'),
};

const PLACEHOLDERS: Record<string, () => string> = {
  'Paragraph text': () => t('email:placeholders.paragraphText', 'Paragraph text'),
  'List item': () => t('email:placeholders.listItem', 'List item'),
  Label: () => t('email:placeholders.label', 'Label'),
  'Icon name': () => t('email:placeholders.iconName', 'Icon name'),
  URL: () => t('email:placeholders.url', 'URL'),
  'Item name': () => t('email:placeholders.itemName', 'Item name'),
  'Variant / SKU': () => t('email:placeholders.variant', 'Variant / SKU'),
  'Step name': () => t('email:placeholders.stepName', 'Step name'),
  Description: () => t('email:placeholders.description', 'Description'),
};

/** A field's label, translated; an unknown label (a newer registry) shows as written. */
export function fieldLabel(label: string): string {
  return FIELD_LABELS[label]?.() ?? label;
}

export function rowsLabel(label: string): string {
  return ROW_LABELS[label]?.() ?? label;
}

export function rowNoun(noun: string): string {
  return NOUNS[noun]?.() ?? noun;
}

/** Sample values (`$0.00`, `EUR`) stay as written; the wordy ones translate. */
export function cellPlaceholder(placeholder: string): string {
  return PLACEHOLDERS[placeholder]?.() ?? placeholder;
}

export function cycleLabel(status: string): string {
  switch (status) {
    case 'done':
      return t('email:cycle.done', 'Done');
    case 'current':
      return t('email:cycle.current', 'In progress');
    default:
      return t('email:cycle.todo', 'Pending');
  }
}
