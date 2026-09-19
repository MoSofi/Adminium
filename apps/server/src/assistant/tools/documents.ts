// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The document tools: what this page already holds, and what one of its
 * documents says.
 *
 * All three read the page's OWN collection and nothing else — an assistant
 * opened on email templates cannot read invoices through here. The context
 * decides which collection that is; this file decides what a listing looks
 * like and how much of it travels.
 */

import {
  emailTemplatesRepo,
  invoiceDocumentsRepo,
  reportDocumentsRepo,
  type AssistantContextKey,
} from '@adminium/meta';

import { normalizeDocument } from '../../email/document.js';
import { starterCards as emailStarterCards } from '../../email/starters.js';
import { starterCards as invoiceStarterCards } from '../../invoices/starters.js';
import { starterCards as reportStarterCards } from '../../report-documents/starters.js';
import type { AssistantTool, AssistantToolDeps } from '../types.js';

/** Documents one listing may carry. Past this a page is a search problem, not a prompt. */
export const DOCUMENT_LIST_MAX = 100;

/** One document, as the model is shown it. */
interface DocumentSummary {
  id: string;
  name: string;
  kind: string;
  status: string;
  locale?: string;
  updatedAt: number;
}

async function listDocuments(
  deps: AssistantToolDeps,
  kind: string | undefined,
): Promise<DocumentSummary[]> {
  const context: AssistantContextKey = deps.context;
  if (context === 'email') {
    const rows = await emailTemplatesRepo(deps.meta).list(
      kind === 'template' || kind === 'campaign' ? { kind } : {},
    );
    return rows.slice(0, DOCUMENT_LIST_MAX).map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      // An email document has no status column: "enabled" is what the manager
      // draws as Draft or Live, so that is what the word means here.
      status: row.enabled ? 'live' : 'draft',
      locale: row.locale,
      updatedAt: row.updatedAt,
    }));
  }
  if (context === 'report') {
    const rows = await reportDocumentsRepo(deps.meta).list(
      kind === 'template' || kind === 'report' ? { kind } : {},
    );
    return rows.slice(0, DOCUMENT_LIST_MAX).map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      status: row.status,
      updatedAt: row.updatedAt,
    }));
  }
  const rows = await invoiceDocumentsRepo(deps.meta).list(
    kind === 'template' || kind === 'invoice' ? { kind } : {},
  );
  return rows.slice(0, DOCUMENT_LIST_MAX).map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    status: row.status,
    locale: row.lang,
    updatedAt: row.updatedAt,
  }));
}

export const listDocumentsTool: AssistantTool = {
  name: 'list_documents',
  description: `The documents this page holds (at most ${String(DOCUMENT_LIST_MAX)}): id, name, kind, status, language and when each changed.`,
  args: {
    type: 'object',
    properties: { kind: { type: 'string', description: 'Narrow to one kind; omit for all of them.' } },
    additionalProperties: false,
  },
  async run(args, deps) {
    const kind = typeof args.kind === 'string' ? args.kind : undefined;
    return { result: { documents: await listDocuments(deps, kind) } };
  },
};

export const readDocumentTool: AssistantTool = {
  name: 'read_document',
  description: 'One document of this page in full, in the format this page writes.',
  args: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
    additionalProperties: false,
  },
  async run(args, deps) {
    const id = typeof args.id === 'string' ? args.id : '';
    if (id === '') return { error: { code: 'BAD_ARGS', message: 'read_document needs an `id`.' } };
    if (deps.context === 'email') {
      const row = await emailTemplatesRepo(deps.meta).findById(id);
      if (row === null) return notFound(id);
      return {
        result: {
          id: row.id,
          name: row.name,
          kind: row.kind,
          locale: row.locale,
          key: row.key,
          // The page stores a document as columns; this is the same
          // reassembly its own editor reads.
          document: normalizeDocument(row),
        },
      };
    }
    if (deps.context === 'report') {
      const row = await reportDocumentsRepo(deps.meta).findById(id);
      if (row === null) return notFound(id);
      return { result: { id: row.id, name: row.name, kind: row.kind, status: row.status, body: row.body } };
    }
    const row = await invoiceDocumentsRepo(deps.meta).findById(id);
    if (row === null) return notFound(id);
    return {
      result: {
        id: row.id,
        name: row.name,
        kind: row.kind,
        topic: row.topic,
        lang: row.lang,
        number: row.number,
        status: row.status,
        body: row.body,
      },
    };
  },
};

function notFound(id: string): { error: { code: string; message: string } } {
  return {
    error: {
      code: 'DOCUMENT_NOT_FOUND',
      message: `No document on this page has the id ${JSON.stringify(id)}. Use list_documents first.`,
    },
  };
}

export const listStartersTool: AssistantTool = {
  name: 'list_starters',
  description: 'The starters this page can mint a new document from: a key, a name and one line each.',
  args: { type: 'object', properties: {}, additionalProperties: false },
  async run(_args, deps) {
    if (deps.context === 'email') {
      const cards = emailStarterCards(deps.t);
      return {
        result: {
          starters: cards.map((card) => ({
            key: card.key,
            name: card.name,
            category: card.category,
            heading: card.heading,
          })),
        },
      };
    }
    if (deps.context === 'report') {
      return {
        result: {
          starters: reportStarterCards().map((card) => ({
            key: card.key,
            name: card.name,
            category: card.category,
            title: card.reportTitle,
            blocks: card.blockCount,
          })),
        },
      };
    }
    return {
      result: {
        starters: invoiceStarterCards().map((card) => ({
          key: card.key,
          name: card.name,
          category: card.category,
          title: card.title,
        })),
      },
    };
  },
};
