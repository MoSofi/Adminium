// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE ANSWER DOOR: a stranger's answer to a live form, taken.
 *
 * In this order, and all or nothing:
 *  1. the human check, bound to the form (purpose `form`, at the form's own
 *     difficulty), spent once;
 *  2. the trap field: a filled one is answered exactly as a sent answer is,
 *     and nothing is written or counted, so a bot learns nothing;
 *     a named survey's token (`t`) is read next (`invitation.ts`): none, an
 *     unknown or an expired one → "this link doesn't work"; one answered
 *     already → "already answered". An anonymous survey takes none;
 *  3. the caps (`caps.ts`): the network address's hour and the form's hour;
 *     the e-mail address's day once the answer names one. A tripped cap says
 *     how long to wait, and tells the owner (`mail.ts` `alertLimit`);
 *  4. the forms vocabulary's own check (`checkAnswer`), with today as the
 *     business counts it and the page address's query for hidden fields;
 *  5. "becomes": when the form names a table, a new row there through the
 *     app's own entry under the key `forms` (`scope.ts`): only a table that
 *     entry opens, only its `writable` columns, never a link column from a
 *     question (a stranger never names another row); a named survey's
 *     invitation alone fills the link columns the entry opens that point at
 *     the record it names (the job a feedback row is about). With its
 *     `defaults`, plain-text rule and anonymous limits, as origin `public`,
 *     in the form's name. A
 *     create only: a row already there is never changed. Refused, nothing is
 *     written, and the stranger is told why by question;
 *  6. the answer row, in the forms add-on's answers table, written in the
 *     same transaction as the row it became (both are on the add-on's own
 *     database: a form reaches only the apps on it), so neither is ever kept
 *     without the other. In that transaction too: the invitation is spent
 *     (only while still unanswered: of two sends with one token one wins),
 *     and the files the answer names are attached to it (`files.ts`; any
 *     file refused refuses the whole answer, and a transaction that does not
 *     stand lets them go again). The network address and the browser are
 *     kept only with an agreement ticked: the consent log needs them, nothing
 *     else does. A named survey's answer keeps its invitation and the
 *     invitee's address and name; with "Link answers to names" off it keeps
 *     none of the three;
 *  7. the agreement: confirmation asked → the answer waits for the click
 *     (`confirm = 'pending'`) and the confirmation mail goes (asked with no
 *     address given: nothing is written); not asked → a yes in the consent
 *     log now, for the row the answer became when it is a person, else for
 *     the address. A yes no confirm link proved never replaces a "no" to the
 *     purpose nor passes the do-not-email list: such an answer waits for the
 *     click instead, or, with no address to mail, writes nothing. No tick,
 *     nothing about consent;
 *  8. staff are told (the form's "Tell", and on a survey only when its
 *     low-score rule holds): only those who may read this answer in the
 *     add-on's answers table when it is sent; the rest are skipped.
 * Mail and notices come after the answer is kept, and never undo it.
 */
import { createHash, randomUUID } from 'node:crypto';

import { checkAnswer, keepsNames, type CheckedAnswer, type Form, type FormQuestion, type FormTickPurpose } from '@adminium/add-on-contracts/forms';
import { ANSWER_INVITATION_COLUMN, FORMS_BECAME_TABLE_MAX, formsOf } from '@adminium/manifest';
import { formMarksRepo, publicProofsRepo, settingsRepo, type ConsentPerson, type MetaDb } from '@adminium/meta';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';

import type { AddOnInstalls } from '../apps/table-ref.js';
import type { ConsentService } from '../consent/index.js';
import { looksLikeAddress } from '../consent/service.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
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
import type { FormsFiles, QuestionFiles } from './files.js';
import { isNamedSurvey, type OpenInvitation, type SurveyInvitations } from './invitation.js';
import { confirmAddressHash, confirmKey, makeConfirmToken } from './confirm-token.js';
import { alertLimit, answerReaders, formsMailBlocked, holdersOf, sendConfirmMail, tellStaff, toldBy, type AnswersAt } from './mail.js';
import { openedTable, type FormsScopes, type FormsTable } from './scope.js';
import { businessToday } from './view.js';
import type { ListedWebsites } from './websites.js';

