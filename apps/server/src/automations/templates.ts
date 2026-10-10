// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHICH TEMPLATE A KEY MEANS, said once.
 *
 * An email step names a template by its key. The step's list, the check at
 * the save and the run each used to answer "is there one?" their own way: the
 * list showed a row per language, the save took any enabled row, and the run
 * looked for the recipient's language and then English only, so a rule could
 * be saved against a key the run would then fail to find.
 *
 * One meaning now: A KEY IS THE FAMILY OF TEMPLATES THAT SHARE IT, AND IT IS
 * LIVE WHILE AT LEAST ONE OF ITS LANGUAGES IS SWITCHED ON AND NOT ARCHIVED.
 * The list shows one row per live key. The save refuses a key that is not
 * live. The run picks the recipient's language, then English, then whichever
 * language of the family is on.
 */
import { blocksShownFor, requiredNamesOfEmail, showWhenNames } from '@adminium/manifest';
import { emailTemplatesRepo, type EmailTemplate, type MetaDb } from '@adminium/meta';

import { resolveEmailTemplate } from '../email/builtins.js';
import { placeholders, requiredPlaceholders } from '../outbox/sender.js';

/**
 * Every placeholder a template reads, in the order it reads them. A
 * `{{row.*}}` is left out: it belongs to the rows a list block draws, and a
 * rule's email draws none.
 */
export function templatePlaceholders(
  template: Pick<EmailTemplate, 'subject' | 'preheader' | 'blocks' | 'footer'>,
): string[] {
  return [...new Set([...placeholders([template.subject, template.preheader, template.blocks, template.footer]), ...showWhenNames(template.blocks)])].filter(
    (name) => !name.startsWith('row.'),
  );
}

/**
 * The placeholders a send must fill, for these values: written with no backup
 * of their own, in a block that is shown. `{{first_name|there}}` asks for
 * nothing, and neither does a block left out because its value is not there.
 * With no values given: whoever the reader is (a name read only inside the
 * block tied to it is never met unfilled).
 */
export function templateRequiredPlaceholders(
  template: Pick<EmailTemplate, 'subject' | 'preheader' | 'blocks' | 'footer'>,
  vars: Readonly<Record<string, string>> | null = null,
): string[] {
  // A block that is shown says its own words: what it would say otherwise is not printed, so asks for nothing.
  const shown = (): unknown[] =>
    blocksShownFor(template.blocks, vars ?? {}).map((block) => {
      if (typeof block !== 'object' || block === null) return block;
      const { otherwise: _otherwise, ...rest } = block as Record<string, unknown>;
      return rest;
    });
  const required = vars === null ? requiredNamesOfEmail(template) : [...requiredPlaceholders([template.subject, template.preheader, shown(), template.footer])];
  return required.filter((name) => !name.startsWith('row.'));
}

/** One live key, as a person or a model picks it. */
export interface TemplateFamily {
  key: string;
  /** Its English name, else the name of the language that stands for it. */
  name: string;
  /** Every `{{name}}` it reads, in reading order. */
  placeholders: string[];
  /** Those of them nothing has to fill: each says its own backup, or only decides whether a block is shown. */
  backed: string[];
  /** An app shipped it, and that app's own sender is what fills it. */
  ownedByApp: boolean;
}

const usable = (row: EmailTemplate): boolean => row.enabled && row.archivedAt === null;

/** The row that stands for its family: English when it is on, else the first language that is. */
function face(rows: readonly EmailTemplate[]): EmailTemplate | null {
  const on = rows.filter(usable);
  return on.find((row) => row.locale === 'en_US') ?? on[0] ?? null;
}

/**
 * Every live key, one row each, and how many keys are there but switched off
 * in every language (so the list can say that they exist and are not shown).
 */
export async function templateFamilies(meta: MetaDb): Promise<{ live: TemplateFamily[]; off: number }> {
  const rows = await emailTemplatesRepo(meta).list({ kind: 'template', archived: false });
  const byKey = new Map<string, EmailTemplate[]>();
  for (const row of rows) byKey.set(row.key, [...(byKey.get(row.key) ?? []), row]);
  const live: TemplateFamily[] = [];
  let off = 0;
  for (const [key, family] of byKey) {
    const shown = face(family);
    if (shown === null) {
      off += 1;
      continue;
    }
    // The family's English name where it has one, even when English itself is off.
    const named = family.find((row) => row.locale === 'en_US') ?? shown;
    const needed = new Set(templateRequiredPlaceholders(shown));
    const reads = templatePlaceholders(shown);
    live.push({ key, name: named.name, placeholders: reads, backed: reads.filter((name) => !needed.has(name)), ownedByApp: shown.managedBy !== null });
  }
  return { live, off };
}

/** The keys a step may name. */
export async function liveTemplateKeySet(meta: MetaDb): Promise<Set<string>> {
  return new Set((await templateFamilies(meta)).live.map((family) => family.key));
}

/**
 * The template a run sends for a key: the recipient's language, then English
 * (as every other sender picks), then whichever language of the family is
 * switched on. `null` only when the key is not live at all.
 */
export async function resolveRuleTemplate(meta: MetaDb, key: string, locale: string): Promise<EmailTemplate | null> {
  const direct = await resolveEmailTemplate(meta, key, locale);
  if (direct !== null) return direct;
  const family = (await emailTemplatesRepo(meta).list({ kind: 'template', archived: false })).filter((row) => row.key === key);
  return face(family);
}
