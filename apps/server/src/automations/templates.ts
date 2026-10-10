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
import { emailTemplatesRepo, type EmailTemplate, type MetaDb } from '@adminium/meta';

import { resolveEmailTemplate } from '../email/builtins.js';
import { placeholders } from '../outbox/sender.js';

/**
 * Every placeholder a template reads, in the order it reads them. A
 * `{{row.*}}` is left out: it belongs to the rows a list block draws, and a
 * rule's email draws none.
 */
export function templatePlaceholders(
  template: Pick<EmailTemplate, 'subject' | 'preheader' | 'blocks' | 'footer'>,
): string[] {
  return [...placeholders([template.subject, template.preheader, template.blocks, template.footer])].filter(
    (name) => !name.startsWith('row.'),
  );
}

/** One live key, as a person or a model picks it. */
export interface TemplateFamily {
  key: string;
  /** Its English name, else the name of the language that stands for it. */
  name: string;
  /** Every `{{name}}` it reads, in reading order. */
  placeholders: string[];
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
    live.push({ key, name: named.name, placeholders: templatePlaceholders(shown), ownedByApp: shown.managedBy !== null });
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
