// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `list_add_ons`: what this workspace has installed, and what it could have.
 *
 * Read from what the server already holds: the installed add-ons, the ones in
 * its store, and the catalogue as it was last read. NEVER the network: a turn
 * does not go and ask adminium.dev for a list. With the catalogue switched
 * off, or never read, the answer is the installed ones and says so.
 *
 * WHAT IT IS FOR. When a person asks for something the workspace cannot do
 * ("can I give customers a discount code?"), the assistant can say which
 * add-on would give it, by naming the add-on's KEY in `suggest`. The server
 * then checks the key against this same list and draws the card from it. The
 * assistant never installs anything.
 */
import type { AssistantAddOn, AssistantTool } from '../types.js';

/** Add-ons one answer carries: the list is a catalogue, not the workspace's data. */
export const ADD_ONS_MAX = 60;

/** A line of text as it is told to a model: bounded, one line. */
function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

/** The list, as the tool answers it and as a suggestion is checked against. */
export async function listedAddOns(read: (() => Promise<AssistantAddOn[]>) | undefined): Promise<AssistantAddOn[] | null> {
  if (read === undefined) return null;
  try {
    return (await read()).slice(0, ADD_ONS_MAX);
  } catch {
    // An unreadable store or a corrupt cache is "no list", never a failed turn.
    return null;
  }
}

export const listAddOnsTool: AssistantTool = {
  name: 'list_add_ons',
  description:
    'The add-ons installed in this workspace and the ones it could install, each with its key, its name and one line on what it adds. Call it when the person asks for something the workspace does not seem able to do.',
  args: { type: 'object', properties: {}, additionalProperties: false },
  async run(_args, deps) {
    const list = await listedAddOns(deps.addOns);
    if (list === null) {
      return { result: { addOns: [], note: 'The list of add-ons is not available here. Do not suggest one.' } };
    }
    return {
      result: {
        addOns: list.map((item) => ({ key: item.key, name: clip(item.name, 80), what: clip(item.line, 240), installed: item.state === 'installed' })),
        note: 'To point the person at one that is not installed, put its key in "suggest". You cannot install anything.',
      },
    };
  },
};