/** A form's harder human check: four more zero bits, about sixteen times the work. */
export const HARDER_DIFFICULTY = PROOF_DIFFICULTY + 4;

/** The key a form's human check is bound to: the add-on that holds it and the form's own row. */
export function formProofKeyId(live: Pick<LiveForm, 'addOn' | 'id'>): string {
  return `form:${live.addOn}:${live.id}`;
}

/** The key a spent proof is kept under (`adminium_public_proofs.key_id` holds 36): the form's key, hashed. */
export const spentKeyOf = (live: Pick<LiveForm, 'addOn' | 'id'>): string => `frm${createHash('sha256').update(formProofKeyId(live)).digest('hex').slice(0, 33)}`;

/** The longest browser and network address kept on an answer (the answers table's widths). */
const USER_AGENT_MAX = 512;
const IP_MAX = 64;
/** The least an answers table holds of the row an answer became: its table's stored name, and its key (the forms contract's widths). */
const BECAME_KEY_MAX = 200;

/** How many characters a text column holds: its own width when the database says one, else the contract's least. */
function widthOf(table: ResolvedTable, column: string, least: number): number {
  const width = table.table?.columns.find((one) => one.name === column)?.maxLength;
  return typeof width === 'number' && width > 0 ? Math.max(width, least) : least;
}

/**
 * The row an answer became, as its answers table can keep it: whole, or not
 * at all. A name cut short could name another table or none; an app whose
 * forms entry's table is stored longer than the contract's 64 is refused at
 * install, so this is only ever a table wider names were never meant for.
 */
export function becameFor(table: ResolvedTable, became: { table: string; key: string } | null): { table: string; key: string } | null {
  if (became === null) return null;
  if (became.table.length > widthOf(table, 'became_table', FORMS_BECAME_TABLE_MAX) || became.key.length > widthOf(table, 'became_key', BECAME_KEY_MAX)) return null;
  return became;
}

/** Where in the forms add-on's one page a survey is: its forms open under the page by slug, its surveys under this word. */
export const SURVEYS_PATH = 'surveys';

/**
 * A staff link into the forms add-on's own page: `/add-ons/<add-on>/<page
 * ref>/…`. The dashboard opens the page the first segment after the add-on
 * names (`AddOnPageHost`), and hands that page the rest. The page ref is the
 * add-on's own key: the one ref a manifest may give any add-on's page (every
 * other is `<key>-…`), so the link opens whatever the add-on is keyed. An
 * answer opens on its form's answers (`<slug>/answers`), or on its survey's
 * results (`surveys/<slug>/results`); the limits on the form's settings.
 */
export function formsStaffLink(live: Pick<LiveForm, 'addOn' | 'slug' | 'form'>, to: 'answer' | 'limits', answerId?: string): string {
  const key = encodeURIComponent(live.addOn);
  const base = `/add-ons/${key}/${key}`;
  const slug = encodeURIComponent(live.slug);
  if (to === 'limits') return `${base}/${slug}?settings=limits`;
  const page = live.form.definition.kind === 'survey' ? `${SURVEYS_PATH}/${slug}/results` : `${slug}/answers`;
  return `${base}/${page}?answer=${encodeURIComponent(answerId ?? '')}`;
}

/** What the page sends (`apps/dashboard/src/x/api.ts`). */
export const answerBodySchema = z.object({
  language: z.string().max(20),
  values: z.record(z.string().max(64), z.unknown()),
  query: z.record(z.string().max(64), z.union([z.string().max(2000), z.array(z.string().max(2000)).max(10)])).optional(),
  /** The trap field: hidden from people, filled by bots. */
  website: z.string().max(2000).optional(),
  /** The website the form sat on, as a frame's page knows it (an origin). */
  from: z.string().max(2048).optional(),
  /** A named survey's one-use token, from its invitation's link (`?t=`). */
  t: z.string().max(2000).optional(),
});
export type AnswerBody = z.infer<typeof answerBodySchema>;

