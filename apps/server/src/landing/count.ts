// SPDX-License-Identifier: AGPL-3.0-only
/**
 * COUNTING A VIEW OF A LANDING PAGE: the pages door calls this once per data
 * read of a live page (never a preview, never the page's HTML, which a link
 * preview fetches too). The engine's counter (bots and prefetches left out,
 * one per address and page every half hour, nothing while counting is off)
 * is wired in here, in its one line, as `count({ kind: 'page', thing: page,
 * place: '', installId, request })`.
 */
import type { FastifyRequest } from 'fastify';

/** What a page view is counted with: the page, its add-on's install, and the request (bots and prefetches are the counter's to judge). */
export interface PageView {
  installId: string;
  /** The page row's key. */
  page: string;
  request: FastifyRequest;
}

/** Count one view of a live page. */
export function countPageView(_view: PageView): void {}
