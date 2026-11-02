// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE ANSWER DOOR: a stranger's answer to a live form, taken.
 *
 * In this order, and all or nothing:
 *  1. the human check, bound to the form (purpose `form`, at the form's own
 *     difficulty), spent once;
 *  2. the trap field: a filled one is answered exactly as a sent answer is,
 *     and nothing is written or counted, so a bot learns nothing;
 *  3. the caps (`caps.ts`): the network address's hour and the form's hour;
 *     the e-mail address's day once the answer names one. A tripped cap says
 *     how long to wait, and tells the owner (`mail.ts` `alertLimit`);
 *  4. the forms vocabulary's own check (`checkAnswer`), with today as the
 *     business counts it and the page address's query for hidden fields;
 *  5. "becomes": when the form names a table, a new row there through the
 *     app's own entry under the key `forms` (`scope.ts`): only a table that
 *     entry opens, only its `writable` columns, never a link column (a
 *     stranger never names another row), with its `defaults`, plain-text
 *     rule and anonymous limits, as origin `public`, in the form's name. A
 *     create only: a row already there is never changed. Refused, nothing is
 *     written, and the stranger is told why by question;
 *  6. the answer row, in the forms add-on's answers table, written in the
 *     same transaction as the row it became (both are on the add-on's own
 *     database: a form reaches only the apps on it), so neither is ever kept
 *     without the other. The network address and the browser are kept only
 *     with an agreement ticked: the consent log needs them, nothing else does;
 *  7. the agreement: confirmation asked → the answer waits for the click
 *     (`confirm = 'pending'`) and the confirmation mail goes; not asked → a
 *     yes in the consent log now, for the row the answer became when it is a
 *     person, else for the address. No tick, nothing about consent;
 *  8. staff are told (the form's "Tell", and on a survey only when its
 *     low-score rule holds).
 * Mail and notices come after the answer is kept, and never undo it.
 *
 * ─── What waits for a later piece ──────────────────────────────────────────
 * A file question's upload ids are checked for their shape here and kept in
 * the answer's values; tying the uploads to the answer is the file door's
 * (see `ANSWER_FILES_SEAM`). A named survey is answered by invitation only:
 * the door does not read a survey token yet, so a named survey stays "not
 * available" (`routes/forms-door/index.ts`), and `becomes` never fills a link
 * column (see `INVITATION_SEAM`).
 */
import { createHash, randomUUID } from 'node:crypto';

import { checkAnswer, type CheckedAnswer, type Form, type FormQuestion } from '@adminium/add-on-contracts/forms';
import { formsOf } from '@adminium/manifest';
import { formMarksRepo, publicProofsRepo, settingsRepo, type MetaDb } from '@adminium/meta';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';

