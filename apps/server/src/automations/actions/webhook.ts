// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CALL WEBHOOK, and the Slack preset over it (42-automations-and-workflow-
 * logs.md D19, D10, 42-T10).
 *
 * --- Why "Slack message" is this action and not another one ---------------
 *
 * The comp's picker offers both. A Slack incoming webhook IS an HTTPS POST of
 * `{ "text": "…" }` to a `hooks.slack.com` URL, so building a second action
 * for it would mean a second outbound HTTP path to keep safe. It is a body
 * shape and a host check instead — the operator still sees "Slack message"
 * with its own icon and its own two fields, because that is what they are
 * doing; the product just does not pretend it is a different mechanism.
 *
 * --- The URL is guarded TWICE ---------------------------------------------
 *
 * Once when the rule is saved, so a bad URL is a 422 an operator can fix, and
 * again here, immediately before the request. Both, because a hostname that
 * resolved to a public address at save time can resolve to 169.254.169.254 an
 * hour later — DNS rebinding is the whole reason the second check exists.
 *
 * --- No retries, and a small answer ---------------------------------------
 *
 * A non-2xx is a step failure, full stop (this wave; retries with backoff and
 * a signing secret are a residual). The response body is read to a cap and
 * only its first 200 characters reach the trace: the trace is stored, and an
 * endpoint that answers with a megabyte of HTML must not put a megabyte of
 * HTML in the meta store.
 *
 * The header VALUE is a secret at rest and never appears in the audit row or
 * the trace — the host does, because "which endpoint did this rule call" is
 * the question an audit log exists to answer.
 */

import type { AutomationAction } from '@adminium/meta';

import { decryptSecret, deriveKey, isEncryptedSecret } from '../../config/secrets.js';
import { guardOutboundUrl } from '../../connections/dsn.js';
import { substitute } from '../templating.js';
import { ActionFailure, type ActionContext, type ActionResult } from './types.js';

type WebhookAction = Extract<AutomationAction, { kind: 'webhook' }>;

/** Salt for a webhook header value; distinct from the email and DSN keys. */
const WEBHOOK_KEY_SALT = 'adminium:automation:webhook';

export function webhookSecretKey(masterSecret: string): Buffer {
  return deriveKey(masterSecret, WEBHOOK_KEY_SALT);
}

/** A Slack incoming webhook, and nothing that merely looks like one. */
export function isSlackWebhookUrl(raw: string): boolean {
  try {
    return new URL(raw).hostname.toLowerCase() === 'hooks.slack.com';
  } catch {
    return false;
  }
}

/** 30 s, matching the add-on egress client's ceiling. */
export const WEBHOOK_TIMEOUT_MS = 30_000;
/** Response bytes read before the connection is dropped. */
export const WEBHOOK_BODY_CAP = 64 * 1024;
/** Characters of the body kept in the trace. */
const TRACE_BODY_CHARS = 200;

export interface WebhookRequestPlan {
  url: string;
  method: 'POST' | 'PUT';
  headers: Record<string, string>;
  body: string;
}

/** Everything resolved and checked, one line short of the send (D14). */
export function planWebhook(action: WebhookAction, ctx: ActionContext): WebhookRequestPlan {
  if (action.url === null || action.url.trim() === '') {
    throw new ActionFailure('This step has no URL.');
  }
  const url = substitute(action.url.trim(), ctx.tokens);
  guardOutboundUrl(url, { blockLoopback: process.env['NODE_ENV'] === 'production' });
  if (action.bodyKind === 'slack' && !isSlackWebhookUrl(url)) {
    throw new ActionFailure('A Slack message needs a hooks.slack.com webhook URL.');
  }
  if (process.env['NODE_ENV'] === 'production' && !url.toLowerCase().startsWith('https://')) {
    throw new ActionFailure('Webhooks must use https.');
  }

  const headers: Record<string, string> = {};
  let body: string;
  if (action.bodyKind === 'slack') {
    headers['content-type'] = 'application/json';
    body = JSON.stringify({ text: substitute(action.body ?? '', ctx.tokens) });
  } else if (action.bodyKind === 'text') {
    headers['content-type'] = 'text/plain; charset=utf-8';
    body = substitute(action.body ?? '', ctx.tokens);
  } else {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(defaultJsonBody(ctx));
  }

  if (action.headerName !== null && action.headerName.trim() !== '') {
    const stored = action.headerValueEncrypted;
    const value =
      stored === null
        ? ''
        : isEncryptedSecret(stored)
          ? decryptSecret(stored, webhookSecretKey(ctx.secret))
          : stored;
    headers[action.headerName.trim()] = value;
  }
  return { url, method: action.method, headers, body };
}

/** The documented default payload (D19) — masked, because a webhook is outbound. */
function defaultJsonBody(ctx: ActionContext): Record<string, unknown> {
  return {
    event: 'automation.run',
    rule: { id: ctx.rule.id, name: ctx.rule.name },
    record:
      ctx.source === null
        ? null
        : { table: ctx.source.table.id, pk: ctx.source.record.pk, label: ctx.source.record.label },
    occurredAt: new Date(ctx.now).toISOString(),
  };
}

/** `POST /hooks/abc` — what the trace shows instead of the full URL. */
function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname === '' ? '/' : parsed.pathname;
  } catch {
    return url;
  }
}

export async function runWebhookAction(
  action: WebhookAction,
  ctx: ActionContext,
): Promise<ActionResult> {
  const plan = planWebhook(action, ctx);
  const send = ctx.fetch ?? globalThis.fetch;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, WEBHOOK_TIMEOUT_MS);

  let response: Response;
  try {
    response = await send(plan.url, {
      method: plan.method,
      headers: plan.headers,
      body: plan.body,
      signal: controller.signal,
      redirect: 'manual',
    });
  } catch (error) {
    throw new ActionFailure(
      controller.signal.aborted
        ? `${plan.method} ${pathOf(plan.url)} → timed out after 30s`
        : `${plan.method} ${pathOf(plan.url)} → ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  const ms = Date.now() - startedAt;
  if (!response.ok) {
    const detail = (await readCapped(response)).slice(0, TRACE_BODY_CHARS);
    throw new ActionFailure(
      `${ctx.text.hookFail(plan.method, pathOf(plan.url), String(response.status))}${
        detail === '' ? '' : ` · ${detail}`
      }`,
    );
  }
  return { log: ctx.text.hookOk(plan.method, pathOf(plan.url), response.status, ms) };
}

export function dryRunWebhookAction(action: WebhookAction, ctx: ActionContext): ActionResult {
  const plan = planWebhook(action, ctx);
  return { log: ctx.text.hookWould(plan.method, plan.url) };
}

async function readCapped(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, WEBHOOK_BODY_CAP).trim().replaceAll(/\s+/g, ' ');
  } catch {
    return '';
  }
}
