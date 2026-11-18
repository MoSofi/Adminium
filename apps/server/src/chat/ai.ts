// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHETHER A CHAT CAN USE AI NOW, and the service's name a visitor is told.
 *
 * The window's first line names the AI service whenever automatic answers or
 * Milo drafting send a visitor's words to it, so both come from the
 * answerer's own reading of this server (`answerer.ts` `chatAiService`, the
 * name by `ai-notice.ts` `chatServiceName`): the connection it would call,
 * whether it may (a provider set, outside calls on, not switched off here by
 * a trial or the operator's scope), and that service as people know it.
 */
import { chatServiceName } from './ai-notice.js';
import { chatAiService, type ChatAnswererDeps } from './answerer.js';

/** What the door needs to know of AI for a chat. */
export interface ChatAi {
  usable: boolean;
  /** The service's name; null while none is usable. */
  service: string | null;
}

/** Reads AI's state for chats as the answerer reads it. Never throws: an error is "not usable". */
export function chatAiFrom(deps: Pick<ChatAnswererDeps, 'connections' | 'offHere'>): () => Promise<ChatAi> {
  return async () => {
    try {
      const found = await chatAiService(deps);
      if (found.refusal !== null || found.connection === null) return { usable: false, service: null };
      return { usable: true, service: chatServiceName(found.connection, found.model) };
    } catch {
      return { usable: false, service: null };
    }
  };
}
