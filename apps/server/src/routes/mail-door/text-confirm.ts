// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE MARKETING TEXT CONFIRM PAGE: where a person confirms, from the link in
 * the mail that asked them (`sms/marketing/confirm.ts`), that a business may
 * send them offers by text. Double opt-in, for the countries that expect it.
 * Beside the unsubscribe page in the mail door, and kept by its rules
 * (`index.ts`): open only while the outside can reach this server; no script;
 * nothing cached; no session read.
 *
 *   GET  /m/t/<token>   the masked number and one Confirm button: never acts on its own
 *   POST /m/t/<token>   the button (`act=confirm`): confirms
 *
 * The other answers: "You've already confirmed"; "This can't be confirmed any
 * more" (the yes was withdrawn, the number stopped or changed); "This link is
 * too old"; "This link doesn't work" (not this install's, or changed by one
 * byte). The page never shows the whole number and never asks the person to
 * reply to a text.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { auditExempt } from '../../audit/coverage.js';
import { AddressKeysLockedError } from '../../consent/index.js';
import type { UnsubscribeClaim } from '../../email/unsubscribe-token.js';
import { MAIL_DOOR_PREFIX } from '../../plugins/surfaces.js';
import { tagRoutes } from '../../security/route-audience.js';
import type { TextConfirm } from '../../sms/marketing/confirm.js';
import { TEXT_CONFIRM_PATH } from '../../sms/marketing/confirm-token.js';
import { createMailDoor, type MailDoorDeps } from './door.js';
import { escapeHtml, renderMailDoorPage, statusCard, type MailDoorBusiness, type MailDoorView, type Translate } from './page.js';

const FORM_BODY_LIMIT = 1024;
const tokenParams = z.object({ '*': z.string().max(4096) });
const tokenOf = (params: { '*': string }): string => (params['*'].includes('/') ? '' : params['*']);

export interface TextConfirmDoorDeps extends MailDoorDeps {
  texts: TextConfirm;
}

type PageView = { kind: 'ask'; phone: string | null; action: string } | { kind: 'done' } | { kind: 'already' } | { kind: 'withdrawn' } | { kind: 'too-old' } | { kind: 'dead' };

