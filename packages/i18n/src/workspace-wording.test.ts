// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Workspace" means ONE thing in the product: a named group of a server's
 * databases. Before workspaces existed the word meant the whole server (the
 * whole Adminium), in some 70 catalogue strings, Milo's prompts, error
 * messages, the desktop app and the guides. Those now say "server", and the
 * sidebar group whose key is `workspace` is labelled "Pages".
 *
 * Nothing else would notice the old meaning creeping back: a string that says
 * "Ask a workspace admin" reads fine to a reviewer who has not met the new
 * groups. So this suite reads every place a person or the assistant reads
 * product words from, and fails on any "workspace" that is not in the
 * reviewed allow-lists below.
 *
 * What it reads:
 * - the en-US catalogues (`locales/en-US/*.json`), every value;
 * - the product source of the dashboard, the server and the desktop app: every
 *   string literal, template piece and JSX text, parsed with the TypeScript
 *   AST (so a `t()` fallback under a line wrap counts) — tests and stories
 *   excluded, comments never read;
 * - the desktop app's HTML shells, comments stripped;
 * - the skills and the guides (`skills/**`, `apps/docs/src/content/docs/**`),
 *   code blocks and `inline code` stripped.
 *
 * What counts as words, in source: a literal that holds "workspace" and either
 * a space or a capital W. `'workspace'` (the nav-group key),
 * `'workspace-defaults'`, `'/api/v1/settings/workspace'` and
 * `adminium_workspaces` are code, and stay. A property NAME is code too
 * (`'POST /api/v1/workspaces': audited(...)`).
 *
 * Adding a string about the groups: put its key, its file or its exact text in
 * the matching list below, with a line saying why it means the group. Keep the
 * lists small: an entry that matches nothing fails, so they cannot rot.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');

const WORD = /\bworkspaces?\b/i;

// ─── The reviewed allow-lists: "workspace" here means the group ──────────────