import type { AddOnInstalls } from '../apps/table-ref.js';
import type { ConsentService } from '../consent/index.js';
import type { SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { insertRow, type RecordWriteService, type WriteContext, type WriteTarget } from '../crud/write-service.js';
import type { SourceDatabase } from '../connections/manager.js';
import { ValidationFailedError } from '../errors.js';
import type { NotificationPublisher } from '../notifications/notify.js';
import { peopleTablesOf } from '../people/tables-of.js';
import { appPartIsOn } from '../rbac/app-parts.js';
import { capKey } from '../public-api/anonymous-caps.js';
import { createPublicRow } from '../public-api/create-row.js';
import { checkProof, PROOF_DIFFICULTY, proofKey } from '../public-api/proof.js';
import type { Switches } from '../public-api/switches.js';
import { prepareValues } from '../public-api/values.js';
import { createFormCaps, type CapCharge, type FormCap } from './caps.js';
import type { LiveForm } from './catalog.js';
import { confirmKey, makeConfirmToken } from './confirm-token.js';
import { alertLimit, formsMailBlocked, holdersOf, sendConfirmMail, tellStaff, toldBy } from './mail.js';
import type { FormsScopes, FormsTable } from './scope.js';
import { businessToday } from './view.js';
import type { ListedWebsites } from './websites.js';

/** A form's harder human check: four more zero bits, about sixteen times the work. */
export const HARDER_DIFFICULTY = PROOF_DIFFICULTY + 4;

/** The key a form's human check is bound to: the add-on that holds it and the form's own row. */
export function formProofKeyId(live: Pick<LiveForm, 'addOn' | 'id'>): string {
  return `form:${live.addOn}:${live.id}`;
}

/** The id a spent proof is kept under (an id's width): the form's key, hashed. */
const spentKeyOf = (live: Pick<LiveForm, 'addOn' | 'id'>): string => `frm${createHash('sha256').update(formProofKeyId(live)).digest('hex').slice(0, 33)}`;

/** The longest browser and network address kept on an answer (the answers table's widths). */
const USER_AGENT_MAX = 512;
const IP_MAX = 64;

/**
 * Where a later piece ties a file question's uploads to the answer: after
 * the answer row is written (its id known), inside the same transaction, the
 * file door's `attach(uploadIds, binding, owner)` is called with each file
 * question's ids from `checked.values`. Until then the ids are kept in the
 * answer's values alone.
 */
export const ANSWER_FILES_SEAM = 'forms/answer.ts writeAnswer: after the answer row';

/**
 * Where a later piece reads a named survey's token (`t` in the body): before
 * the caps, the invitation is found by the token's hash and spent on this
 * send; its record fills the link columns `becomes` names (the only way a
 * link column is ever filled), and the answer row's `invitation_id` is set.
 */
export const INVITATION_SEAM = 'forms/answer.ts takeAnswer: before the caps';

/** What the page sends (`apps/dashboard/src/x/api.ts`). */
export const answerBodySchema = z.object({
  language: z.string().max(20),
  values: z.record(z.string().max(64), z.unknown()),
  query: z.record(z.string().max(64), z.union([z.string().max(2000), z.array(z.string().max(2000)).max(10)])).optional(),
  /** The trap field: hidden from people, filled by bots. */
  website: z.string().max(2000).optional(),
  /** The website the form sat on, as a frame's page knows it (an origin). */
  from: z.string().max(2048).optional(),
});
export type AnswerBody = z.infer<typeof answerBodySchema>;

/** The door's answer, as the route sends it. */
export type AnswerReply =
  | { status: 200; body: { state: 'sent'; ending: 'sent' | 'sent-confirm'; url?: string } }
  | { status: 400; body: { state: 'refused'; errors: Record<string, string> } }
  | { status: 403; body: { state: 'proof' } }
  | { status: 404; body: { state: 'unavailable' } }
  | { status: 200; body: { state: 'closed' } }
  | { status: 429; body: { state: 'too-many'; retryAfter: number | null; window: 'hour' | 'day' } };

export interface AnswerDoorDeps {
  meta: MetaDb;
  secret: string;
  /** A database's handle, and its snapshot read as the routes read it. */
  data: (connectionId: string) => Promise<{ db: Kysely<SourceDatabase>; dialect: WriteTarget['dialect'] }>;
  viewFor: (connectionId: string) => Promise<SnapshotView | null>;
  installs: () => Promise<AddOnInstalls>;
  scopes: FormsScopes;
  writes: RecordWriteService;
  consent: ConsentService;
  switches: Pick<Switches, 'isOn'>;
  websites: ListedWebsites;
  hub?: () => NotificationPublisher | undefined;
  now?: () => number;
}

/** A write through `becomes` refused: by column, or as a whole. */
class FormWriteRefused extends Error {
  constructor(readonly columns: readonly string[]) {
    super('That answer was refused.');
  }
}

/** The ending a sent answer shows: `sent-confirm` when a ticked agreement asks for the click, whatever the address. */
function endingOf(form: Form, values: Readonly<Record<string, unknown>>): { state: 'sent'; ending: 'sent' | 'sent-confirm'; url?: string } {
  const confirming = form.definition.questions.some((question) => question.kind === 'tick' && question.confirm && values[question.id] === true);
  const ending = form.definition.ending;
  return { state: 'sent', ending: confirming ? 'sent-confirm' : 'sent', ...(ending.kind === 'page' ? { url: ending.url } : {}) };
}

/** The origin of a website the owner listed, from what the frame says or the Referer; never a path, never another site. */
async function sentFromOf(request: FastifyRequest, body: AnswerBody, websites: ListedWebsites): Promise<string | null> {
  const listed = new Set(await websites());
  const origin = (text: unknown): string | null => {
    if (typeof text !== 'string' || text.length > 2048) return null;
    try {
      const url = new URL(text);
      return url.protocol === 'https:' ? url.origin : null;
    } catch {
      return null;
    }
  };
  for (const candidate of [origin(body.from), origin(request.headers['referer'])]) if (candidate !== null && listed.has(candidate)) return candidate;
  return null;
}

/** One question's answer as a column takes it: several picks as one text, the rest as they are. */
const columnValue = (value: unknown): unknown => (Array.isArray(value) ? value.join(', ') : value);

/** The text a form is named by in one language. */
const nameIn = (form: Form, language: string): string => (form.definition.title as Record<string, string>)[language] ?? Object.values(form.definition.title)[0] ?? '';

export function createAnswerDoor(deps: AnswerDoorDeps) {
  const { meta } = deps;
  const now = deps.now ?? Date.now;
  const proofs = publicProofsRepo(meta);
  const proofSecret = proofKey(deps.secret);
  const caps = createFormCaps(meta, capKey(deps.secret));
  const capSecret = capKey(deps.secret);
  const confirmSecret = confirmKey(deps.secret);
  const marks = formMarksRepo(meta);

  /** The forms add-on's answers table on its database, read as the routes read it. */
  async function answersTarget(live: LiveForm): Promise<{ target: WriteTarget; pk: string } | null> {
    const installs = await deps.installs();
    const installed = installs.installed(live.connectionId, live.addOn);
    const block = installed === null ? null : formsOf(installed.manifest);
    if (installed === null || block === null) return null;
    const tableId = installs.tableOf(live.connectionId, live.addOn, block.answers);
    const view = await deps.viewFor(live.connectionId);
    if (tableId === null || view === null) return null;
    let table;
    try {
      table = view.table(tableId);
    } catch {
      return null;
    }
    const { db, dialect } = await deps.data(live.connectionId);
    const pk = table.primaryKey[0];
    if (pk === undefined || table.primaryKey.length !== 1) return null;
    return { target: { connectionId: live.connectionId, view, table, db, dialect }, pk };
  }

  /** Tells the owner a cap tripped, once an hour per form. */
  async function alert(live: LiveForm, cap: FormCap, retryAfter: number, at: number): Promise<void> {
    const installs = await deps.installs();
    const block = formsOf(installs.installed(live.connectionId, live.addOn)?.manifest ?? ({ kind: 'app' } as never));
    const formsTable = block === null ? null : installs.tableOf(live.connectionId, live.addOn, block.forms);
    await alertLimit({
      meta,
      caps,
      hub: deps.hub?.(),
      people: await toldBy(meta, live.form.settings.tell),
      // Nobody told: those who may change the form.
      fallback: () => (formsTable === null ? Promise.resolve([]) : holdersOf(meta, `table:${live.connectionId}:${formsTable}:update`)),
      form: { addOn: live.addOn, id: live.id, perHour: live.form.settings.limits.perHour, name: live.form.definition.title as Record<string, string> },
      cap,
      actionUrl: `/add-ons/${encodeURIComponent(live.addOn)}/${encodeURIComponent(live.slug)}?settings=limits`,
      reopensAt: at + retryAfter * 1000,
      mail: (await formsMailBlocked(meta, deps.secret)) === null,
      at,
    });
  }

  /** A tripped cap, said with its real wait. */
  async function tooMany(live: LiveForm, charged: Extract<CapCharge, { ok: false }>, at: number): Promise<AnswerReply> {
    await alert(live, charged.cap, charged.retryAfter, at);
    return { status: 429, body: { state: 'too-many', retryAfter: charged.retryAfter, window: charged.window } };
  }

  /** The person the row an answer became is, when its table is declared people; null otherwise. */
  async function personOf(opened: FormsTable, view: SnapshotView, row: Row | null) {
    if (row === null) return null;
    const declared = await peopleTablesOf(meta).of(opened.connectionId, view.model, opened.tableId);
    const table = view.table(opened.tableId);
    if (declared === null || declared.kind !== 'people' || table.primaryKey.length !== 1) return null;
    return { connectionId: opened.connectionId, table: opened.tableId, key: String(row[table.primaryKey[0]!]) };
  }

  /**
   * Takes one answer (see the header). `request` is the stranger's; `live`
   * the form the address names, live and reachable.
   */
  async function takeAnswer(request: FastifyRequest, live: LiveForm, sent: AnswerBody | null): Promise<AnswerReply> {
    const at = now();
    const { form } = live;

    // 1. The human check, bound to this form and spent once.
    const proved = checkProof(proofSecret, request.headers['x-adminium-proof'], {
      keyId: formProofKeyId(live),
      purpose: 'form',
      now: at,
      difficulty: form.settings.limits.harder ? HARDER_DIFFICULTY : PROOF_DIFFICULTY,
    });
    if (!proved.ok || !(await proofs.spend({ id: proved.spendId, keyId: spentKeyOf(live), purpose: 'form', expiresAt: proved.expiresAt }, at))) {
      return { status: 403, body: { state: 'proof' } };
    }

    // A body that is not an answer at all: the page never sends one.
    if (sent === null) return { status: 400, body: { state: 'refused', errors: { '*': 'shape' } } };
    const body = sent;

    // 2. The trap: answered as sent, and nothing written or counted.
    if (typeof body.website === 'string' && body.website.trim() !== '') return { status: 200, body: endingOf(form, body.values) };

    // (A named survey's token is read here, when the door takes one: INVITATION_SEAM.)

    // 3. The address's hour and the form's.
    const capped = { addOn: live.addOn, id: live.id, perHour: form.settings.limits.perHour };
    const charged = await caps.chargeAnswer(capped, request.ip, at);
    if (!charged.ok) return tooMany(live, charged, at);
    const releases: (() => Promise<void>)[] = [charged.release];
    const giveBack = async () => {
      for (const release of releases) await release().catch(() => undefined);
    };

    // 4. The vocabulary's own check.
    let checked: CheckedAnswer;
    try {
      checked = checkAnswer(form, body.values, { language: body.language, today: await businessToday(meta, live.connectionId, at), query: body.query });
    } catch {
      checked = { ok: false, errors: { '*': 'shape' } };
    }
    if (!checked.ok) {
      await giveBack();
      return { status: 400, body: { state: 'refused', errors: checked.errors } };
    }
    if (checked.email !== null) {
      const daily = await caps.chargeEmail(capped, checked.email, at);
      if (!daily.ok) {
        await giveBack();
        return tooMany(live, daily, at);
      }
      releases.push(daily.release);
    }

    // The agreement ticked, if any, and whether it waits for the click.
    const tick = form.definition.questions.find((question): question is Extract<FormQuestion, { kind: 'tick' }> => question.kind === 'tick' && checked.values[question.id] === true);
    const wording = tick === undefined ? null : ((tick.label as Record<string, string>)[body.language] ?? Object.values(tick.label)[0] ?? '');
    const answers = await answersTarget(live);
    if (answers === null) {
      await giveBack();
      request.log.warn({ form: live.id, addOn: live.addOn }, 'forms door: the answers table cannot be written');
      return { status: 404, body: { state: 'unavailable' } };
    }
    const userAgent = typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'].slice(0, USER_AGENT_MAX) : null;
    const ip = request.ip === '' ? null : request.ip.slice(0, IP_MAX);
    const pending = tick !== undefined && tick.confirm && checked.email !== null;
    const answerId = randomUUID();
    const sentFrom = await sentFromOf(request, body, deps.websites);
    const answerValues = (became: { table: string; key: string } | null): Row => ({
      [answers.pk]: answerId,
      form_id: live.id,
      submitted_at: new Date(at).toISOString(),
      language: body.language,
      values: checked.values,
      email: checked.email,
      name: checked.name,
      became_table: became?.table ?? null,
      became_key: became?.key ?? null,
      confirm: pending ? 'pending' : 'none',
      consent_purpose: tick?.purpose ?? null,
      consent_wording: wording,
      consent_version: tick?.wordingVersion ?? null,
      // Kept only with an agreement ticked: the consent log needs them, nothing else does.
      ip: tick === undefined ? null : ip,
      user_agent: tick === undefined ? null : userAgent,
      sent_from: sentFrom,
    });
    /** The answer row, written by Adminium alone, on `db` (a transaction's, beside the row it became). */
    const writeAnswer = async (db: Kysely<SourceDatabase>, became: { table: string; key: string } | null): Promise<void> => {
      const target = { ...answers.target, db };
      const context: WriteContext = { origin: 'public', hops: 0, actor: { kind: 'public', id: null, label: `Form: ${nameIn(form, body.language)}`.slice(0, 200) }, request: null };
      const verdict = await deps.writes.check('create', target, context, [answerValues(became)], { capacity: 'unchecked' });
      const good = verdict.rows[0];
      if (good === null || good === undefined) throw new Error(`the answers table refused an answer: ${JSON.stringify(verdict.issues[0] ?? {})}`);
      await insertRow(db, answers.target.dialect, answers.target.table, good);
      // (A file question's uploads are tied to the answer here, when the file door is built: ANSWER_FILES_SEAM.)
    };

    // 5 + 6. What the answer becomes, and the answer, together.
    const becomes = form.settings.becomes;
    let became: { opened: FormsTable; view: SnapshotView; row: Row } | null = null;
    if (becomes === null) {
      try {
        await writeAnswer(answers.target.db as Kysely<SourceDatabase>, null);
      } catch (error) {
        await giveBack();
        throw error;
      }
    } else {
      let made: Awaited<ReturnType<typeof becomeRow>>;
      try {
        made = await becomeRow(request, live, checked, writeAnswer, body.language, at);
      } catch (error) {
        // Nothing was kept: the form's and the address's counts go back.
        await giveBack();
        throw error;
      }
      if (made.state !== 'made') {
        await giveBack();
        if (made.state === 'limit') return tooMany(live, { ok: false, cap: 'entry', retryAfter: 3600, window: 'hour' }, at);
        if (made.state === 'refused') return { status: 400, body: { state: 'refused', errors: made.errors } };
        if (made.state === 'closed') return { status: 200, body: { state: 'closed' } };
        return { status: 404, body: { state: 'unavailable' } };
      }
      became = made;
    }

    // 7. The agreement.
    const hub = deps.hub?.();
    if (tick !== undefined && wording !== null) {
      if (pending) {
        const install = String((await settingsRepo(meta).get('system.instanceId')) ?? '');
        const token = makeConfirmToken(confirmSecret, install, { addOn: live.addOn, form: live.id, answer: answerId, purpose: tick.purpose, issuedAt: at });
        await sendConfirmMail({ meta, secret: deps.secret, caps, capKey: capSecret, to: checked.email!, language: body.language, name: checked.name, purpose: tick.purpose, token, at, logger: request.log }).catch((error: unknown) => {
          request.log.warn({ err: error, form: live.id }, 'forms door: the confirmation mail could not be queued');
        });
      } else {
        const person = became === null ? null : await personOf(became.opened, became.view, became.row);
        if (person !== null || checked.email !== null) {
          await deps.consent
            .record({ state: 'yes', person, address: checked.email, purpose: tick.purpose, source: 'form', detail: nameIn(form, form.definition.defaultLanguage).slice(0, 255), wording: { text: wording, version: String(tick.wordingVersion) }, ip, userAgent, at })
            .catch((error: unknown) => request.log.warn({ err: error, form: live.id }, 'forms door: the consent log did not take the yes'));
        }
      }
    }

    // 8. Staff.
    const tellWhen = form.settings.tellWhen;
    const lowEnough = tellWhen === undefined || (typeof checked.values[tellWhen.question] === 'number' && (checked.values[tellWhen.question] as number) <= tellWhen.atMost);
    if (form.settings.tell.length > 0 && lowEnough) {
      const people = await toldBy(meta, form.settings.tell);
      const path = form.definition.kind === 'survey' ? `surveys/${encodeURIComponent(live.slug)}/results` : `${encodeURIComponent(live.slug)}/answers`;
      await tellStaff({
        meta,
        hub,
        people,
        formName: form.definition.title as Record<string, string>,
        questions: form.definition.questions,
        values: checked.values,
        language: body.language,
        actionUrl: `/add-ons/${encodeURIComponent(live.addOn)}/${path}?answer=${encodeURIComponent(answerId)}`,
        mail: (await formsMailBlocked(meta, deps.secret)) === null,
        at,
        logger: request.log,
      });
    }
    return { status: 200, body: endingOf(form, checked.values) };
  }

  type Became =
    | { state: 'made'; opened: FormsTable; view: SnapshotView; row: Row }
    | { state: 'refused'; errors: Record<string, string> }
    | { state: 'limit' }
    | { state: 'closed' }
    | { state: 'unavailable' };

  /**
   * The row an answer becomes, through the app's own entry, and the answer
   * beside it in the same transaction. Anything the form's map cannot honour
   * (a table not opened to forms, a column the entry does not open, a link
   * column) is the form's fault, not the stranger's: "not available", logged.
   */
  async function becomeRow(
    request: FastifyRequest,
    live: LiveForm,
    checked: Extract<CheckedAnswer, { ok: true }>,
    writeAnswer: (db: Kysely<SourceDatabase>, became: { table: string; key: string }) => Promise<void>,
    language: string,
    at: number,
  ): Promise<Became> {
    const becomes = live.form.settings.becomes!;
    const broken = (why: string): Became => {
      request.log.warn({ form: live.id, addOn: live.addOn, table: becomes.table, why }, 'forms door: the form’s "becomes" cannot be honoured');
      return { state: 'unavailable' };
    };
    const scope = await deps.scopes.scopeFor(live.connectionId, live.addOn);
    const opened = scope.tables.get(becomes.table);
    if (opened === undefined) return broken('the table is not opened to forms');
    // The part of the app the entry belongs to, and the settings it needs: closed while off.
    if (!(await appPartIsOn(meta, opened.appKey, opened.entry.module ?? null))) return { state: 'closed' };
    for (const setting of opened.entry.requireSetting) {
      if (!(await deps.switches.isOn(opened.connectionId, setting.table, setting.column))) return { state: 'closed' };
    }
    const view = await deps.viewFor(opened.connectionId);
    if (view === null) return broken('the database has no snapshot');
    let table;
    try {
      table = view.table(opened.tableId);
    } catch {
      return broken('the table is not in the snapshot');
    }
    const links = new Set(view.model.relations.filter((relation) => relation.from.tableId === table.id && relation.through === null).flatMap((relation) => [...relation.from.columns]));
    const decided = new Set(opened.entry.decided);
    const filled = [...Object.values(becomes.map), ...(becomes.source === undefined ? [] : [becomes.source.column])];
    for (const column of filled) {
      if (!opened.resource.writable.has(column) || decided.has(column)) return broken(`"${column}" is not a column the app opens to forms`);
      // A link column is never filled from a question: a stranger never names another row.
      if (links.has(column)) return broken(`"${column}" links to another row`);
    }
    // The map's columns from the answer, and the fixed source; a question not answered fills nothing.
    const raw: Row = {};
    const fedBy = new Map<string, string>();
    for (const [question, column] of Object.entries(becomes.map)) {
      fedBy.set(column, question);
      if (checked.values[question] !== undefined) raw[column] = columnValue(checked.values[question]);
    }
    if (becomes.source !== undefined) raw[becomes.source.column] = becomes.source.value;
    const { db, dialect } = await deps.data(opened.connectionId);
    // The entry's own rules: only its writable columns and values, then its defaults over whatever the answer said.
    const values = prepareValues(opened.resource, raw, null, 'create', dialect, table.columns);
    if (values === null) return broken('a value is not one the entry takes');
    const missing = (opened.resource.requires ?? []).find((column) => values[column] === null || values[column] === undefined || (typeof values[column] === 'string' && (values[column] as string).trim() === ''));
    if (missing !== undefined) {
      const question = fedBy.get(missing);
      return question === undefined ? broken(`"${missing}" is required and nothing fills it`) : { state: 'refused', errors: { [question]: 'required' } };
    }

    const target: WriteTarget = { connectionId: opened.connectionId, view, table, db, dialect };
    const context: WriteContext = {
      origin: 'public',
      hops: 0,
      actor: { kind: 'public', id: null, label: `Form: ${nameIn(live.form, language)}`.slice(0, 200) },
      request,
      claimed: null,
      provedAddress: null,
      adjust: { locale: language.replace('-', '_') },
    };
    const installs = await deps.installs();
    const refused = (columns: readonly string[]): Record<string, string> => {
      const errors: Record<string, string> = {};
      for (const column of columns) {
        const question = fedBy.get(column);
        if (question !== undefined) errors[question] = 'text';
      }
      return Object.keys(errors).length > 0 ? errors : { '*': 'shape' };
    };
    try {
      const made = await createPublicRow({
        app: request.server as FastifyInstance,
        writes: deps.writes,
        // The form marks, read as the public door reads its markers: a form answers nobody's key.
        challenges: marks,
        capKey: capSecret,
        target,
        values,
        context,
        caps: opened.resource.anonymous,
        // The app's limits, counted for every form that writes through its entry.
        charge: { keyId: `forms:${opened.appKey}`, ref: opened.resource.ref, ip: request.ip },
        mapError: (error) => {
          const fields = error instanceof ValidationFailedError ? (error.details as { fields?: Record<string, unknown> } | undefined)?.fields : undefined;
          throw new FormWriteRefused(fields === undefined ? [] : Object.keys(fields));
        },
        // The row and the answer in one transaction: neither is kept without the other.
        run: async ({ create, announce }) => {
          let row: Row | null = null;
          const written = await deps.writes.transaction(target, [values], async (tdb) => {
            const one = await create({ ...target, db: tdb }, async (made) => {
              row = made;
            });
            const key = table.primaryKey.length === 1 ? String(one[table.primaryKey[0]!]) : JSON.stringify(table.primaryKey.map((column) => one[column]));
            await writeAnswer(tdb, { table: installs.refOf(opened.connectionId, opened.tableId), key: key.slice(0, 200) });
            return one;
          });
          if (row !== null) await announce(row);
          return written;
        },
        now: at,
      });
      if (!made.ok && made.why === 'plain-text') return { state: 'refused', errors: refused([made.column]) };
      if (!made.ok) return { state: 'limit' };
      return { state: 'made', opened, view, row: made.row };
    } catch (error) {
      if (error instanceof FormWriteRefused) return { state: 'refused', errors: refused(error.columns) };
      throw error;
    }
  }

  return { takeAnswer };
}

export type AnswerDoor = ReturnType<typeof createAnswerDoor>;
