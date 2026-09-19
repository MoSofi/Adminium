// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Everything a turn needs before the first provider call: who it runs as, what
 * it may read, what the model is told, and the one function that executes a
 * tool call.
 *
 * It is separate from the runner because the runner is pure and this is not —
 * this is where the permission set is resolved, the connections are counted
 * and the page is read. It is separate from the job because a test wants all
 * of it without a queue.
 *
 * THE EXECUTOR IS THE ONLY DOOR. The runner cannot reach a tool except through
 * the function built here, and that function can only find a tool in the
 * closed catalogue, narrowed to this page's list and this workspace's row-data
 * answer. A tool name the model invents is answered with the list of the ones
 * that exist, not with an exception.
 */

import {
  buildAssistantPrompt,
  estimateAssistantInputTokens,
  ASSISTANT_INPUT_TOKEN_LIMIT,
  type AssistantToolSpec,
  type ProviderId,
} from '@adminium/llm';
import { settingsRepo, type AssistantContextKey, type AssistantHost, type MetaDb } from '@adminium/meta';

import { canReadTableFor } from '../rbac/table-grants.js';
import { recipientLocale, translatorFor } from '../i18n/server-i18n.js';
import type { ConnectionManager } from '../connections/manager.js';
import { contextAdapter } from './contexts/index.js';
import { appNameOf } from './page-facts.js';
import { ROWS_UNAVAILABLE_NOTE, toolsFor } from './tools/catalogue.js';
import type { AssistantContextAdapter, AssistantFactValues, AssistantToolDeps, AssistantToolOutcome, CanReadTable } from './types.js';

export interface TurnSetupInput {
  meta: MetaDb;
  manager: ConnectionManager;
  context: AssistantContextKey;
  host: AssistantHost;
  /** The person the turn runs as. `null` reads no table at all. */
  userId: string | null;
  /** Answers a system permission for that person. */
  can: (permission: string) => Promise<boolean>;
}

export interface TurnSetup {
  adapter: AssistantContextAdapter;
  deps: AssistantToolDeps;
  /** The tools this session offers, as the prompt lists them. */
  specs: AssistantToolSpec[];
  /** The filled system prompt. */
  system: string;
  /**
   * The page's named facts, exactly as the prompt's page section was built
   * from. The runner reports them as the turn's FIRST step, so the person
   * watching sees what the model was told before it was asked anything.
   */
  facts: AssistantFactValues;
  execute: (call: { id: string; tool: string; args: Record<string, unknown> }) => Promise<AssistantToolOutcome>;
}

/**
 * The dependency bundle every tool reads through.
 *
 * It is separate from {@link setUpTurn} because a turn is not the only thing
 * that runs a tool: *Run full preview* re-executes a report's stored
 * descriptors long after the turn that wrote them finished, and it must do so
 * with exactly these grants — the acting person's, resolved the same way.
 * Building a second, looser bundle for that path is how a re-run would come
 * to read a table the draft was never allowed to.
 *
 * The permission set is resolved ONCE per connection and reused for every
 * table question asked through it — a report over forty tables would
 * otherwise put a meta query inside the loop.
 */
export async function toolDepsFor(input: TurnSetupInput): Promise<AssistantToolDeps> {
  const settings = settingsRepo(input.meta);
  const rowData = await settings.get('assistant.rowData');
  const locale = await recipientLocale(input.meta, input.userId);
  const { t } = await translatorFor(input.meta, input.userId);

  const grants = new Map<string, Promise<CanReadTable>>();
  const canReadTable = (connectionId: string): Promise<CanReadTable> => {
    const cached = grants.get(connectionId);
    if (cached !== undefined) return cached;
    const pending = canReadTableFor(input.meta, input.userId, connectionId);
    grants.set(connectionId, pending);
    return pending;
  };

  return {
    meta: input.meta,
    manager: input.manager,
    can: input.can,
    canReadTable,
    userId: input.userId,
    rowData,
    locale,
    t,
    context: input.context,
    host: input.host,
  };
}

/** Resolve everything for one turn: the adapter, the deps, the tools and the prompt. */
export async function setUpTurn(input: TurnSetupInput): Promise<TurnSetup> {
  const adapter = contextAdapter(input.context);
  const settings = settingsRepo(input.meta);
  const name = await settings.get('assistant.name');
  const appName = await appNameOf(input.meta);

  const deps = await toolDepsFor(input);
  const { rowData, locale } = deps;

  const tools = toolsFor(adapter.toolNames, rowData);
  const specs: AssistantToolSpec[] = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    args: tool.args,
  }));
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  const facts = await adapter.pageFacts(deps);
  const system = buildAssistantPrompt({
    name,
    appName,
    pageLabel: adapter.pageLabel,
    localeName: localeName(locale),
    pageFacts: facts.prompt,
    formatSpec: adapter.formatSpec(),
    examples: adapter.examples(deps),
    tools: specs,
    rowsUnavailable: rowData ? null : ROWS_UNAVAILABLE_NOTE,
  });

  const execute = async (call: {
    id: string;
    tool: string;
    args: Record<string, unknown>;
  }): Promise<AssistantToolOutcome> => {
    const tool = byName.get(call.tool);
    if (tool === undefined) {
      return {
        error: {
          code: 'UNKNOWN_TOOL',
          message: `There is no tool called ${JSON.stringify(call.tool)} here. The tools are: ${[...byName.keys()].join(', ')}.`,
        },
      };
    }
    try {
      return await tool.run(call.args, deps);
    } catch (error) {
      // A tool that throws is a bug on our side, not the model's mistake —
      // but the turn is a person waiting at a modal, so it is reported as a
      // failed step rather than taking the whole turn down.
      return {
        error: {
          code: 'TOOL_FAILED',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  };

  return { adapter, deps, specs, system, facts: facts.values, execute };
}

/** `de_DE` → `German` — what the prompt asks the model to answer in. */
export function localeName(locale: string): string {
  const tag = locale.replaceAll('_', '-');
  try {
    const display = new Intl.DisplayNames(['en'], { type: 'language' }).of(tag);
    return display ?? tag;
  } catch {
    return tag;
  }
}

/**
 * Whether one more round-trip would fit in the model's context.
 *
 * Conservative, and deliberately refusing rather than truncating: a provider
 * that silently drops the oldest messages answers confidently from half a
 * conversation, which is worse than being told to start a new one.
 */
export function fitsContextWindow(
  provider: ProviderId,
  system: string,
  messages: readonly { role: 'user' | 'assistant'; content: string }[],
): { fits: boolean; estimate: number; limit: number } {
  const estimate = estimateAssistantInputTokens(system, messages);
  const limit = ASSISTANT_INPUT_TOKEN_LIMIT[provider];
  return { fits: estimate <= limit, estimate, limit };
}