/** en-US catalogue keys (`ns:dotted.key`) whose text is about the groups. */
const GROUP_KEYS: ReadonlyMap<string, string> = new Map<string, string>([
  // The sidebar, the switcher and the Workspaces dialog add theirs here.
  ['studio:workspaceFiles.choice.create', 'workspace files: saving a workspace and installing one'],
  ['studio:workspaceFiles.choice.existing', 'workspace files: saving a workspace and installing one'],
  ['studio:workspaceFiles.choice.existingLabel', 'workspace files: saving a workspace and installing one'],
  ['studio:workspaceFiles.choice.first', 'workspace files: saving a workspace and installing one'],
  ['studio:workspaceFiles.choice.none', 'workspace files: saving a workspace and installing one'],
  ['studio:workspaceFiles.choice.noneYet', 'workspace files: saving a workspace and installing one'],
  ['studio:workspaceFiles.choice.title', 'workspace files: saving a workspace and installing one'],
  ['studio:workspaceFiles.done.inExisting', 'workspace files: saving a workspace and installing one'],
  ['studio:workspaceFiles.done.inNew', 'workspace files: saving a workspace and installing one'],
  ['studio:workspaceFiles.done.openWorkspace', 'workspace files: saving a workspace and installing one'],
  ['studio:workspaceFiles.done.workspace', 'workspace files: saving a workspace and installing one'],
  ['studio:workspaceFiles.done.workspaceGone', 'workspace files: saving a workspace and installing one'],
  ['studio:workspaceFiles.install.badge', 'workspace files: saving a workspace and installing one'],
  ['studio:workspaceFiles.install.checkIntro', 'workspace files: saving a workspace and installing one'],
  ['studio:workspaceFiles.install.reading', 'workspace files: saving a workspace and installing one'],
  ['studio:workspaceFiles.install.title', 'workspace files: saving a workspace and installing one'],
  ['studio:workspaceFiles.install.workspaceGone.body', 'workspace files: saving a workspace and installing one'],
  ['studio:workspaceFiles.install.workspaceGone.title', 'workspace files: saving a workspace and installing one'],
  ['studio:workspaceFiles.refusal.nested', 'workspace files: saving a workspace and installing one'],
  ['studio:workspaceFiles.refusal.title', 'workspace files: saving a workspace and installing one'],
  ['studio:workspaceFiles.refusal.twoInstances', 'workspace files: saving a workspace and installing one'],
  ['studio:workspaceFiles.save.button', 'workspace files: saving a workspace and installing one'],
  ['studio:workspaceFiles.save.leaks', 'workspace files: saving a workspace and installing one'],
  ['studio:workspaceFiles.save.subtitle', 'workspace files: saving a workspace and installing one'],
  ['studio:workspaceFiles.save.title', 'workspace files: saving a workspace and installing one'],
  ['studio:workspaceFiles.save.tooBig', 'workspace files: saving a workspace and installing one'],
  ['studio:workspaceFiles.saved.title', 'workspace files: saving a workspace and installing one'],
  ['studio:workspaceFiles.saves.label', 'workspace files: saving a workspace and installing one'],
  ['studio:workspaceFiles.waiting.label', 'workspace files: saving a workspace and installing one'],
  ['studio:workspaceFiles.waiting.staged', 'workspace files: saving a workspace and installing one'],
  ['studio:workspaceFiles.waiting.stopped', 'workspace files: saving a workspace and installing one'],
  // The menu grouped by workspace, its switcher, the lists that follow it, and Data connections' Workspaces card and dialogs.
  ['common:settings.defaults.workspaceView.label', 'the groups of databases: the menu, its lists and the Workspaces card'],
  ['common:workspaces.filter.label', 'the groups of databases: the menu, its lists and the Workspaces card'],
  ['common:workspaces.filter.all', 'the groups of databases: the menu, its lists and the Workspaces card'],
  ['common:workspaces.column', 'the groups of databases: the menu, its lists and the Workspaces card'],
  ['common:workspaces.alsoIn', 'the groups of databases: the menu, its lists and the Workspaces card'],
  ['common:workspaces.card.notInOne', 'the groups of databases: the menu, its lists and the Workspaces card'],
  ['common:workspaces.card.workspace', 'the groups of databases: the menu, its lists and the Workspaces card'],
  ['common:workspaces.menu.title', 'the groups of databases: the menu, its lists and the Workspaces card'],
  ['common:workspaces.menu.manage', 'the groups of databases: the menu, its lists and the Workspaces card'],
  ['common:workspaces.view.label', 'the groups of databases: the menu, its lists and the Workspaces card'],
  ['studio:hub.workspaces.title', 'the groups of databases: the menu, its lists and the Workspaces card'],
  ['studio:hub.workspaces.new.title', 'the groups of databases: the menu, its lists and the Workspaces card'],
  ['studio:hub.workspaces.new.first', 'the groups of databases: the menu, its lists and the Workspaces card'],
  ['studio:hub.workspaces.new.create', 'the groups of databases: the menu, its lists and the Workspaces card'],
  ['studio:hub.workspaces.error.nameRequired', 'the groups of databases: the menu, its lists and the Workspaces card'],
  ['studio:hub.workspaces.error.nameTaken', 'the groups of databases: the menu, its lists and the Workspaces card'],
  ['studio:hub.workspaces.error.saveFailed', 'the groups of databases: the menu, its lists and the Workspaces card'],
  ['studio:hub.workspaces.error.deleteFailed', 'the groups of databases: the menu, its lists and the Workspaces card'],
  ['studio:hub.workspaces.created', 'the groups of databases: the menu, its lists and the Workspaces card'],
  ['studio:hub.workspaces.deleted', 'the groups of databases: the menu, its lists and the Workspaces card'],
  ['studio:hub.workspaces.rename.title', 'the groups of databases: the menu, its lists and the Workspaces card'],
  ['studio:hub.workspaces.delete.body', 'the groups of databases: the menu, its lists and the Workspaces card'],
  ['studio:hub.workspaces.delete.last', 'the groups of databases: the menu, its lists and the Workspaces card'],
  ['studio:hub.workspaces.connection.title', 'the groups of databases: the menu, its lists and the Workspaces card'],
  ['studio:hub.workspaces.connection.newInline', 'the groups of databases: the menu, its lists and the Workspaces card'],
  ['studio:hub.workspaces.connection.note', 'the groups of databases: the menu, its lists and the Workspaces card'],
  ['studio:hub.workspaces.connection.saved', 'the groups of databases: the menu, its lists and the Workspaces card'],
  ['studio:hub.workspaces.connection.action', 'the groups of databases: the menu, its lists and the Workspaces card'],
  ['studio:hub.workspaces.empty.title', 'the groups of databases: the menu, its lists and the Workspaces card'],
  ['studio:hub.workspaces.youAreIn', 'the groups of databases: the menu, its lists and the Workspaces card'],
  // The in-app help: the Knowledge Base's articles on workspaces, and the docs links of the Workspaces card and of workspace files.
  ['common:kb.article.workspaces.title', 'the Knowledge Base article on workspaces, the groups of databases'],
  ['common:kb.article.workspaces.excerpt', 'the Knowledge Base article on workspaces, the groups of databases'],
  ['common:kb.article.workspaceSenders.title', 'the Knowledge Base article on a workspace’s mail sender'],
  ['common:kb.article.workspaceSenders.excerpt', 'the Knowledge Base article on a workspace’s mail sender'],
  ['common:kb.article.workspaceFiles.title', 'the Knowledge Base article on workspace files'],
  ['common:kb.article.workspaceFiles.excerpt', 'the Knowledge Base article on workspace files'],
  ['studio:hub.workspaces.docsLink', 'the Workspaces card’s link to the workspaces guide'],
  ['studio:workspaceFiles.docsLink', 'Save workspace and Install a workspace file, their link to the workspace files guide'],
  // "Send as", the sender sheet and "Shown in".
  ['email:sendAs.byRecord', '"Send as": the sender of the workspace the record’s database is in'],
  ['email:sendAs.helper.byRecord', '"Send as": the sender of the workspace the record’s database is in'],
  ['email:sendAs.helper.noSender', '"Send as" a workspace with no sender of its own'],
  ['email:sendAs.helper.unseen', '"Send as" a workspace this person does not see'],
  ['email:sendAs.helper.workspace', '"Send as" one workspace'],
  ['email:sendAs.workspaceFrom', '"Send as": a workspace and its From'],
  ['email:sendAs.workspaceNoSender', '"Send as": a workspace with no sender yet'],
  ['email:sendAs.unseenWorkspace', '"Send as": a workspace this person does not see'],
  ['studio:workspaceSender.title', 'the sender sheet of one workspace'],
  ['studio:workspaceSender.subtitle', 'the sender sheet: mail about one workspace’s databases'],
  ['studio:workspaceSender.noMail.body', 'the sender sheet: a workspace cannot have its own sender yet'],
  ['studio:workspaceSender.postal.helper', 'the sender sheet: one workspace’s marketing mail'],
  ['common:shownIn.all', '"Shown in": where an email template, a report layout or an invoice layout is listed'],
  ['common:shownIn.chosen', '"Shown in": where an email template, a report layout or an invoice layout is listed'],
  ['common:shownIn.none', '"Shown in": where an email template, a report layout or an invoice layout is listed'],
  ['common:shownIn.noneHint', '"Shown in": where an email template, a report layout or an invoice layout is listed'],
  ['common:shownIn.unseen', '"Shown in": where an email template, a report layout or an invoice layout is listed'],
  ['common:shownIn.unseenChip', '"Shown in": where an email template, a report layout or an invoice layout is listed'],
  ['common:shownIn.filter.label', '"Shown in": where an email template, a report layout or an invoice layout is listed'],
  ['common:shownIn.deletePlan.lead', '"Shown in": where an email template, a report layout or an invoice layout is listed'],
  ['common:shownIn.hidden.here', '"Shown in": a picked template not listed in the tab’s workspace, named by `{workspace}`'],
  ['common:shownIn.deletePlan.after', '"Shown in": where an email template, a report layout or an invoice layout is listed'],
  ['studio:hostedApps.installed.emptyHere', 'Hosted apps in One at a time: the apps on the tab’s workspace’s databases'],
]);

