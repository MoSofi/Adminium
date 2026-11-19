// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A landing page, read whole, and what the engine and the add-on read of it.
 *
 * `parseLandingPage` is read at both ends: the engine's publish seal refuses
 * a published copy it does not take, and the door draws nothing for one
 * ("not available"). A column's value is taken as stored: an object (Postgres
 * and MySQL hand JSON back parsed) or its text (SQLite hands it back as
 * written).
 *
 * Pure: no I/O.
 */
import type { z } from 'zod';

import { landingPageSchema, type LandingBlock, type LandingBlockOf, type LandingLink, type LandingPage } from './document.js';

export interface LandingIssue {
  /** Where in the document. */
  path: (string | number)[];
  /** What: one of the vocabulary's codes (`LANDING_DOCUMENT_CODES`), `not-json`, or Zod's own. */
  code: string;
}

export type ParsedLandingPage = { ok: true; page: LandingPage } | { ok: false; issues: LandingIssue[] };

function issuesOf(error: z.ZodError): LandingIssue[] {
  return error.issues.map((issue) => {
    const own = (issue as { params?: { code?: unknown } }).params?.code;
    return { path: issue.path.map((part) => (typeof part === 'symbol' ? String(part) : part)), code: issue.code === 'custom' && typeof own === 'string' ? own : issue.code };
  });
}

/** A page document as stored, read whole: the page, or every reason it is not one. */
export function parseLandingPage(json: unknown): ParsedLandingPage {
  let value = json;
  if (typeof json === 'string') {
    try {
      value = JSON.parse(json) as unknown;
    } catch {
      return { ok: false, issues: [{ path: [], code: 'not-json' }] };
    }
  }
  const parsed = landingPageSchema.safeParse(value);
  return parsed.success ? { ok: true, page: parsed.data } : { ok: false, issues: issuesOf(parsed.error) };
}

/** Whether any block still carries the assistant's mark: such a page is never published. */
export function hasMiloMarks(page: LandingPage): boolean {
  return page.blocks.some((block) => block.milo === true);
}

/** The page with every mark taken off, as a person who looked at each block leaves it. */
export function stripMiloMarks(page: LandingPage): LandingPage {
  return {
    ...page,
    blocks: page.blocks.map((block) => {
      if (block.milo === undefined) return block;
      const { milo: _milo, ...rest } = block;
      return rest as LandingBlock;
    }),
  };
}

/** Every file the page names, once each, in page order: its sharing picture first. */
export function pagePictures(page: LandingPage): string[] {
  const files: string[] = [];
  const add = (file: string | undefined) => {
    if (file !== undefined && !files.includes(file)) files.push(file);
  };
  add(page.picture?.file);
  for (const block of page.blocks) {
    if (block.kind === 'hero') add(block.picture?.file);
    if (block.kind === 'picture') add(block.picture.file);
    if (block.kind === 'columns') for (const one of block.columns) add(one.picture?.file);
  }
  return files;
}

/** Every link the page holds, in page order, with the block it is on. */
export function pageLinks(page: LandingPage): { block: string; link: LandingLink }[] {
  const links: { block: string; link: LandingLink }[] = [];
  for (const block of page.blocks) {
    if (block.kind === 'hero' && block.button !== undefined) links.push({ block: block.id, link: block.button.link });
    if (block.kind === 'button') links.push({ block: block.id, link: block.link });
  }
  return links;
}

/** The Form blocks of a page, in page order. */
export function formBlocksOf(page: LandingPage): LandingBlockOf<'form'>[] {
  return page.blocks.filter((block): block is LandingBlockOf<'form'> => block.kind === 'form');
}

// The main heading is read by the renderer too, which must not load the schemas: it lives on its own.
export { mainHeadingOf } from './headings.js';