export function textConfirmDoorRoutes(deps: TextConfirmDoorDeps): FastifyPluginAsyncZod {
  const door = createMailDoor(deps);

  function actionOf(request: FastifyRequest): string {
    const lang = (request.query as { lang?: unknown } | undefined)?.lang;
    return `${MAIL_DOOR_PREFIX}/t/${tokenOf(request.params as { '*': string })}${typeof lang === 'string' && /^[a-z]{2}-[A-Z]{2}$/.test(lang) ? `?lang=${lang}` : ''}`;
  }

  function mainOf(t: Translate, business: MailDoorBusiness, view: PageView): string {
    const named = { business: business.name };
    switch (view.kind) {
      case 'ask': {
        const title = escapeHtml(t('mailDoor:textConfirm.title', 'Get offers from {business} by text?', named));
        const line = escapeHtml(t('mailDoor:textConfirm.line', 'Press Confirm, and {business} may send you offers by text at this number. You can reply STOP to any of them to stop.', named));
        const phone = view.phone === null ? '' : `<bdi dir="ltr" class="mono addr">${escapeHtml(view.phone)}</bdi>`;
        return (
          `<section class="card"><h1 class="title">${title}</h1>${phone}<p class="note">${line}</p>` +
          `<form method="post" action="${escapeHtml(view.action)}"><div class="buttons"><button type="submit" name="act" value="confirm" class="primary">${escapeHtml(t('mailDoor:textConfirm.button', 'Confirm'))}</button></div></form></section>`
        );
      }
      case 'done':
        return statusCard('positive', 'circleCheck', t('mailDoor:textConfirm.done', 'Confirmed. {business} may now send you offers by text.', named), [escapeHtml(t('mailDoor:textConfirm.stop', 'Reply STOP to any of them, and they stop.'))], null, null);
      case 'already':
        return statusCard('neutral', 'circleCheck', t('mailDoor:textConfirm.already', 'You’ve already confirmed.'), [], null, null);
      case 'withdrawn':
        return statusCard('neutral', 'link2Off', t('mailDoor:textConfirm.withdrawn', 'This can’t be confirmed any more.'), [escapeHtml(t('mailDoor:textConfirm.withdrawnLine', 'You’ll get no offers by text from {business} unless you agree again.', named))], null, business.email);
      case 'too-old':
        return statusCard('neutral', 'link2Off', t('mailDoor:textConfirm.tooOld', 'This link is too old.'), [escapeHtml(t('mailDoor:textConfirm.withdrawnLine', 'You’ll get no offers by text from {business} unless you agree again.', named))], null, business.email);
      case 'dead': {
        const title = business.email === null ? t('mailDoor:object.deadAsk', 'This link doesn’t work. Write to {business}.', named) : t('mailDoor:object.dead', 'This link doesn’t work. Write to {email}.', { email: business.email });
        return statusCard('neutral', 'link2Off', title, [], null, null);
      }
    }
  }

  async function send(request: FastifyRequest, reply: FastifyReply, view: PageView | { kind: 'unavailable' }, status: number, language: string | null): Promise<FastifyReply> {
    const locale = await door.language(request, language === null ? null : ({ language: language.replace('-', '_') } as UnsubscribeClaim));
    const { t, lang } = await door.translator(locale);
    const business = await door.business();
    const page: MailDoorView = view.kind === 'unavailable' ? { kind: 'unavailable' } : { kind: 'own', main: mainOf(t, business, view) };
    const path = request.url.split('?')[0] ?? request.url;
    const { html, policy } = renderMailDoorPage({ view: page, business, lang, accent: await door.accent(), path, t });
    return reply
      .code(status)
      .header('content-type', 'text/html; charset=utf-8')
      .header('content-security-policy', policy)
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .header('x-robots-tag', 'noindex')
      .send(html);
  }

  async function guarded(request: FastifyRequest, reply: FastifyReply, work: () => Promise<FastifyReply>): Promise<FastifyReply> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof AddressKeysLockedError) {
        request.log.error({ err: error }, 'text confirm page: the address keys cannot be read with this server’s secret');
        return send(request, reply, { kind: 'unavailable' }, 503, null);
      }
      throw error;
    }
  }

  /** What a link shows as it stands: the GET, and a POST with nothing left to do. */
  async function page(request: FastifyRequest, reply: FastifyReply, token: string): Promise<FastifyReply> {
    const { state } = await deps.texts.read(token);
    switch (state.state) {
      case 'dead':
        return send(request, reply, { kind: 'dead' }, 404, null);
      case 'too-old':
        return send(request, reply, { kind: 'too-old' }, 200, null);
      case 'already':
        return send(request, reply, { kind: 'already' }, 200, null);
      case 'withdrawn':
        return send(request, reply, { kind: 'withdrawn' }, 200, null);
      case 'waiting':
        return send(request, reply, { kind: 'ask', phone: state.phone, action: actionOf(request) }, 200, state.language);
    }
  }

  return async (app) => {
    tagRoutes(app, 'public');
    app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: FORM_BODY_LIMIT }, (_request, body, done) => {
      const fields: Record<string, string> = {};
      for (const [name, value] of new URLSearchParams(typeof body === 'string' ? body : body.toString('utf8'))) if (!(name in fields)) fields[name] = value;
      done(null, fields);
    });

    // A GET never acts: a link scanner opening the mail confirms nobody.
    app.get(`${TEXT_CONFIRM_PATH}*`, { config: { rateLimitBucket: 'mail-door-page' }, schema: { hide: true, params: tokenParams } }, async (request, reply) =>
      guarded(request, reply, async () => {
        if (!(await door.reachable())) return send(request, reply, { kind: 'unavailable' }, 404, null);
        return page(request, reply, tokenOf(request.params));
      }),
    );

    app.post(
      `${TEXT_CONFIRM_PATH}*`,
      {
        config: {
          rateLimitBucket: 'mail-door-act',
          csrf: 'exempt',
          audit: auditExempt('a person confirming marketing texts through a mail’s link: the consent log row is the record'),
        },
        schema: { hide: true, params: tokenParams },
      },
      async (request, reply) =>
        guarded(request, reply, async () => {
          if (!(await door.reachable())) return send(request, reply, { kind: 'unavailable' }, 404, null);
          const token = tokenOf(request.params);
          // Only the page's own button confirms.
          if ((request.body as Record<string, string> | undefined)?.['act'] !== 'confirm') return page(request, reply, token);
          const userAgent = request.headers['user-agent'];
          const done = await deps.texts.confirmByLink(token, { ip: request.ip === '' ? null : request.ip, userAgent: typeof userAgent === 'string' ? userAgent : null });
          if (done.state === 'done') return send(request, reply, { kind: 'done' }, 200, done.language);
          return page(request, reply, token);
        }),
    );
  };
}