/** Repo-relative path prefixes whose every "workspace" is the group. */
const GROUP_FILES: ReadonlyMap<string, string> = new Map([
  ['apps/server/src/routes/workspaces/', 'the routes that create, rename, order and delete workspaces'],
  ['apps/server/src/workspaces/', 'which workspaces a person sees, and the `workspaceId` list filter'],
  ['apps/dashboard/src/shell/workspaces/', 'the menu grouped by workspace, its switcher, and the lists that follow it'],
  ['apps/dashboard/src/studio/hub/WorkspaceDialogs.tsx', 'New workspace, Rename, Delete and a database’s workspaces'],
  ['apps/dashboard/src/studio/hub/WorkspacesCard.tsx', 'the Workspaces card of Data connections'],
  ['apps/dashboard/src/studio/connect/steps/WorkspacesField.tsx', 'the workspaces a new connection goes in'],
  ['apps/dashboard/src/test/workspaceLists.tsx', 'a test helper for the lists that follow the workspaces'],
  ['apps/dashboard/src/shown-in/', '"Shown in": where an email template, a report layout or an invoice layout is listed, by workspace'],
  ['apps/docs/src/content/docs/reference/rest-api.md', 'documents the /workspaces routes'],
  ['apps/docs/src/content/docs/anatomy/', 'the pnpm sense: "twenty-one workspaces" are the packages of the monorepo'],
  ['apps/docs/src/content/docs/contributing/', 'the pnpm sense, as above'],
  ['apps/server/src/apps/save/workspace.ts', 'Save workspace: one app per database of a workspace, in one file'],
  ['apps/server/src/apps/workspace-files.ts', 'reading and checking an uploaded workspace file'],
  ['apps/server/src/apps/workspace-install.ts', 'installing a workspace file, and the workspace its databases join'],
  ['apps/server/src/routes/apps/workspace-files.ts', 'the routes that upload, review and install a workspace file'],
  ['apps/server/src/cli/commands/workspace', '`adminium workspace list` and `adminium workspace save`'],
  ['apps/dashboard/src/studio/apps/workspaceFiles/', 'the Save workspace dialog and the workspace file install screens'],
  ['apps/dashboard/src/studio/workspace-sender/', 'the sender sheet of one workspace'],
  ['apps/dashboard/src/email/editor/inspector/panels/SendAsField.tsx', '"Send as": a workspace’s sender, or the server’s'],
  ['apps/docs/src/content/docs/guides/workspaces/', 'the guides to workspaces: the menu, a workspace’s sender, workspace files'],
  ['apps/docs/src/content/docs/guides/your-own-apps/', 'Save as app and its install: a database’s workspace chips, and saving a whole workspace'],
]);

