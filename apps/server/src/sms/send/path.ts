// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE TEXT SEND PATH: what a caller uses to send one text.
 *
 *   prepare   the text step. Reads no row and writes nothing: phone, consent,
 *             stop list, final words and length, send window, the day's limit
 *   queue     after the source row is claimed: one delivery record, one sealed job
 *   handOver  the `sms.send` job (see `handover.ts`)
 *
 * It takes plain inputs, so an outbox row and an automation step reach it the
 * same way.
 *
 * A shut send window always holds the job in the queue. There is deliberately
 * no answer that asks a caller to re-date its row: an outbox reminder is
 * recognised by its due column, so rewriting that column would queue another
 * reminder on every scan.
 */
import { createHmac } from 'node:crypto';

import type { AddressHash, ConsentPerson, MetaDb } from '@adminium/meta';

import { addressKeyRing } from '../../consent/keys.js';
import { parsePhone } from '../../phone/index.js';
import { maskPhone } from '../consent/redact.js';
import { textSubject } from '../consent/service.js';
import type { TextClass, TextRefusal } from '../consent/types.js';
import type { SmsStopConfirmation } from '../inbound/stop-reply.js';
import { TEXT_MARKETING_AVAILABLE } from '../marketing/availability.js';
import type { SmsService } from '../service.js';
import type { SmsSender } from '../types.js';
import { composeText } from './compose.js';
import { createStopConfirmer, type StopConfirmOutcome } from './confirm-stop.js';
import { createHandOver, tellSource, type HandOverDeps, type TextLimitWarning } from './handover.js';
import { sealText, SMS_SEND_ATTEMPTS, SMS_SEND_JOB_KIND, type SmsSendPayload } from './job.js';
import type { TextEstimate } from './length.js';
import type { BusinessContact } from './opt-out.js';
import { dayKey, readTextPolicy, warningAt } from './policy.js';
import type { TextReport } from './store.js';
import { TEXT_OPEN_STATES, type SealedText, type TextAbout, type TextDelivery, type TextPrepareSkipReason, type TextSendReport, type TextTiming } from './types.js';
import { judgeWindow } from './window.js';

/** How a number is hashed for the delivery record: the same keyed hash as the stop list's. */
export interface TextPhoneKeys {
  forWrite(e164: string): Promise<AddressHash>;
  all(e164: string): Promise<AddressHash[]>;
}

export function textPhoneKeys(meta: MetaDb, secret: string): TextPhoneKeys {
  const ring = addressKeyRing(meta, secret);
  return {
    forWrite: (e164) => ring.hashForWrite(textSubject(e164)),
    all: (e164) => ring.hashesOf(textSubject(e164)),
  };
}

export interface TextSendDeps extends HandOverDeps {
  sms: HandOverDeps['sms'] & Pick<SmsService, 'view'>;
  phoneKeys: TextPhoneKeys;
}

export interface TextPrepareInput {
  /** As held: any value, because old rows may hold anything. */
  phone: unknown;
  /** The business's country, to read a local number in. The account's when absent. */
  country?: string | null | undefined;
  textClass: TextClass;
  /** `waiting` only for a kind the customer is waiting for right now. Marketing is always timed as marketing. */
  waiting?: boolean | undefined;
  template: string;
  values: Readonly<Record<string, string>>;
  /** Columns the app declares as codes. */
  codeNames?: readonly string[] | undefined;
  /** The business's clock. */
  zone: string | null;
  /** The moment the text is about, such as the visit. It is never sent after this. */
  notAfter?: number | null | undefined;
  business: BusinessContact;
  /** A workspace's own sender; the account's when absent. */
  sender?: SmsSender | undefined;
  person?: ConsentPerson | null | undefined;
  /**
   * The person texted this business a moment ago, and this service text answers
   * them (`TextRequest.answering`). The stop list still refuses it.
   */
  answering?: boolean | undefined;
}

export type TextPrepared =
  /** `opensAt`: the window is shut, so the job is held in the queue until then. The source row's own dates are never touched. */
  | { action: 'send'; text: SealedText; estimate: TextEstimate; opensAt: number | null }
  | { action: 'skip'; reason: TextPrepareSkipReason; phoneReason?: string | undefined }
  /** The stop list or the settings could not be read: it does not go, and may be queued again. */
  | { action: 'fail'; reason: 'could-not-check' };

