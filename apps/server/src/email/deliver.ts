// SPDX-License-Identifier: AGPL-3.0-only
/**
 * RENDER ONE MESSAGE AND HAND IT TO THE RELAY — the last few lines of every
 * send path, in one place (42-automations-and-workflow-logs.md D15, 42-T09).
 *
 * Two callers, and they arrived from different directions. The campaign
 * runner (39 D11) sends in-process, one recipient at a time, because a
 * campaign's report is "18,240 sent · 12 failed" and that count only exists
 * if the sender waited for each answer. The automation email step needs the
 * same thing for a different reason: Workflow Logs draws the SMTP reply as
 * the step's log line — "250 OK · delivered to jordan@acme.io" — and a queued
 * `email.send` job cannot produce that, because by the time the relay answers,
 * the run has long since finished.
 *
 * So both render here and both get the reply back.
 *
 * --- What is NOT here ------------------------------------------------------
 *
 * Attachment BYTES. The campaign runner resolves its parts once per language
 * variation and reuses them for ten thousand recipients; the automation step
 * resolves them once, full stop. Pulling that in would mean this module knew
 * about the file store, and the caller with the interesting caching would
 * have to bypass it anyway.
 *
 * Retries. The campaign runner retries once per recipient because a relay's
 * transient refusal must not cost an address; the automation step does not,
 * because a failed step is a red run an operator can see and re-trigger. Two
 * different right answers, so neither is baked in here.
 */

import { dirForLocale, isLocaleId } from '@adminium/i18n';

import { renderEmail } from './render.js';
import type { PreparedEmail } from './send.js';
import type { EmailTransport, OutboundAttachment } from './types.js';

export interface DeliverPreparedInput {
  transport: EmailTransport;
  /** From `prepareEmail` — the resolved document, sender and attachment refs. */
  prepared: PreparedEmail;
  /** The variation's own locale, which decides the rendered direction. */
  locale: string;
  to: string;
  /** `{{token}}` substitutions; escaped per context by the renderer. */
  vars: Record<string, string>;
  /** Inline images and attachments as bytes, resolved by the caller. */
  parts?: readonly OutboundAttachment[] | undefined;
}

export interface DeliverPreparedResult {
  /** The relay's reply line (`250 2.0.0 Ok`), when the transport reports one. */
  response: string | null;
  subject: string;
}

export async function deliverPrepared(
  input: DeliverPreparedInput,
): Promise<DeliverPreparedResult> {
  const rendered = renderEmail({
    ...input.prepared.render,
    locale: input.locale,
    vars: input.vars,
    dir: isLocaleId(input.locale) ? dirForLocale(input.locale) : 'ltr',
  });
  const parts = input.parts ?? [];
  const result = await input.transport.send({
    to: input.to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    ...(input.prepared.from === undefined ? {} : { from: input.prepared.from }),
    ...(parts.length === 0 ? {} : { attachments: [...parts] }),
  });
  return {
    response: result?.response ?? null,
    subject: rendered.subject,
  };
}