/** Exact source strings that are about the groups. */
const GROUP_STRINGS: ReadonlyMap<string, string> = new Map([
  ['No app is installed on this workspace’s databases', 'Hosted apps in One at a time: the apps on the tab’s workspace’s databases'],
  ['There is no such workspace.', 'a `workspaceId` the person cannot see (assistant host, last-chosen workspace)'],
  ['That database is not in this workspace. Call list_connections for the ones here.', 'Milo narrowed to the tab’s workspace'],
  [
    "The person is working in one workspace (a group of this server's databases). These are its databases, the only ones you work with here. Asked about another database, say it may be in another workspace, which they can switch to in the menu.",
    'Milo’s prompt when the tab is on a workspace',
  ],
  [
    "The connected databases, with how many of their tables you may read. When the person is working in one workspace (a group of the server's databases), only that workspace's databases are listed, and only those can be read.",
    'Milo’s list_connections tool, narrowed to the tab’s workspace',
  ],
  ['Workspaces group databases: names and memberships, not rows.', 'row-coverage reason of the /workspaces routes'],
  ['A workspace file.', 'the app upload handing a workspace file, by its name, to the workspace upload'],
  ["A workspace file's app files staged as uploads: no source row.", 'row-coverage reason of the workspace upload'],
  ['The workspace files staged here and how far each install got: no source row.', 'row-coverage reason of the workspace file routes'],
  ["A saved workspace file packed again from the apps' kept files: no source row is read.", 'row-coverage reason of Download again'],
  ['a preview of the workspace file a save would make; it reads configuration and writes nothing. The save it precedes is audited.', 'audit mark of the Save workspace plan'],
  ['An app in that workspace file is no longer kept. Save the workspace again.', 'Download again of a workspace file'],
  ['description: Every adminium command and flag — new, dev, build, start, check, app, workspace, pull, eject, try, migrate, introspect, generate-prompt, apply-llm-response, export-zip, import-zip.', 'the CLI reference lists the `workspace` command'],
  ["A workspace groups some of this server's databases. `adminium workspace", 'cli.md, the `workspace` command'],
  ['Prints each workspace, its id and name, and the databases it holds. A database', 'cli.md, `workspace list`'],
  ['may be in several workspaces, or in none.', 'cli.md, `workspace list`'],
  ['Saves every database of a workspace as one **workspace file**: one app per', 'cli.md, `workspace save`'],
  ['**Save workspace**, run with host access. A workspace file holds at most eight', 'cli.md, `workspace save`'],
  ['without `apps`, every database of the workspace is saved, each under the key it', 'cli.md, `workspace save`'],
  ["and each app's. A workspace file is installed from the dashboard only: **Install", 'cli.md, `workspace save`'],
  ['Workspace', 'a list’s workspace filter label'],
  ['Workspaces', 'a list’s Workspaces column, and a connection card’s workspaces'],
  ['All workspaces', 'a list’s workspace filter, unfiltered'],
  ['Workspaces…', 'a connection card’s button to choose its workspaces'],
  ['Workspaces in the menu', 'the Global defaults row for the menu’s view of workspaces'],
  ["The server's From and each workspace the person sees, its From only to those who manage senders; no source row.", 'row-coverage reason of "Send as"’s choices'],
  ["Which sender a template goes as: the template rows and a workspace's name, no source row.", 'row-coverage reason of "Send as"'],
  ["A workspace's sender: a name and addresses on the workspace, no source row.", 'row-coverage reason of the workspace sender routes'],
  ['- **its own row** on Hosted apps, named "on kiln", with its database\'s workspace chips;', 'apps-per-database.md, an app copy’s row'],
  ['[A mail sender per workspace](/guides/workspaces/senders/).', 'email guide, the link to a workspace’s sender'],
  ['See [Workspace files](/guides/workspaces/files/).', 'cli.md, `workspace save`, the link to its guide'],
  ['- **Workspaces.** The groups of databases, their order and their mail senders', 'export-zip.md: workspaces are not in the bundle'],
  ['[Workspaces](/guides/workspaces/).', 'export-zip.md, the link to the workspaces guide'],
  ['workspaces sorts the menu; it does not separate who sees what. Roles do. Give', 'security.md: a workspace is not a security wall'],
  ['business. See [Workspaces](/guides/workspaces/).', 'security.md, the link to the workspaces guide'],
  ["| `422` | `VALIDATION_FAILED`, `details.reason: \"IS_WORKSPACE_FILE\"` | The file sent to `/apps/upload` is a workspace file. Send it to `/apps/upload-workspace`. |", "errors.md: the workspace-file and workspace codes"],
  ["### Workspace files", "errors.md: the workspace-file and workspace codes"],
  ["installing (`POST /apps/workspace/:id/install`) a [workspace file](/guides/workspaces/files/)", "errors.md: the workspace-file and workspace codes"],
  ["| `422` | `WORKSPACE_SAVE_TOO_MANY` | More than eight databases: a workspace file holds at most eight apps. |", "errors.md: the workspace-file and workspace codes"],
  ["| `422` | `WORKSPACE_SAVE_NOT_MEMBER` | A database named is not in this workspace. |", "errors.md: the workspace-file and workspace codes"],
  ["| `409` | `WORKSPACE_FILE_CHANGED` | Download again could not make the same bytes as the file that was saved. Save the workspace again. |", "errors.md: the workspace-file and workspace codes"],
  ["| `422` | `WORKSPACE_FILE_MISSING` | The upload carries no `workspace.json`: it is not a workspace file. |", "errors.md: the workspace-file and workspace codes"],
  ["| `422` | `WORKSPACE_FILE_NESTED` | An app inside is itself a workspace file. |", "errors.md: the workspace-file and workspace codes"],
  ["| `403` | `WORKSPACE_CHOICE_NOT_YOURS` | Creating or adding to a workspace, by someone who may not manage connections. Install with `\"workspace\": { \"mode\": \"none\" }`. |", "errors.md: the workspace-file and workspace codes"],
  ["| `409` | `WORKSPACE_NAME_TAKEN` (code `UNIQUE_VIOLATION`) | A workspace already has the name the file would create. Add to it instead. |", "errors.md: the workspace-file and workspace codes"],
  ["### Workspaces and their senders", "errors.md: the workspace-file and workspace codes"],
  ["| `409` | `UNIQUE_VIOLATION` | A workspace already has that name. |", "errors.md: the workspace-file and workspace codes"],
  ["| `404` | `NOT_FOUND` | The workspace is not there, or the caller cannot see it. A list's `?workspaceId=` answers the same, so it never tells a hidden workspace from a missing one. |", "errors.md: the workspace-file and workspace codes"],
  ["| `422` | `VALIDATION_FAILED`, `details.code: \"not-a-sending-domain\"` | A workspace sender's From address is not one this server's mail settings can send for. `details.domains` and `details.addresses` list where it can. |", "errors.md: the workspace-file and workspace codes"],
  ["| `422` | `VALIDATION_FAILED`, `details.code: \"no-mail\"` | The server has no mail set up yet, so no workspace can have a sender. |", "errors.md: the workspace-file and workspace codes"],
  ["| `workspaces` | no | Up to 32 names of the [workspaces](/guides/workspaces/) its database was in. Shown as names only. |", "manifest.md: provenance names the source database’s workspaces"],
  ['A mail sender per workspace', 'kb/articles.ts: the Knowledge Base article on a workspace’s mail sender'],
  ['Give each workspace its own sender name, From address and postal address, and choose who a template sends as.', 'kb/articles.ts: the Knowledge Base article on a workspace’s mail sender'],
  ['Workspace files', 'kb/articles.ts: the Knowledge Base article on workspace files'],
  ['Save every database of a workspace as one file, install it on another server, and finish an install that stopped.', 'kb/articles.ts: the Knowledge Base article on workspace files'],
  ['Group a server’s databases into workspaces, one per business, and choose how the menu shows them.', 'kb/articles.ts: the Knowledge Base article on workspaces'],
]);

