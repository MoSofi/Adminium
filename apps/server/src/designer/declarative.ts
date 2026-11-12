// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Designer, declarative only: what each of its tools may do to this
 * server, and the one refusal a tool gives when the operator turned that off
 * (`trial/own-code.ts`).
 *
 * Every tool is in {@link TOOL_REACH}, by name. A tool the table does not
 * name is refused whole while own code is off: a new tool is reviewed into the
 * table before it runs on such a server (`trial-own-code.test.ts` fails until
 * it is). The table is the door; the guards where the effect happens stay
 * the rule:
 *
 *   - a file written into hooks/, actions/ or a build's own files: the jail
 *     refuses it (`jail.ts`), whoever writes;
 *   - an app's own build command, the phone app's build and install: refused
 *     where they run (`project/apps/own-build.ts`, `phone-build.ts`);
 *   - the project's hooks and actions: never imported (`project/code/load.ts`).
 *
 * The refusal is fixed words, for the model and for the page: never prose the
 * model makes up, and never a card that asks the person to allow it.
 */
import { ownCodeAllows, OWN_CODE_MESSAGES, type OwnCodeQuestion } from '../trial/own-code.js';
import type { PolicyReason } from '../trial/policy.js';
import type { DESIGNER_TOOL_NAMES, DesignerTool, ToolOutcome } from './tool-types.js';

/**
 * What a tool may do:
 *
 *   reads        reads the project, the skills, the attachments or a list; changes nothing
 *   declarative  writes the app's manifest, pages, screens, styles, pictures or rows, through the
 *                jail or the engine's own writers: nothing the server runs
 *   build        checks, builds and applies with the engine's own side build; an app's own build
 *                command meets its own guard
 *   catalogue    installs an add-on from the catalogue or the image's bundle
 *   files        writes the files it is given: a path the jail calls code is refused (`codeRefusal`)
 *   a question   refused whole while that question is not allowed
 *   a function   refused for the inputs it names (the phone app: it installs Expo and runs its build)
 */
export type ToolReach = 'reads' | 'declarative' | 'build' | 'catalogue' | 'files' | OwnCodeQuestion | ((input: Record<string, unknown>) => OwnCodeQuestion | null);

export const TOOL_REACH: Record<(typeof DESIGNER_TOOL_NAMES)[number], ToolReach> = {
  list_files: 'reads',
  read_file: 'reads',
  write_file: 'files',
  edit_file: 'files',
  delete_file: 'files',
  check_app: 'reads',
  build_sides: 'build',
  apply_app: 'build',
  // The app's tests are code the model wrote, run on this machine.
  run_tests: 'designerCode',
  read_reference: 'reads',
  list_add_ons: 'reads',
  get_add_on: 'catalogue',
  name_app: 'declarative',
  add_side: (input) => (input['side'] === 'mobile' ? 'ownBuilds' : null),
  add_ui_part: 'declarative',
  set_style: 'declarative',
  use_font: 'declarative',
  list_styles: 'reads',
  build_on_shape: 'declarative',
  post_to_ledger: 'declarative',
  read_attachment: 'reads',
  load_rows: 'declarative',
  add_spots: 'declarative',
  fill_spot: 'declarative',
  use_pictures: 'declarative',
  ask_person: 'reads',
  // npm packages the model names, added to the project.
  request_package: 'requestPackage',
  make_pictures: 'declarative',
  read_figma: 'reads',
  use_site: 'declarative',
  allow_picture_site: 'declarative',
};

/** What a refused tool tells the model, after the operator's sentence. */
const TOLD_MODEL =
  'This is the server’s setting, not the person’s: do not ask them to allow it, and do not call this again in this session. Build what was asked with the manifest, pages and screens, and tell the person in one sentence that this server does not allow the rest.';

/** The step's line on the page, in English (the page words it from `facts.operator`). */
export const OWN_CODE_LABEL = 'Turned off on this server';

/** The fixed answer of a tool the operator turned off. */
export function ownCodeOutcome(question: OwnCodeQuestion, reason: PolicyReason): ToolOutcome {
  return {
    content: `${OWN_CODE_MESSAGES[question]} ${TOLD_MODEL}`,
    label: OWN_CODE_LABEL,
    isError: true,
    detail: OWN_CODE_MESSAGES[question],
    facts: { outcome: 'refused', operator: reason },
  };
}

/** The refusal for `question`, or null while it is allowed. */
export function ownCodeRefusal(question: OwnCodeQuestion): ToolOutcome | null {
  const answer = ownCodeAllows(question);
  return answer.allowed ? null : ownCodeOutcome(question, answer.reason ?? 'trial-mode');
}

/**
 * The tools as the model gets them: each one that the table refuses for an
 * input answers {@link ownCodeOutcome} before it runs, and one the table does
 * not name answers it whole while own code is off.
 */
export function gateTools(tools: readonly DesignerTool[]): DesignerTool[] {
  return tools.map((tool) => {
    const reach = (TOOL_REACH as Record<string, ToolReach | undefined>)[tool.name];
    if (reach === 'reads' || reach === 'declarative' || reach === 'build' || reach === 'catalogue' || reach === 'files') return tool;
    const questionOf = reach === undefined ? () => 'designerCode' as const : typeof reach === 'function' ? reach : () => reach;
    return {
      ...tool,
      run: async (input, ctx) => {
        const question = questionOf(input);
        const refusal = question === null ? null : ownCodeRefusal(question);
        return refusal ?? tool.run(input, ctx);
      },
    };
  });
}