/** The door's answer, as the route sends it. */
export type AnswerReply =
  | { status: 200; body: { state: 'sent'; ending: 'sent' | 'sent-confirm'; url?: string } }
  | { status: 400; body: { state: 'refused'; errors: Record<string, string> } }
  | { status: 403; body: { state: 'proof' } }
  | { status: 404; body: { state: 'unavailable' } }
  | { status: 200; body: { state: 'closed' } }
  /** A named survey's invitation answered already (or its record has its answer already). */
  | { status: 409; body: { state: 'already' } }
  /** A named survey's link that does not work: no token, an unknown one, or one past its time. */
  | { status: 410; body: { state: 'dead' } }
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
  /** A named survey's invitations: found by token, spent by the answer. */
  invitations: SurveyInvitations;
  /** The strangers' files a file question names: attached to the answer in its transaction. */
  files?: Pick<FormsFiles, 'attachToAnswer' | 'detachAnswer'> | undefined;
  hub?: () => NotificationPublisher | undefined;
  now?: () => number;
}

/** A write through `becomes` refused: by column, or as a whole. */
class FormWriteRefused extends Error {
  constructor(readonly columns: readonly string[]) {
    super('That answer was refused.');
  }
}

/** A file the answer names could not be attached: the whole answer is refused, nothing kept. */
class FilesRefused extends Error {
  constructor() {
    super('A file the answer names was refused.');
  }
}

/** The invitation was answered by another send while this one was on its way. */
class InvitationSpent extends Error {
  constructor() {
    super('The invitation was answered already.');
  }
}