// ─── What counts as words ────────────────────────────────────────────────────

/** A source literal that is words, not code, and says "workspace". */
function isWorkspaceWords(text: string): boolean {
  if (!WORD.test(text)) return false;
  return /\s/.test(text) || /\bWorkspaces?\b/.test(text);
}

interface Hit {
  /** `path:line` or `ns:key`. */
  site: string;
  text: string;
  /** Repo-relative file. */
  file: string;
}

function* filesUnder(dir: string, match: RegExp): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'out') continue;
      yield* filesUnder(full, match);
    } else if (match.test(entry.name) && !/\.(test|stories)\.tsx?$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
      yield full;
    }
  }
}

/** Every string literal, template piece and JSX text in a source file that is words about "workspace". */
function sourceHits(file: string, text: string = readFileSync(file, 'utf8')): Hit[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const rel = relative(repoRoot, file);
  const out: Hit[] = [];
  const push = (node: ts.Node, value: string): void => {
    if (!isWorkspaceWords(value)) return;
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    out.push({ site: `${rel}:${line + 1}`, text: value.trim(), file: rel });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const parent = node.parent;
      const isName = (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) && parent.name === node;
      const isModule = ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent);
      if (!isName && !isModule) push(node, node.text);
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      push(node, node.text);
    } else if (ts.isJsxText(node)) {
      push(node, node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** Markdown prose: fenced blocks and inline code are code. */
function markdownHits(rel: string, text: string): Hit[] {
  const out: Hit[] = [];
  let fenced = false;
  text.split('\n').forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const prose = line.replace(/`[^`]*`/g, '');
    if (WORD.test(prose)) out.push({ site: `${rel}:${index + 1}`, text: line.trim(), file: rel });
  });
  return out;
}

function htmlHits(rel: string, text: string): Hit[] {
  const stripped = text.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '));
  return stripped
    .split('\n')
    .flatMap((line, index) => (WORD.test(line) ? [{ site: `${rel}:${index + 1}`, text: line.trim(), file: rel }] : []));
}

function catalogueHits(): { hits: Hit[]; files: number } {
  const dir = join(repoRoot, 'packages/i18n/locales/en-US');
  const out: Hit[] = [];
  const walk = (node: unknown, ns: string, path: string[]): void => {
    if (typeof node === 'string') {
      if (WORD.test(node)) out.push({ site: `${ns}:${path.join('.')}`, text: node, file: `packages/i18n/locales/en-US/${ns}.json` });
    } else if (node !== null && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) walk(child, ns, [...path, key]);
    }
  };
  const names = readdirSync(dir).filter((file) => file.endsWith('.json')).sort();
  for (const name of names) walk(JSON.parse(readFileSync(join(dir, name), 'utf8')), name.slice(0, -'.json'.length), []);
  return { hits: out, files: names.length };
}

const SOURCE_ROOTS = ['apps/dashboard/src', 'apps/server/src', 'apps/desktop/src'] as const;
const PROSE_ROOTS = ['skills', 'apps/docs/src/content/docs'] as const;

function scan(): { hits: Hit[]; scanned: Record<string, number> } {
  const hits: Hit[] = [];
  const scanned: Record<string, number> = {};
  for (const root of SOURCE_ROOTS) {
    let n = 0;
    for (const file of filesUnder(join(repoRoot, root), /\.tsx?$/)) {
      n += 1;
      hits.push(...sourceHits(file));
    }
    for (const file of filesUnder(join(repoRoot, root), /\.html$/)) {
      n += 1;
      hits.push(...htmlHits(relative(repoRoot, file), readFileSync(file, 'utf8')));
    }
    scanned[root] = n;
  }
  for (const root of PROSE_ROOTS) {
    let n = 0;
    for (const file of filesUnder(join(repoRoot, root), /\.mdx?$/)) {
      n += 1;
      hits.push(...markdownHits(relative(repoRoot, file), readFileSync(file, 'utf8')));
    }
    scanned[root] = n;
  }
  const catalogue = catalogueHits();
  scanned['packages/i18n/locales/en-US'] = catalogue.files;
  return { hits: [...hits, ...catalogue.hits], scanned };
}

const allowedBy = (hit: Hit): string | null => {
  if (GROUP_KEYS.has(hit.site)) return `key ${hit.site}`;
  for (const prefix of GROUP_FILES.keys()) if (hit.file.startsWith(prefix)) return `file ${prefix}`;
  if (GROUP_STRINGS.has(hit.text)) return `string ${hit.text}`;
  return null;
};

describe('what counts as words', () => {
  it('a sentence or a capital W is words; a key, a slug, a path or a column is code', () => {
    expect(isWorkspaceWords('Ask a workspace admin')).toBe(true);
    expect(isWorkspaceWords('Workspace')).toBe(true);
    expect(isWorkspaceWords('Workspace-wide defaults')).toBe(true);
    expect(isWorkspaceWords('workspace')).toBe(false);
    expect(isWorkspaceWords('workspace-defaults')).toBe(false);
    expect(isWorkspaceWords('/api/v1/settings/workspace')).toBe(false);
    expect(isWorkspaceWords('adminium_workspaces')).toBe(false);
    expect(isWorkspaceWords('ui.workspaceView')).toBe(false);
  });

  it('reads fallbacks, templates and JSX text, and skips property names, imports and comments', () => {
    const file = join(repoRoot, 'apps/dashboard/src/planted.tsx');
    const code = [
      "import { x } from './workspace thing.js';",
      '// This workspace is a comment.',
      "const a = t('k', 'Ask a workspace admin');",
      'const b = `${n} files in this workspace`;',
      "const c = { 'POST /api/v1/workspaces': 1, workspace: 'Pages' };",
      'const d = <p>Your workspace is ready</p>;',
    ].join('\n');
    expect(sourceHits(file, code).map((hit) => hit.site)).toEqual([
      'apps/dashboard/src/planted.tsx:3',
      'apps/dashboard/src/planted.tsx:4',
      'apps/dashboard/src/planted.tsx:6',
    ]);
  });

  it('reads markdown prose, not its code', () => {
    const md = ['The `workspace` group.', '```json', '{ "group": "workspace" }', '```', 'Open Workspace settings.'].join('\n');
    expect(markdownHits('x.md', md).map((hit) => hit.site)).toEqual(['x.md:5']);
  });
});

describe('"workspace" means the group of databases, and nothing else', () => {
  const { hits, scanned } = scan();

  it('the scan reaches every tree', () => {
    for (const root of [...SOURCE_ROOTS, ...PROSE_ROOTS]) {
      expect(existsSync(join(repoRoot, root)), `${root} is not on disk`).toBe(true);
    }
    // Files read per tree (2026-11-06: 825, 1052, 49, 1037, 122, 22). A collapsed
    // count means the scan broke, not that the product got cleaner.
    expect(scanned['apps/dashboard/src']).toBeGreaterThan(700);
    expect(scanned['apps/server/src']).toBeGreaterThan(900);
    expect(scanned['apps/desktop/src']).toBeGreaterThan(30);
    expect(scanned['skills']).toBeGreaterThan(900);
    expect(scanned['apps/docs/src/content/docs']).toBeGreaterThan(100);
    expect(scanned['packages/i18n/locales/en-US']).toBeGreaterThan(20);
  });

  it('no product string uses "workspace" for the whole server', () => {
    const stray = hits.filter((hit) => allowedBy(hit) === null);
    expect(
      stray.map((hit) => `${hit.site}  ${hit.text.slice(0, 140)}`),
      'These say "workspace". The word now means a named group of databases. If one means the whole ' +
        'server, say "server". If it really is about the groups, add it to the allow-list in this file ' +
        'with the reason.',
    ).toEqual([]);
  });

  it('every allow-list entry still matches something', () => {
    const used = new Set(hits.map(allowedBy).filter((why): why is string => why !== null));
    const stale = [
      ...[...GROUP_KEYS.keys()].map((key) => `key ${key}`),
      ...[...GROUP_FILES.keys()].map((prefix) => `file ${prefix}`),
      ...[...GROUP_STRINGS.keys()].map((text) => `string ${text}`),
    ].filter((entry) => !used.has(entry));
    expect(stale, 'remove allow-list entries that no longer match anything').toEqual([]);
  });
});
