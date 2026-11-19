// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A STRANGER'S PAGE ASKS FOR, AND WHAT ITS POLICY REFUSES.
 *
 * Every `/x/` page (a form, a chat's window, a landing page) answers with a
 * policy that lets its scripts call only `/x/` on its own host, and writes no
 * markup into the page (Trusted Types with no policy at all;
 * `apps/server/src/routes/x-door/headers.ts`). A spec watches a page with
 * {@link watchXPolicy} and checks, at its end, that no request of an `/x/`
 * frame left `/x/` (a call that did would be refused by that policy, and the
 * page would break) and that the browser refused nothing.
 */
import type { Page, Request } from '@playwright/test';

/** Whether a URL is under a `/x/` door. */
function underX(url: string): boolean {
  try {
    return new URL(url).pathname.startsWith('/x/');
  } catch {
    return false;
  }
}

/** The frame a request was made from, when it has one (a navigation of a new page has none yet). */
function frameUrl(request: Request): string | null {
  try {
    return request.frame().url();
  } catch {
    return null;
  }
}

export interface XPolicyWatch {
  /** The requests an `/x/` page made outside `/x/` on its own host, or to another host. */
  outside(): string[];
  /** What the browser said it refused, or the errors a refused write threw. */
  refused(): string[];
}

/** Watch every frame of `page`: the `/x/` ones' requests, and every refusal of a policy. */
export function watchXPolicy(page: Page): XPolicyWatch {
  const outside: string[] = [];
  const refused: string[] = [];
  page.on('request', (request) => {
    const from = frameUrl(request);
    if (from === null || !underX(from)) return;
    // A page's own navigation is its address; every other request of it must stay under /x/ on its own origin.
    if (request.isNavigationRequest()) return;
    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    if (!underX(url) || new URL(url).origin !== new URL(from).origin) outside.push(`${request.method()} ${url} (from ${from})`);
  });
  page.on('console', (message) => {
    if (/Content Security Policy|Trusted ?Types?|TrustedHTML|TrustedScript|Refused to|require-trusted-types/i.test(message.text())) refused.push(message.text());
  });
  page.on('pageerror', (error) => {
    if (/Trusted|TrustedHTML|TrustedScript/i.test(error.message)) refused.push(error.message);
  });
  return { outside: () => [...outside], refused: () => [...refused] };
}
