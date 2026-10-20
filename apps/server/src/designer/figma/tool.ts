// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `read_figma`: one part of a frame the person imported from Figma, read later in a turn.
 *
 * The frame is named only by what the server stamped on the import's attachments: the model
 * gives a node id, never a file key, and no Figma fact is ever read back from a document's text. A
 * crafted "… — Figma design.md" attached by hand carries no stamp, and makes this read nothing.
 *
 * The read uses the token of the person who started the turn, and their reads: the kept document
 * first (no read Figma counts), then Figma, at most three counted reads a turn (a picture is one),
 * none while Figma has paused the person's seat. Every read spent is named on the step's line. The
 * part's picture joins the turn the way the page's sight does, as a picture the server took; a model
 * whose window is small gets the outline alone.
 */
import { findNode } from './distil.js';
import type { Attachment, Attachments } from '../attachments.js';
import { FigmaError, figmaWords } from './client.js';
import type { FigmaCache } from './cache.js';
import { isNodeId } from './link.js';
import { FigmaAllowanceError, type FigmaReader } from './service.js';
import { FIGMA_LONG_FORM_WINDOW } from './distil.js';
import type { DesignerTool, ToolOutcome } from '../tool-types.js';
import type { DesignerSession } from '../session-store.js';
import { dataWindow, plainWords } from '../untrusted.js';

/** The most reads Figma counts that one turn's `read_figma` calls may spend. */
export const FIGMA_READS_PER_TURN = 3;

export interface ReadFigmaDeps {
  reader: FigmaReader;
  cache: FigmaCache;
  attachments: Attachments;
  /** The most tokens a request to the session's model may carry; the picture is not sent below the long form's floor. */
  windowOf?: (session: DesignerSession) => Promise<number>;
}

type Stamp = NonNullable<Attachment['figma']>;

/** The Figma frames a session holds, as stamped by the server: the newest last. */
export function figmaStamps(attachments: Attachments, sessionId: string): { entry: Attachment; stamp: Stamp }[] {
  return attachments.list(sessionId).flatMap((entry) => (entry.source === 'figma' && entry.kind === 'doc' && entry.figma !== undefined ? [{ entry, stamp: entry.figma }] : []));
}

