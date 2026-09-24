// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `outbox` and `emailTemplates` — the emails an app sends, declared with the
 * app and versioned with it.
 *
 * The app's own table IS the outbox: every email is a row in it, queued by
 * whatever wants it sent (a producer below, the desk's "Send now", an
 * operator), then sent by Adminium, which records `sent`, `failed` or
 * `skipped` on the row. So the table is the log a person reads, and a row of
 * a kind already there for the same source is what stops a second send.
 *
 * Producers queue rows by themselves: when a row is created, when a column
 * changes to a value, or a lead time before a timestamp (a reminder at the
 * time each patient chose).
 *
 * Templates are stored with the app as their owner. An operator who edits
 * one keeps the edit across the app's updates.
 */
import { z } from 'zod';

import {
  bcp47TagSchema,
  refSchema,
  scalarSchema,
  settingRefSchema,
  textOrLabels,
  valueFits,
  type ReferenceIssue,
  type TableIndex,
} from './refs.js';

/** The statuses an outbox table's status column must offer. */
export const OUTBOX_STATUSES = ['queued', 'sent', 'failed', 'skipped'] as const;

/** One condition on a row: equal to a value, one of several, or empty (or not). */
const conditionSchema = z
  .object({
    column: refSchema,
    eq: scalarSchema.optional(),
    in: z.array(scalarSchema).min(1).max(32).optional(),
    isNull: z.boolean().optional(),
  })
  .strict()
  .refine((c) => [c.eq, c.in, c.isNull].filter((part) => part !== undefined).length === 1, {
    message: 'a condition says one of eq, in or isNull',
  });
type Condition = z.infer<typeof conditionSchema>;

const producerBase = {
  /** The kind of row it queues (a key of `outbox.kinds`). */
  kind: z.string().min(1).max(40),
  /** The outbox column that links the queued row to the row that produced it. */
  link: refSchema,
  /** Paused while the settings row's `enabled` column is false. */
  gate: z.literal('enabled').optional(),
  /** Skipped for a recipient whose `recipient.optIn` column is false. */
  optIn: z.literal(true).optional(),
};