/** Each file question's upload ids, as the checked answer holds them. */
function filesOf(form: Form, values: Readonly<Record<string, unknown>>): QuestionFiles[] {
  const out: QuestionFiles[] = [];
  for (const question of form.definition.questions) {
    const ids = values[question.id];
    if (question.kind !== 'file' || !Array.isArray(ids) || ids.length === 0) continue;
    out.push({ question: question.id, ids: ids.filter((id): id is string => typeof id === 'string') });
  }
  return out;
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

/** Whether a column allows one row per value: a unique column, or a one-column unique constraint on it. */
function uniqueColumn(table: ResolvedTable, column: string): boolean {
  return table.table.columns.some((one) => one.name === column && one.isUnique) || table.table.uniques.some((unique) => unique.columns.length === 1 && unique.columns[0] === column);
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
      // Those the form tells who may read its answers (the alert shows none, so the grant alone).
      people: async () => {
        const answers = await answersTarget(live);
        return answers === null ? [] : answerReaders(meta, await toldBy(meta, live.form.settings.tell), { connectionId: live.connectionId, table: answers.target.table, model: answers.target.view.model, db: answers.target.db });
      },
      // Nobody told: those who may change the form.
      fallback: () => (formsTable === null ? Promise.resolve([]) : holdersOf(meta, `table:${live.connectionId}:${formsTable}:update`)),
      form: { addOn: live.addOn, id: live.id, perHour: live.form.settings.limits.perHour, name: live.form.definition.title as Record<string, string> },
      cap,
      actionUrl: formsStaffLink(live, 'limits'),
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

  /**
   * The person the row an answer became is, when its table is declared
   * people (with the address that row holds, when it holds one); null
   * otherwise.
   */
  async function personOf(opened: FormsTable, view: SnapshotView, row: Row | null): Promise<{ person: ConsentPerson; address: string | null } | null> {
    if (row === null) return null;
    const declared = await peopleTablesOf(meta).of(opened.connectionId, view.model, opened.tableId);
    const table = view.table(opened.tableId);
    if (declared === null || declared.kind !== 'people' || table.primaryKey.length !== 1) return null;
    const held = declared.email === null ? null : row[declared.email];
    const address = typeof held === 'string' && looksLikeAddress(held) ? held : null;
    return { person: { connectionId: opened.connectionId, table: opened.tableId, key: String(row[table.primaryKey[0]!]) }, address };
  }

  /**
   * Whether the person or any of the addresses has said no to the purpose
   * (the log's latest word is "no"), or an address is on the do-not-email
   * list. A yes no confirm link proved never replaces either.
   */
  async function objected(person: ConsentPerson | null, addresses: readonly string[], purpose: FormTickPurpose): Promise<boolean> {
    for (const address of addresses.length === 0 ? [null] : addresses) {
      if ((await deps.consent.stateFor({ person, address }, purpose)).state === 'no') return true;
      if (address !== null && (await deps.consent.stop.entryFor(address)) !== null) return true;
    }
    return false;
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

    // A named survey's invitation, by the token its link carries: read here, spent with the answer.
    let invitation: OpenInvitation | null = null;
    if (isNamedSurvey(form)) {
      const found = await deps.invitations.find(live, body.t, at);
      if (found.state === 'already') return { status: 409, body: { state: 'already' } };
      if (found.state === 'dead') return { status: 410, body: { state: 'dead' } };
      invitation = found.invitation;
    }

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
    // A named survey that links answers to names keeps who it was sent to; one that does not keeps nobody.
    const linked = invitation !== null && keepsNames(form.settings);
    const invited = (column: 'email' | 'name'): string | null => {
      const value = linked ? invitation!.row[column] : null;
      return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
    };
    const email = checked.email ?? invited('email')?.toLowerCase() ?? null;
    const name = checked.name ?? invited('name');
    const files = filesOf(form, checked.values);
    /** What the answer's transaction did that outlives it: files attached in the store, and whether it committed. */
    const progress = { attached: [] as string[], committed: false };
    const answerValues = (row: { table: string; key: string } | null): Row => {
      const became = becameFor(answers.target.table, row);
      if (row !== null && became === null) request.log.warn({ form: live.id, table: row.table }, 'forms door: the row an answer became is named longer than its answers table holds; the answer keeps no link to it');
      return {
      [answers.pk]: answerId,
      form_id: live.id,
      submitted_at: new Date(at).toISOString(),
      language: body.language,
      values: checked.values,
      email,
      name,
      ...(linked && answers.target.table.columns.has(ANSWER_INVITATION_COLUMN) ? { [ANSWER_INVITATION_COLUMN]: invitation!.id } : {}),
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
      };
    };
    /**
     * The answer row, written by Adminium alone, on `db` (a transaction's,
     * beside the row it became): the invitation spent first, while still
     * unanswered; then the row; then its files attached, inside the same
     * transaction.
     */
    const writeAnswer = async (db: Kysely<SourceDatabase>, became: { table: string; key: string } | null): Promise<void> => {
      if (invitation !== null && !(await deps.invitations.spend(db, answers.target.dialect, invitation, at))) throw new InvitationSpent();
      const target = { ...answers.target, db };
      const context: WriteContext = { origin: 'public', hops: 0, actor: { kind: 'public', id: null, label: `Form: ${nameIn(form, body.language)}`.slice(0, 200) }, request: null };
      const verdict = await deps.writes.check('create', target, context, [answerValues(became)], { capacity: 'unchecked' });
      const good = verdict.rows[0];
      if (good === null || good === undefined) throw new Error(`the answers table refused an answer: ${JSON.stringify(verdict.issues[0] ?? {})}`);
      await insertRow(db, answers.target.dialect, answers.target.table, good);
      if (files.length > 0) {
        // Named before the attach: whatever happens from here on, a transaction that does not stand lets them go.
        progress.attached = files.flatMap((one) => [...one.ids]);
        // Every file taken for this form, from this address, unattached and in time: else nothing is attached.
        const taken = deps.files === undefined ? null : await deps.files.attachToAnswer({ live, ip: request.ip, answerKey: answerId, files, on: { db, dialect: answers.target.dialect } });
        if (taken === null) throw new FilesRefused();
      }
    };

    /** An answer that did not stand: the counts go back, its files are let go, and the stranger is told what they can act on. */
    const notKept = async (error: unknown): Promise<AnswerReply> => {
      await giveBack();
      if (progress.attached.length > 0 && !progress.committed) {
        await deps.files?.detachAnswer(live, answerId, progress.attached).catch((failure: unknown) => {
          request.log.warn({ err: failure, form: live.id }, 'forms door: an answer’s files could not be let go');
        });
      }
      if (error instanceof FilesRefused) return { status: 400, body: { state: 'refused', errors: Object.fromEntries(files.map((one) => [one.question, 'file'])) } };
      if (error instanceof InvitationSpent) return { status: 409, body: { state: 'already' } };
      throw error;
    };

    // 5 + 6. What the answer becomes, and the answer, together.
    const becomes = form.settings.becomes;
    let became: { opened: FormsTable; view: SnapshotView; row: Row } | null = null;
    if (becomes === null) {
      try {
        await deps.writes.transaction(answers.target, [], (tdb) => writeAnswer(tdb, null));
        progress.committed = true;
      } catch (error) {
        return notKept(error);
      }
    } else {
      let made: Awaited<ReturnType<typeof becomeRow>>;
      try {
        made = await becomeRow(request, live, checked, writeAnswer, body.language, at, invitation, () => {
          progress.committed = true;
        });
      } catch (error) {
        // Nothing was kept: the form's and the address's counts go back.
        return notKept(error);
      }
      if (made.state !== 'made') {
        await giveBack();
        if (made.state === 'limit') return tooMany(live, { ok: false, cap: 'entry', retryAfter: 3600, window: 'hour' }, at);
        if (made.state === 'already') return { status: 409, body: { state: 'already' } };
        if (made.state === 'refused') return { status: 400, body: { state: 'refused', errors: made.errors } };
        if (made.state === 'closed') return { status: 200, body: { state: 'closed' } };
        return { status: 404, body: { state: 'unavailable' } };
      }
      became = made;
    }

    // 7. The agreement.
    const hub = deps.hub?.();
    if (tick !== undefined && wording !== null) {
      /** The confirmation mail, to the address the answer keeps: the yes waits for its click. */
      const askToConfirm = async (to: string) => {
        const install = String((await settingsRepo(meta).get('system.instanceId')) ?? '');
        const token = makeConfirmToken(confirmSecret, install, { addOn: live.addOn, form: live.id, answer: answerId, purpose: tick.purpose, issuedAt: at, addressHash: confirmAddressHash(confirmSecret, to) });
        await sendConfirmMail({ meta, secret: deps.secret, caps, capKey: capSecret, to, language: body.language, name: checked.name, purpose: tick.purpose, token, at, logger: request.log }).catch((error: unknown) => {
          request.log.warn({ err: error, form: live.id }, 'forms door: the confirmation mail could not be queued');
        });
      };
      if (pending) {
        await askToConfirm(checked.email!);
      } else if (tick.confirm) {
        // A confirmation asked, and no address to send it to (the e-mail question left blank): nothing
        // could prove the yes, so none is written, for the address or for the row the answer became.
      } else {
        const who = became === null ? null : await personOf(became.opened, became.view, became.row);
        const person = who?.person ?? null;
        const addresses = [...new Set([checked.email, who?.address?.trim().toLowerCase() ?? null].filter((one): one is string => one !== null))];
        if (person !== null || checked.email !== null) {
          if (!(await objected(person, addresses, tick.purpose).catch(() => true))) {
            await deps.consent
              .record({ state: 'yes', person, address: checked.email, purpose: tick.purpose, source: 'form', detail: nameIn(form, form.definition.defaultLanguage).slice(0, 255), wording: { text: wording, version: String(tick.wordingVersion) }, ip, userAgent, at })
              .catch((error: unknown) => request.log.warn({ err: error, form: live.id }, 'forms door: the consent log did not take the yes'));
          } else if (checked.email !== null) {
            // A "no" (or a do-not-email entry) stands until a confirm link proves the new yes: the answer
            // waits for the click as one with confirmation asked does. Anyone could type the address, so
            // the stranger is told nothing different (the form's own ending), and the mail goes as the
            // confirmation mail does: once a day to an address at most.
            const { db } = answers.target;
            const moved = await db
              .updateTable(answers.target.table.id as never)
              .set({ confirm: 'pending' } as never)
              .where(sql.ref(answers.pk), '=', answerId)
              .where(sql.ref('confirm'), '=', 'none')
              .executeTakeFirst();
            if (Number(moved.numUpdatedRows) === 1) await askToConfirm(checked.email);
          }
          // Else a "no" stands and the answer names no address a confirmation could go to (only the
          // row it became holds one, from an answer that was not checked as an address): nothing about
          // consent is written, and the answer is kept as it is.
        }
      }
    }

    // 8. Staff.
    const tellWhen = form.settings.tellWhen;
    const lowEnough = tellWhen === undefined || (typeof checked.values[tellWhen.question] === 'number' && (checked.values[tellWhen.question] as number) <= tellWhen.atMost);
    if (form.settings.tell.length > 0 && lowEnough) {
      // Only those who may read this answer in the add-on's answers table now: the rest are skipped.
      const place: AnswersAt = { connectionId: live.connectionId, table: answers.target.table, model: answers.target.view.model, db: answers.target.db };
      const people = await answerReaders(meta, await toldBy(meta, form.settings.tell), place, { [answers.pk]: answerId });
      await tellStaff({
        meta,
        hub,
        people,
        formName: form.definition.title as Record<string, string>,
        questions: form.definition.questions,
        values: checked.values,
        language: body.language,
        actionUrl: formsStaffLink(live, 'answer', answerId),
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
    /** The record the invitation names has the one row its link column allows already (the job's feedback). */
    | { state: 'already' }
    | { state: 'unavailable' };

  /**
   * The row an answer becomes, through the app's own entry, and the answer
   * beside it in the same transaction. Anything the form's map cannot honour
   * (a table not opened to forms, a column the entry does not open, a link
   * column) is the form's fault, not the stranger's: "not available", logged.
   *
   * A named survey's invitation fills the link columns the entry opens that
   * point at the record the invitation names (the job a feedback row is
   * about), with that record's own key: never from a question, never from
   * the body. When such a column allows one row per record and the record
   * has its row already, the answer is "already answered", nothing written.
   */
  async function becomeRow(
    request: FastifyRequest,
    live: LiveForm,
    checked: Extract<CheckedAnswer, { ok: true }>,
    writeAnswer: (db: Kysely<SourceDatabase>, became: { table: string; key: string }) => Promise<void>,
    language: string,
    at: number,
    invitation: OpenInvitation | null,
    committed: () => void,
  ): Promise<Became> {
    const becomes = live.form.settings.becomes!;
    const broken = (why: string): Became => {
      request.log.warn({ form: live.id, addOn: live.addOn, table: becomes.table, why }, 'forms door: the form’s "becomes" cannot be honoured');
      return { state: 'unavailable' };
    };
    const scope = await deps.scopes.scopeFor(live.connectionId, live.addOn);
    const opened = openedTable(scope, becomes.table);
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
    // The link columns the invitation fills: those the entry opens, pointing at the record it names.
    const fromInvitation: Row = {};
    const record = invitation?.record ?? null;
    if (record !== null) {
      for (const relation of view.model.relations) {
        if (relation.from.tableId !== table.id || relation.through !== null || relation.to.tableId !== record.table.id || relation.from.columns.length !== 1) continue;
        const column = relation.from.columns[0]!;
        const value = record.row[relation.to.columns[0] ?? ''];
        if (!opened.resource.writable.has(column) || decided.has(column) || value === null || value === undefined) continue;
        fromInvitation[column] = value;
      }
    }
    // The map's columns from the answer, and the fixed source; a question not answered fills nothing.
    const raw: Row = {};
    const fedBy = new Map<string, string>();
    for (const [question, column] of Object.entries(becomes.map)) {
      fedBy.set(column, question);
      if (checked.values[question] !== undefined) raw[column] = columnValue(checked.values[question]);
    }
    if (becomes.source !== undefined) raw[becomes.source.column] = becomes.source.value;
    Object.assign(raw, fromInvitation);
    const { db, dialect } = await deps.data(opened.connectionId);
    // One row per record (a job's one feedback): a record that has its row already is answered already.
    for (const [column, value] of Object.entries(fromInvitation)) {
      if (!uniqueColumn(table, column)) continue;
      const taken = await db
        .selectFrom(table.id as never)
        .select(sql.ref(column).as('taken') as never)
        .where(sql.ref(column), '=', value as never)
        .limit(1)
        .executeTakeFirst();
      if (taken !== undefined) return { state: 'already' };
    }
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
            await writeAnswer(tdb, { table: installs.refOf(opened.connectionId, opened.tableId), key });
            return one;
          });
          committed();
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