export interface TextQueueInput {
  /** The message: stable across re-queues, e.g. `app-outbox:<app>:<table>:<pk>`. */
  messageKey: string;
  /** This one claim of it. */
  claimKey: string;
  report?: TextSendReport | undefined;
  /** The app that sends it, and its template: what the conversation with the number shows of it. */
  about?: TextAbout | null | undefined;
}

export type TextQueued =
  | { queued: true; deliveryId: string }
  /** `earlier-send-open`: another delivery of this message is queued, in flight or unknown. Nothing new was queued. */
  | { queued: false; reason: 'could-not-queue' | 'earlier-send-open' };

export interface TextUsage extends TextLimitWarning {
  warning: boolean;
}

export interface TextSendPath {
  prepare(input: TextPrepareInput): Promise<TextPrepared>;
  queue(text: Extract<TextPrepared, { action: 'send' }>, where: TextQueueInput): Promise<TextQueued>;
  handOver: ReturnType<typeof createHandOver>;
  /** Today's count, on the server's one day zone. */
  usage(): Promise<TextUsage>;
  delivery(id: string): Promise<TextDelivery | null>;
  /** A provider's delivery report, in the provider's own words. Null when no delivery has that id. A change of state reaches the source row. */
  applyReport(report: TextReport): Promise<TextDelivery | null>;
  /** The one fixed confirmation of a STOP. Nothing else can go to a stopped number. */
  confirmStop(request: SmsStopConfirmation): Promise<StopConfirmOutcome>;
  /** A person checked an `unknown` at the provider. Clears the block on sending that message again. */
  resolveUnknown(id: string, to: 'checked-went' | 'checked-not-sent'): Promise<TextDelivery | null>;
  /** Ends what nothing will come back for, and retries telling source rows what they are owed. */
  settleAbandoned(before: number): Promise<number>;
  /** The erasure: every delivery record of this number, and the sealed number and words in their jobs. */
  eraseFor(phone: unknown, country: string | null): Promise<number>;
}

/** Source rows told in one sweep. */
const OWED_BATCH = 200;