const producerSchema = z.union([
  z
    .object({ ...producerBase, onCreate: z.object({ table: refSchema, where: conditionSchema.optional() }).strict() })
    .strict(),
  z
    .object({
      ...producerBase,
      onChange: z
        .object({
          table: refSchema,
          column: refSchema,
          to: z.union([scalarSchema, z.array(scalarSchema).min(1).max(16)]),
          where: conditionSchema.optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...producerBase,
      before: z
        .object({
          table: refSchema,
          /** The moment the email leads: a timestamptz. */
          at: refSchema,
          /** How many hours before: read through one link, with a settings fallback. */
          lead: z
            .object({
              via: refSchema,
              table: refSchema,
              column: refSchema,
              fallback: settingRefSchema.optional(),
              /** The largest lead anyone may choose, in hours — how far ahead Adminium looks. */
              max: z.number().int().min(1).max(24 * 14),
            })
            .strict(),
          where: conditionSchema.optional(),
        })
        .strict(),
    })
    .strict(),
]);
export type OutboxProducer = z.infer<typeof producerSchema>;

const recipientSchema = z
  .object({
    /** The outbox column pointing at the person, and their table's columns. */
    via: refSchema,
    table: refSchema,
    email: refSchema,
    name: refSchema.optional(),
    language: refSchema.optional(),
    /** A bool the person sets: false means no reminders. */
    optIn: refSchema.optional(),
    /**
     * Where the address comes from when `via` is empty — a first visit made
     * by someone not yet on file carries their details on the row itself.
     */
    fallback: z
      .object({ via: refSchema, email: refSchema, name: refSchema.optional(), language: refSchema.optional() })
      .strict()
      .optional(),
  })
  .strict();

export const outboxSchema = z
  .object({
    table: refSchema,
    columns: z
      .object({
        kind: refSchema,
        status: refSchema,
        to: refSchema,
        language: refSchema.optional(),
        due: refSchema.optional(),
        sentAt: refSchema.optional(),
        error: refSchema.optional(),
      })
      .strict(),
    /**
     * The outbox's foreign keys, by the name a template reads them under:
     * `{appointment: 'appointment_id'}` gives a template `appointment.*`.
     */
    links: z.record(z.string().regex(/^[a-z][a-z_]*$/, 'a link name is snake_case'), refSchema).optional(),
    recipient: recipientSchema,
    /**
     * The app's one-row settings table, read as `practice.*` by every template;
     * `name` is the column its emails are signed with (the sign-in code's too),
     * and `phone` the number Adminium's own notices give a person to ring —
     * the one sent to an old address after a change of email.
     */
    settings: z
      .object({ table: refSchema, enabled: refSchema.optional(), name: refSchema.optional(), phone: refSchema.optional() })
      .strict()
      .optional(),
    /**
     * Where a template's links lead on the app's guest side: `manage_url` and
     * `booking_url`, as paths under its address (default: its front page).
     */
    pages: z
      .object({
        manage: z.string().regex(/^\/[A-Za-z0-9/_-]{0,119}$/, 'a path on the guest side, e.g. /my-visits').optional(),
        booking: z.string().regex(/^\/[A-Za-z0-9/_-]{0,119}$/, 'a path on the guest side, e.g. /').optional(),
      })
      .strict()
      .optional(),
    /** Each value of the kind column, and the template it is sent with. */
    kinds: z.record(z.string().min(1).max(40), z.string().min(1).max(80)),
    producers: z.array(producerSchema).max(16).optional(),
  })
  .strict();
export type Outbox = z.infer<typeof outboxSchema>;

/**
 * One block of a template, in the shape the template store keeps. The `html`
 * block is refused: its variables are not escaped, and a manifest's template
 * renders values a stranger typed (a name on a first visit).
 */
const emailBlockSchema = z
  .object({
    block: z
      .string()
      .regex(/^email\.[a-z][a-z0-9-]*$/, 'an email block kind, e.g. email.text')
      .refine((kind) => kind !== 'email.html', { message: 'an app template may not use the html block' }),
    id: z.string().min(1).max(60).optional(),
    label: z.string().min(1).max(120).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const emailContentSchema = z
  .object({
    subject: z.string().min(1).max(200),
    preheader: z.string().min(1).max(200).optional(),
    blocks: z.array(emailBlockSchema).min(1).max(40),
    footer: z.string().min(1).max(1000).optional(),
  })
  .strict();

export const emailTemplateSchema = z
  .object({
    /** `<app key>-<name>`: an app names only its own templates. */
    key: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/, 'a template key is kebab-case'),
    name: textOrLabels,
    /** The variables it reads, for the editor's list. */
    vars: z.array(z.string().regex(/^[a-z_]+(\.[a-z_]+)*$/, 'a variable such as patient.name')).max(60).optional(),
    /** The template in each language it ships, US English always among them. */
    locales: z
      .record(bcp47TagSchema, emailContentSchema)
      .refine((locales) => locales['en-US'] !== undefined, { message: 'a template includes en-US' }),
  })
  .strict();
export type EmailTemplate = z.infer<typeof emailTemplateSchema>;

/** Everything in `outbox` and `emailTemplates` that names something undeclared, or does not fit. */
export function outboxIssues(
  m: { key: string; outbox?: Outbox | undefined; emailTemplates?: readonly EmailTemplate[] | undefined },
  index: TableIndex,
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const templates = new Set<string>();
  (m.emailTemplates ?? []).forEach((template, i) => {
    if (!template.key.startsWith(`${m.key}-`)) {
      out.push({ path: ['emailTemplates', i, 'key'], message: `an app's template key starts with "${m.key}-"` });
    }
    if (templates.has(template.key)) out.push({ path: ['emailTemplates', i, 'key'], message: `"${template.key}" is declared twice` });
    templates.add(template.key);
  });

  const box = m.outbox;
  if (box === undefined) {
    if (templates.size > 0) out.push({ path: ['emailTemplates'], message: 'templates are sent through an outbox, and this app declares none' });
    return out;
  }
  const at = (...rest: (string | number)[]) => ['outbox', ...rest];
  if (index.table(box.table) === undefined) {
    out.push({ path: at('table'), message: `"${box.table}" is not a table of this app` });
    return out;
  }
  const col = (table: string, ref: string, types: readonly string[] | null, path: (string | number)[], what: string) => {
    if (index.table(table) === undefined) {
      out.push({ path, message: `"${table}" is not a table of this app` });
      return undefined;
    }
    const found = index.column(table, ref);
    if (found === undefined) out.push({ path, message: `"${table}" has no column "${ref}"` });
    else if (types !== null && !types.includes(found.type)) out.push({ path, message: `"${table}.${ref}" must be ${what}` });
    else return found;
    return undefined;
  };
  const fk = (table: string, ref: string, target: string | undefined, path: (string | number)[]) => {
    const found = col(table, ref, ['fk'], path, 'a foreign key');
    if (found !== undefined && target !== undefined && found.references !== target) {
      out.push({ path, message: `"${table}.${ref}" does not point at "${target}"` });
    }
    if (found !== undefined && found.nullable !== true && table === box.table) {
      out.push({ path, message: `"${table}.${ref}" must be nullable: not every email is about one` });
    }
    return found;
  };
  const condition = (table: string, cond: Condition | undefined, path: (string | number)[]) => {
    if (cond === undefined) return;
    const found = col(table, cond.column, null, [...path, 'column'], '');
    const values = cond.eq !== undefined ? [cond.eq] : (cond.in ?? []);
    if (found !== undefined) for (const value of values) {
      if (!valueFits(found, value)) out.push({ path, message: `${JSON.stringify(value)} is not a value of "${table}.${cond.column}"` });
    }
    if (found !== undefined && cond.isNull !== undefined && found.nullable !== true) {
      out.push({ path, message: `"${table}.${cond.column}" is never empty` });
    }
  };

  const kind = col(box.table, box.columns.kind, ['enum'], at('columns', 'kind'), 'an enum of the kinds');
  const status = col(box.table, box.columns.status, ['enum'], at('columns', 'status'), `an enum of ${OUTBOX_STATUSES.join(', ')}`);
  if (status !== undefined) {
    const missing = OUTBOX_STATUSES.filter((value) => !(status.enum ?? []).includes(value));
    if (missing.length > 0) out.push({ path: at('columns', 'status'), message: `"${box.table}.${status.ref}" lacks ${missing.join(', ')}` });
  }
  col(box.table, box.columns.to, ['text'], at('columns', 'to'), 'a text column');
  if (box.columns.language !== undefined) col(box.table, box.columns.language, ['text'], at('columns', 'language'), 'a text column');
  if (box.columns.due !== undefined) col(box.table, box.columns.due, ['timestamptz'], at('columns', 'due'), 'a timestamptz');
  if (box.columns.sentAt !== undefined) col(box.table, box.columns.sentAt, ['timestamptz'], at('columns', 'sentAt'), 'a timestamptz');
  if (box.columns.error !== undefined) col(box.table, box.columns.error, ['text'], at('columns', 'error'), 'a text column');

  const linkTargets = new Map<string, string | undefined>();
  for (const [name, ref] of Object.entries(box.links ?? {})) {
    linkTargets.set(ref, fk(box.table, ref, undefined, at('links', name))?.references);
  }

  const r = box.recipient;
  fk(box.table, r.via, r.table, at('recipient', 'via'));
  col(r.table, r.email, ['text'], at('recipient', 'email'), 'a text column');
  if (r.name !== undefined) col(r.table, r.name, ['text'], at('recipient', 'name'), 'a text column');
  if (r.language !== undefined) col(r.table, r.language, ['text'], at('recipient', 'language'), 'a text column');
  if (r.optIn !== undefined) col(r.table, r.optIn, ['bool'], at('recipient', 'optIn'), 'a bool');
  if (r.fallback !== undefined) {
    const via = fk(box.table, r.fallback.via, undefined, at('recipient', 'fallback', 'via'));
    const holder = via?.references;
    if (holder !== undefined) {
      col(holder, r.fallback.email, ['text'], at('recipient', 'fallback', 'email'), 'a text column');
      if (r.fallback.name !== undefined) col(holder, r.fallback.name, ['text'], at('recipient', 'fallback', 'name'), 'a text column');
      if (r.fallback.language !== undefined) col(holder, r.fallback.language, ['text'], at('recipient', 'fallback', 'language'), 'a text column');
    }
  }

  if (box.settings !== undefined && index.table(box.settings.table) === undefined) {
    out.push({ path: at('settings', 'table'), message: `"${box.settings.table}" is not a table of this app` });
  } else if (box.settings !== undefined) {
    if (box.settings.enabled !== undefined) col(box.settings.table, box.settings.enabled, ['bool'], at('settings', 'enabled'), 'a bool');
    if (box.settings.name !== undefined) col(box.settings.table, box.settings.name, ['text'], at('settings', 'name'), 'a text column');
    if (box.settings.phone !== undefined) col(box.settings.table, box.settings.phone, ['text'], at('settings', 'phone'), 'a text column');
  }

  for (const [value, template] of Object.entries(box.kinds)) {
    if (kind !== undefined && !(kind.enum ?? []).includes(value)) {
      out.push({ path: at('kinds', value), message: `"${value}" is not a value of "${box.table}.${kind.ref}"` });
    }
    if (!templates.has(template)) out.push({ path: at('kinds', value), message: `"${template}" is not one of the app's emailTemplates` });
  }

  (box.producers ?? []).forEach((producer, p) => {
    const here = (...rest: (string | number)[]) => at('producers', p, ...rest);
    if (box.kinds[producer.kind] === undefined) out.push({ path: here('kind'), message: `"${producer.kind}" is not one of the outbox's kinds` });
    if (producer.gate === 'enabled' && box.settings?.enabled === undefined) {
      out.push({ path: here('gate'), message: 'the outbox names no settings column to be gated by' });
    }
    if (producer.optIn === true && r.optIn === undefined) {
      out.push({ path: here('optIn'), message: 'the recipient names no opt-in column' });
    }
    const source = 'onCreate' in producer ? producer.onCreate : 'onChange' in producer ? producer.onChange : producer.before;
    if (index.table(source.table) === undefined) {
      out.push({ path: here(), message: `"${source.table}" is not a table of this app` });
      return;
    }
    if (!linkTargets.has(producer.link)) {
      out.push({ path: here('link'), message: `"${producer.link}" is not one of the outbox's links` });
    } else if (linkTargets.get(producer.link) !== undefined && linkTargets.get(producer.link) !== source.table) {
      out.push({ path: here('link'), message: `"${box.table}.${producer.link}" does not point at "${source.table}"` });
    }
    condition(source.table, source.where, here('where'));
    if ('onChange' in producer) {
      const change = producer.onChange;
      const watched = col(change.table, change.column, null, here('onChange', 'column'), '');
      if (watched !== undefined) for (const value of Array.isArray(change.to) ? change.to : [change.to]) {
        if (!valueFits(watched, value)) out.push({ path: here('onChange', 'to'), message: `${JSON.stringify(value)} is not a value of "${change.table}.${change.column}"` });
      }
    }
    if ('before' in producer) {
      const before = producer.before;
      col(before.table, before.at, ['timestamptz'], here('before', 'at'), 'a timestamptz');
      fk(before.table, before.lead.via, before.lead.table, here('before', 'lead', 'via'));
      col(before.lead.table, before.lead.column, ['int', 'bigint'], here('before', 'lead', 'column'), 'an int');
      if (before.lead.fallback !== undefined) {
        col(before.lead.fallback.table, before.lead.fallback.column, ['int', 'bigint'], here('before', 'lead', 'fallback'), 'an int');
      }
      if (box.columns.due === undefined) {
        out.push({ path: here('before'), message: 'a reminder records the moment it leads in the outbox\'s due column, and none is named' });
      }
    }
  });
  return out;
}