/** The tool, for a session that holds a Figma import; null for one that holds none (it is then not offered at all). */
export function readFigmaTool(deps: ReadFigmaDeps, sessionId: string): DesignerTool | null {
  if (figmaStamps(deps.attachments, sessionId).length === 0) return null;
  /** Counted reads spent by each turn of this session. */
  const spent = new Map<number, number>();

  /** The frame the node is in: the stamp whose kept document holds it, else the newest. */
  const frameOf = (userId: string | null, node: string): { stamp: Stamp; name: string | null } | null => {
    const stamps = figmaStamps(deps.attachments, sessionId);
    if (stamps.length === 0) return null;
    if (userId !== null) {
      for (const { stamp } of [...stamps].reverse()) {
        const kept = deps.cache.nodes({ userId, fileKey: stamp.fileKey, nodeId: stamp.nodeId, version: stamp.version });
        const document = kept?.nodes[stamp.nodeId]?.document;
        const found = document === undefined ? null : findNode(document, node);
        if (found !== null) return { stamp, name: found.name };
      }
    }
    return { stamp: (stamps[stamps.length - 1] as { stamp: Stamp }).stamp, name: null };
  };
  const nameOf = (input: Record<string, unknown>, userId: string | null = null): string => {
    const node = typeof input['node'] === 'string' ? input['node'].trim().replace(/-/g, ':') : '';
    return plainWords(frameOf(userId, node)?.name ?? node, 80) || node;
  };
  const miss = (content: string, label: string, facts: ToolOutcome['facts'] = { outcome: 'refused' }): ToolOutcome => ({ content, label, isError: true, miss: true, facts });

  return {
    name: 'read_figma',
    description:
      'Read one part of a frame the person imported from Figma, by the node id a line of its design document ends with ("(read_figma 12:345)"): that part\'s outline in more detail, and with "picture": true a picture of it. A read can spend one of the person\'s Figma reads (a picture is another); at most 3 a turn. Read only what the design document leaves out and the build needs.',
    inputSchema: {
      type: 'object',
      properties: { node: { type: 'string', description: 'The node id, e.g. "12:345"' }, picture: { type: 'boolean', description: 'Also a picture of the part' } },
      required: ['node'],
      additionalProperties: false,
    },
    running: (input) => `Reading ${nameOf(input)} from Figma`,
    subject: (input, ctx) => nameOf(input, ctx.handle.by.id),
    run: async (input, ctx) => {
      const node = typeof input['node'] === 'string' ? input['node'].trim().replace(/-/g, ':') : '';
      const userId = ctx.handle.by.id;
      if (!isNodeId(node)) return miss(`"${node.slice(0, 40)}" is not a node id. A line of the design document ends with "(read_figma <id>)": use that id, e.g. "12:345".`, 'Did not read Figma');
      if (userId === null) return miss('Nobody started this turn, so Figma cannot be read in it (a read is made with a person\'s own token). Work from the design document.', 'Did not read Figma');
      const frame = frameOf(userId, node);
      if (frame === null) return miss('This session holds no frame imported from Figma: there is nothing read_figma can read. A design document attached by hand is read with read_attachment.', 'Did not read Figma');
      const name = plainWords(frame.name ?? node, 80) || node;
      const used = spent.get(ctx.turn) ?? 0;
      const window = await deps.windowOf?.(ctx.session).catch(() => undefined);
      const small = window !== undefined && window < FIGMA_LONG_FORM_WINDOW;
      const picture = input['picture'] === true && !small;
      try {
        const part = await deps.reader.readPart(userId, { fileKey: frame.stamp.fileKey, nodeId: frame.stamp.nodeId, version: frame.stamp.version }, node, { picture, allowance: FIGMA_READS_PER_TURN - used, small });
        spent.set(ctx.turn, used + part.reads);
        const cost = part.reads === 0 ? 'No Figma read was used (from the copy this server kept).' : `This read used ${String(part.reads)} of the person's Figma reads.`;
        const pictureNote = input['picture'] === true && small ? ' The picture was not sent: this model reads too little at once for it. Work from the outline.' : '';
        let made: Attachment | null = null;
        if (part.picture !== undefined) {
          try {
            made = deps.attachments.add(ctx.session.id, { filename: `figma part ${node}.png`, bytes: part.picture, imported: { source: 'figma', figma: frame.stamp, label: `figma part ${node}.png` } });
          } catch {
            // The session holds as many files as it may: the outline goes without its picture.
          }
        }
        return {
          content: `${dataWindow('the Figma file', part.text)}\n${cost}${pictureNote}${made === null ? '' : ` A picture of ${JSON.stringify(name)} follows.`}`,
          label: part.reads === 0 ? `Read ${name} from the saved copy` : `Read ${name} from Figma (${String(part.reads)} Figma ${part.reads === 1 ? 'read' : 'reads'})`,
          subject: name,
          facts: { count: part.reads },
          ...(made === null ? {} : { picture: { ref: made.id, mediaType: made.mediaType, name: made.label } }),
        };
      } catch (error) {
        if (error instanceof FigmaAllowanceError) return miss(`This turn has used its ${String(FIGMA_READS_PER_TURN)} Figma reads. Work from the design document and what was read.`, 'Did not read Figma');
        if (!(error instanceof FigmaError)) throw error;
        const refusal = error.refusal;
        if (refusal.kind === 'paused') return miss(`${figmaWords(refusal)}`, 'Did not read Figma', { outcome: 'refused', until: refusal.until, dated: refusal.dated });
        if (refusal.kind === 'not-connected') return miss('The person has no Figma token here (they connect one in the From Figma… dialog of the Attach menu). Work from the design document.', 'Did not read Figma');
        // Figma's limit, met now: the read stopped, and so do the next ones.
        if (refusal.kind === 'limit' && refusal.type === 'low') return miss(`${figmaWords(refusal)} Work from the design document.`, 'Did not read Figma', { outcome: 'refused', ...(refusal.retryAfterSeconds === null ? { dated: false } : { until: Date.now() + refusal.retryAfterSeconds * 1000, dated: true }) });
        return { content: `${figmaWords(refusal)} Work from the design document.`, label: 'Did not read Figma', isError: true, facts: { outcome: 'failed' } };
      }
    },
  };
}
