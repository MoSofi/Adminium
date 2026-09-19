// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The closed tool catalogue.
 *
 * Every tool the assistant will ever call is in this list, and every one of
 * them READS. There is no create, update, send or delete here and there is no
 * mechanism for adding one at runtime: the model's terminal move is a drafted
 * document, and the writing happens later, when a person clicks Save and the
 * page's own code runs under the page's own grant.
 *
 * Which subset a page offers is the context's; whether the row tools are in it
 * at all is the workspace's row-data setting.
 */

import { aggregateTool } from './aggregate.js';
import { listDocumentsTool, listStartersTool, readDocumentTool } from './documents.js';
import { readRowsTool, sampleRecordTool } from './rows.js';
import { describeSchemaTool, listConnectionsTool } from './schema.js';
import { emailVariablesTool, workspaceSettingsTool } from './settings.js';
import type { AssistantTool } from '../types.js';

/** Every tool, by name. */
export const ASSISTANT_TOOLS: Readonly<Record<string, AssistantTool>> = Object.freeze(
  Object.fromEntries(
    [
      listDocumentsTool,
      readDocumentTool,
      listStartersTool,
      workspaceSettingsTool,
      emailVariablesTool,
      listConnectionsTool,
      describeSchemaTool,
      readRowsTool,
      aggregateTool,
      sampleRecordTool,
    ].map((tool) => [tool.name, tool]),
  ),
);

/** The tools that read customer rows — present only while row data is allowed. */
export const ROW_TOOL_NAMES: readonly string[] = [readRowsTool.name, aggregateTool.name, sampleRecordTool.name];

/** What the prompt says instead, when the row tools are absent. */
export const ROWS_UNAVAILABLE_NOTE =
  'Reading rows from the connected databases is turned off for this workspace, so there are no tools for it. Work from the documents and the schema, and say plainly when an answer would need row data.';

/**
 * The tools one session may call: the page's subset, minus the row tools when
 * the workspace has them off.
 */
export function toolsFor(names: readonly string[], rowData: boolean): AssistantTool[] {
  const out: AssistantTool[] = [];
  for (const name of names) {
    if (!rowData && ROW_TOOL_NAMES.includes(name)) continue;
    const tool = ASSISTANT_TOOLS[name];
    if (tool !== undefined) out.push(tool);
  }
  return out;
}