export function createTextSendPath(deps: TextSendDeps): TextSendPath {
  const now = deps.now ?? Date.now;
  const { store, consent } = deps;
  const handOver = createHandOver(deps);
  const confirmStop = createStopConfirmer(deps);
  const keyed = (purpose: string, value: string): string => createHmac('sha256', deps.secret).update(`adminium:text-delivery:${purpose}:${value}`).digest('hex');

  async function prepare(input: TextPrepareInput): Promise<TextPrepared> {
    if (!deps.operatorAllows()) return { action: 'skip', reason: 'off-by-operator' };
    // Whoever asks: a run, an app's outbox kind, a rule's step. The hand-over asks again.
    if (input.textClass === 'marketing' && !TEXT_MARKETING_AVAILABLE) return { action: 'skip', reason: 'marketing-not-yet-available' };
    const view = await deps.sms.view();
    if (view === null || !view.keyReadable) return { action: 'skip', reason: 'not-connected' };
    const sender = input.sender ?? view.sender;
    if (sender === null) return { action: 'skip', reason: 'no-sender' };
    const country = input.country ?? view.defaultCountry;

    let decision;
    let policy;
    try {
      decision = await consent.decide({
        phone: input.phone,
        country,
        class: input.textClass,
        sender: { kind: sender.kind === 'number' ? 'number' : 'name' },
        repliesReachUs: await deps.repliesReachUs(),
        person: input.person ?? null,
        answering: input.answering === true,
      });
      policy = readTextPolicy(await deps.policy());
    } catch {
      return { action: 'fail', reason: 'could-not-check' };
    }
    if (!decision.send) {
      const refusal: TextRefusal = decision.reason;
      return { action: 'skip', reason: refusal, ...(decision.phoneReason === undefined ? {} : { phoneReason: decision.phoneReason }) };
    }

    const composed = composeText({ template: input.template, values: input.values, codeNames: input.codeNames, optOut: decision.optOut, country: decision.country, sender, business: input.business });
    if (!composed.ok) return { action: 'skip', reason: composed.reason };

    const timing: TextTiming = input.textClass === 'marketing' ? 'marketing' : input.waiting === true ? 'waiting' : 'service';
    const notAfter = input.notAfter ?? null;
    const at = now();
    const verdict = judgeWindow({ timing, at, zone: input.zone, country: decision.country, serviceHours: policy.serviceHours, notAfter });
    if (!verdict.go && 'skip' in verdict) return { action: 'skip', reason: verdict.skip };
    const opensAt = verdict.go ? null : verdict.until;

    // A look, to spare a claim, at the day it would go. The slot itself is taken at the hand-over.
    if ((await store.usedOn(dayKey(opensAt ?? at, policy.dayZone))) >= policy.dailyLimit) return { action: 'skip', reason: 'daily-limit' };

    return {
      action: 'send',
      opensAt,
      estimate: composed.estimate,
      text: {
        to: decision.e164,
        body: composed.body,
        textClass: input.textClass,
        timing,
        country: decision.country,
        zone: input.zone,
        notAfter,
        sender,
        // The account's own sender, not a line or a workspace's: the hand-over checks it is still the account's.
        accountSender: input.sender === undefined,
        optOut: decision.optOut,
        person: input.person ?? null,
        ...(input.answering === true ? { answering: true } : {}),
      },
    };
  }

  async function queue(ready: Extract<TextPrepared, { action: 'send' }>, where: TextQueueInput): Promise<TextQueued> {
    const at = now();
    const { row } = await store.create({
      reportTarget: where.report ?? null,
      about: where.about ?? null,
      claimHash: keyed('claim', `${where.messageKey}\u0000${where.claimKey}`),
      messageHash: keyed('message', where.messageKey),
      phone: await deps.phoneKeys.forWrite(ready.text.to),
      phoneMasked: maskPhone(ready.text.to),
      textClass: ready.text.textClass,
      estimatedSegments: ready.estimate.segments,
      encoding: ready.estimate.encoding,
      createdAt: at,
    });
    if (row === null) return { queued: false, reason: 'earlier-send-open' };
    if (!TEXT_OPEN_STATES.includes(row.state)) return { queued: true, deliveryId: row.id };
    const payload: SmsSendPayload = { v: 1, deliveryId: row.id, envelope: sealText(ready.text, deps.secret) };
    try {
      await deps.enqueue({ kind: SMS_SEND_JOB_KIND, payload, maxAttempts: SMS_SEND_ATTEMPTS, dedupeKey: `${SMS_SEND_JOB_KIND}:${row.id}`, ...(ready.opensAt === null ? {} : { runAt: ready.opensAt }) });
    } catch {
      await store.settle(row.id, row.version, { state: 'not-sent', reason: 'could-not-queue', at: now(), releaseSlot: true });
      return { queued: false, reason: 'could-not-queue' };
    }
    return { queued: true, deliveryId: row.id };
  }

  return {
    prepare,
    queue,
    handOver,

    async usage() {
      const policy = readTextPolicy(await deps.policy());
      const day = dayKey(now(), policy.dayZone);
      const used = await store.usedOn(day);
      return { day, used, limit: policy.dailyLimit, warning: used >= warningAt(policy.dailyLimit) };
    },

    delivery: (id) => store.byId(id),
    confirmStop,

    async applyReport(report) {
      const row = await store.applyReport(report);
      if (row !== null) await tellSource(deps, row);
      return row;
    },

    async resolveUnknown(id, to) {
      const row = await store.resolveUnknown(id, to, now());
      if (row !== null) await tellSource(deps, row);
      return row;
    },

    async settleAbandoned(before) {
      const ended = await store.settleAbandoned(before, now());
      for (const row of await store.owedSettlements(OWED_BATCH)) await tellSource(deps, row);
      // A job that died before it could blank its own envelope, whose delivery has since ended.
      await store.forgetEndedSealed(OWED_BATCH);
      return ended;
    },

    async eraseFor(phone, country) {
      const parsed = parsePhone(phone, country);
      const e164 = parsed.ok ? parsed.e164 : typeof phone === 'string' && /^\+[1-9][0-9]{6,14}$/.test(phone) ? phone : null;
      return e164 === null ? 0 : store.eraseFor(await deps.phoneKeys.all(e164));
    },
  };
}
