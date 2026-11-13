// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Each Designer tool, as a turn on the operator's AI under its dashboard
 * scope meets it (`operator-scope.ts`).
 *
 * Every tool is in {@link SCOPE_REACH}, by name; one the table does not name
 * is refused whole in a scoped turn, so a new tool is reviewed here before it
 * runs on such a turn (`operator-ai.test.ts` fails until it is). The table is
 * the door; the guards where the effect happens stay the rule:
 *
 *   dashboard  works on tables, rows, add-ons and the app's name: nothing a stranger sees
 *   reads      changes nothing
 *   jail       writes through the jail, which refuses a customer side, the phone app and a site template
 *   apply      writes through the jail; what it adds to the manifest (mail, a public entry) is refused at the
 *              build and the apply, which compare what the app reaches with what it reached as the turn began
 *   build      builds or applies: refused first when the app now reaches more of the public
 *   screens    works only on screens' looks and pictures: refused while the app has a customer side or phone app
 *   door       customer-facing whatever it is given: refused
 *   code       code the server would run: refused, as under trial mode (the declarative-only rule)
 *   a function refused for the inputs it names
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PHONE_SIDE } from '../project/apps/phone.js';
import { appDir } from '../project/apps/read-app.js';
import { ownCodeOutcome } from './declarative.js';
import { reachRefusal, SCOPE_LABEL, scopedDoorRefusal, scopedNow } from './operator-scope.js';
import type { DESIGNER_TOOL_NAMES, DesignerTool, ToolOutcome } from './tool-types.js';

export type ScopeReach = 'dashboard' | 'reads' | 'jail' | 'apply' | 'build' | 'screens' | 'door' | 'code' | ((input: Record<string, unknown>) => 'door' | 'jail');

export const SCOPE_REACH: Record<(typeof DESIGNER_TOOL_NAMES)[number], ScopeReach> = {
  list_files: 'reads',
  read_file: 'reads',
  write_file: 'jail',
  edit_file: 'jail',
  delete_file: 'jail',
  check_app: 'reads',
  build_sides: 'build',
  apply_app: 'build',
  run_tests: 'code',
  read_reference: 'reads',
  list_add_ons: 'reads',
  get_add_on: 'dashboard',
  name_app: 'dashboard',
  // A staff side is people who sign in; a customer side and the phone app are the public's.
  add_side: (input) => (input['side'] === 'staff' ? 'jail' : 'door'),
  add_ui_part: 'jail',
  set_style: 'screens',
  use_font: 'screens',
  list_styles: 'reads',
  // Its tables through the jail; the emails it writes are mail to customers, refused at the build and the apply.
  build_on_shape: 'apply',
  post_to_ledger: 'apply',
  read_attachment: 'reads',
  load_rows: 'dashboard',
  // A picture spot is a place on a screen's page: a dashboard has none.
  add_spots: 'door',
  fill_spot: 'door',
  use_pictures: 'dashboard',
  ask_person: 'reads',
  request_package: 'code',
  make_pictures: 'door',
  read_figma: 'reads',
  use_site: 'door',
  allow_picture_site: 'door',
};

/** The refused step, as the model and the page get it. */
const refusal = (content: string): ToolOutcome => ({ content, label: SCOPE_LABEL, isError: true, facts: { outcome: 'refused', operator: 'operator-ai-scope' } });

/** Whether the app has screens a stranger sees: a customer side or a phone app. */
export const hasPublicScreens = (root: string, appKey: string): boolean => existsSync(join(appDir(root, appKey), 'customer', 'src')) || existsSync(join(appDir(root, appKey), PHONE_SIDE));

/** The tools as a scoped turn's model gets them: outside a scoped turn each runs as it is. */
export function scopeTools(root: string, appKey: string, tools: readonly DesignerTool[]): DesignerTool[] {
  return tools.map((tool) => {
    const reach = (SCOPE_REACH as Record<string, ScopeReach | undefined>)[tool.name];
    if (reach === 'reads' || reach === 'dashboard' || reach === 'jail' || reach === 'apply') return tool;
    return {
      ...tool,
      run: async (input, ctx) => {
        if (!scopedNow(root)) return tool.run(input, ctx);
        const kind = typeof reach === 'function' ? reach(input) : (reach ?? 'door');
        if (kind === 'code') return ownCodeOutcome(tool.name === 'request_package' ? 'requestPackage' : 'designerCode', 'operator-ai-scope');
        if (kind === 'door' || (kind === 'screens' && hasPublicScreens(root, appKey))) return refusal(scopedDoorRefusal(root) ?? '');
        if (kind === 'build') {
          const refused = reachRefusal(root, ctx.session.appKey);
          if (refused !== null) return refusal(refused);
        }
        return tool.run(input, ctx);
      },
    };
  });
}

/** The tool a scoped turn's model calls for a request that needs customer-facing screens: the server answers it with the card. */
export const NEEDS_OWN_KEY = 'needs_own_ai_key';

export function needsOwnKeyTool(root: string): DesignerTool {
  return {
    name: NEEDS_OWN_KEY,
    description:
      'Call this alone, at once, when the person asks for anything customers or the public would see or use: a customer side or a website, a public page or form, a phone app, mail to customers, a site template. The server shows the person a card about it and this turn ends. Never explain it in your own words.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    running: () => SCOPE_LABEL,
    run: async () => refusal(scopedDoorRefusal(root) ?? ''),
  };
}
