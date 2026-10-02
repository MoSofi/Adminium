// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the Designer's model is told, and how a long session is made to fit.
 *
 * The model is given the same skills a coding agent reads (one body of
 * knowledge), the entry skill and the one for what it is building, with
 * their indexes; the references themselves it reads on demand, never whole.
 * Then the app as the engine sees it now: the manifest in short, the files,
 * the last check.
 *
 * When the conversation grows past what the model can take, old tool results
 * are cut first, then whole old turns are folded into one line each. The
 * person's first message always stays, and a tool call never loses its
 * answer (a provider refuses a transcript like that).
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { ASSISTANT_INPUT_TOKEN_LIMIT, estimateTokens, ProviderError, type ProviderId, type RunBlock, type RunMessage } from '@adminium/llm';

import { checkApp, accessInWords } from '../project/apps/check-app.js';
import { APPS_DIR } from '../project/apps/read-app.js';
import type { DesignerSession } from './session-store.js';
import type { Skills } from './skills.js';

/** The output a turn's step may use. A step writes a file or two, not a book. */
export const DESIGNER_MAX_OUTPUT_TOKENS = 8000;
/** Room kept for what the estimate gets wrong. */
const SLACK_TOKENS = 2000;
/** How much of an old tool result is kept once it is cut. */
const CUT_TO = 300;

const PREAMBLE = `You are Adminium Designer. You build an app on Adminium for the person you are talking to, by writing its files.

How it works:
- The app is the folder apps/<key>/ in the person's project. Its manifest is written as small part files under apps/<key>/manifest/ (app.json, tables/<ref>.json, pages/<ref>.json, roles.json, access.json, …). Screens for staff and for customers, when the app has them, are in apps/<key>/staff/ and apps/<key>/customer/. Server logic is in the project's hooks/ and actions/.
- The engine is the judge. You write files; check_app says whether they are right, and apply_app puts the app on the person's server. Never say something works until check_app has no errors and apply_app has applied it.
- You can only use the tools you are given. There is no shell and no web. Read a skill reference with read_reference when you need a fact: never invent a manifest field, a route or an option.
- Pick the lowest rung that answers the request, and say which: tables and dashboard pages; then screens for staff; then public screens for customers. A plain website with no data to manage needs no Adminium: say so.
- Ask with ask_person only when the answer changes what you build. Otherwise choose, and say what you chose.
- The app is in English. Other languages only when the person asks.
- A screen needs react and react-dom in the project. If the build says they cannot be found, ask for them with request_package (react 19.2.0 and react-dom 19.2.0), and for @adminiumjs/public-client at the version the build names when a customer screen needs it.
- Keep the app's key as it is. Never put a build command in app.json.

End every turn the same way: check_app, fix every error it names, apply_app, then tell the person in a few plain sentences what you built and what they can do next. Do not list files.`;

/** How the verbs of the skills map to the tools here. */
const VERBS = `In these skills, the verbs map to your tools: **check** → check_app; **build** → build_sides; **run** (the app on the server, as \`adminium dev\` does) → apply_app; reading a reference → read_reference with the file's name as an INDEX.md lists it (e.g. "adminium-app/references/manifest/overview.md"). **new**, **try** and **pack** are not yours: the app already exists, and the person's server runs it.`;

export interface PromptDeps {
  root: string;
  version: string;
  skills: Skills;
  /** The provider a session's connection calls, for the size of its window. */
  providerOf(session: DesignerSession): Promise<ProviderId>;
}

/** A skill file, or nothing. */
const skill = (skills: Skills, name: string): string => {
  const text = skills.read(name);
  return text === null ? '' : `\n\n===== ${name} =====\n${text.replace(/^---\n[\s\S]*?\n---\n/, '')}`;
};

/** The skills a request needs: always the entry and the app skill; screens and add-ons when they are in play. */
export function skillsFor(session: DesignerSession, opts: { hasSides: boolean; mentionsAddOn: boolean }): string[] {
  const names = ['adminium/SKILL.md', 'adminium-app/SKILL.md', 'adminium-app/references/INDEX.md'];
  if (session.target === 'web' || opts.hasSides) names.push('adminium-surface/SKILL.md', 'adminium-surface/references/INDEX.md');
  if (opts.mentionsAddOn) names.push('adminium-add-ons/SKILL.md', 'adminium-add-ons/references/INDEX.md');
  return names;
}

/** The app as the engine sees it, in short. */
export function appNow(root: string, version: string, appKey: string): { text: string; hasSides: boolean } {
  const check = checkApp(root, appKey, { version });
  const lines: string[] = [`The app: key "${appKey}" (folder apps/${appKey}/).`];
  const manifest = check.manifest;
  if (manifest !== null && manifest.kind === 'app') {
    lines.push(`Name: ${typeof manifest.name === 'string' ? manifest.name : JSON.stringify(manifest.name)}. Version ${manifest.version}.`);
    for (const table of manifest.requiredSchema?.tables ?? []) {
      lines.push(`Table ${table.ref}: ${table.columns.map((column) => `${column.ref} ${column.type}${'role' in column && column.role !== undefined ? ` (${String(column.role)})` : ''}`).join(', ')}`);
    }
    for (const page of manifest.pages ?? []) lines.push(`Page ${page.ref}: ${page.template} over ${Object.values(page.bindings ?? {}).join(', ')}`);
    for (const role of manifest.roles ?? []) lines.push(`Role ${role.key}`);
    for (const sentence of accessInWords(manifest)) lines.push(`Customers may: ${sentence}`);
    for (const addOn of manifest.addOns?.requires ?? []) lines.push(`Requires the add-on ${addOn.key} ${addOn.range ?? ''}`.trim());
  }
  let summary = lines.join('\n');
  if (summary.length > 6000) summary = `${summary.slice(0, 6000)}\n… (more; read the files)`;

  const files: string[] = [];
  const walk = (folder: string): void => {
    if (!existsSync(folder)) return;
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= 200 || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(`${relative(root, path).split(sep).join('/')} (${String(statSync(path).size)})`);
    }
  };
  for (const folder of [join(root, APPS_DIR, appKey), join(root, 'hooks'), join(root, 'actions')]) walk(folder);

  const errors = check.findings.filter((finding) => finding.level === 'error');
  const checked =
    errors.length === 0
      ? 'The last check: no errors.'
      : `The last check: ${String(errors.length)} error(s):\n${errors
          .slice(0, 20)
          .map((finding) => `- ${finding.file} · ${finding.path} · ${finding.message}`)
          .join('\n')}`;
  return {
    text: `${summary}\n\nFiles:\n${files.join('\n') || '(none)'}\n\n${checked}`,
    hasSides: check.sides.length > 0,
  };
}

const tokensOf = (messages: readonly RunMessage[]): number => estimateTokens(JSON.stringify(messages));

/** The first text of a message. */
const firstText = (message: RunMessage | undefined): string =>
  (message?.content.find((block): block is Extract<RunBlock, { type: 'text' }> => block.type === 'text')?.text ?? '').trim();

/**
 * Fit a transcript into `budget` tokens. Steps, in order, until it fits:
 * old tool results cut short; then the oldest turns folded into one line.
 */
export function trimTranscript(messages: readonly RunMessage[], budget: number): RunMessage[] {
  if (tokensOf(messages) <= budget) return [...messages];

  // Where each turn starts: a user message that carries words and no results.
  const starts = messages.flatMap((message, index) =>
    message.role === 'user' && message.content.some((block) => block.type === 'text') && !message.content.some((block) => block.type === 'tool_result') ? [index] : [],
  );
  const lastTwo = starts.length >= 2 ? (starts[starts.length - 2] as number) : 0;

  // 1. Tool results older than the last two turns, cut short.
  let out: RunMessage[] = messages.map((message, index) =>
    index >= lastTwo || message.role !== 'user'
      ? message
      : {
          ...message,
          content: message.content.map((block) =>
            block.type === 'tool_result' && block.content.length > CUT_TO ? { ...block, content: `${block.content.slice(0, CUT_TO)} … (cut)` } : block,
          ),
        },
  );
  if (tokensOf(out) <= budget) return out;

  // 2. Whole old turns, folded: "Earlier: <asked> → <the answer's last words>". The first message stays as it is.
  const first = out[0] as RunMessage;
  for (let keepFrom = 1; keepFrom < starts.length; keepFrom += 1) {
    const cutAt = starts[keepFrom] as number;
    const folded: string[] = [];
    for (let turn = 0; turn < keepFrom; turn += 1) {
      const from = starts[turn] as number;
      const to = (starts[turn + 1] ?? out.length) as number;
      const asked = firstText(out[from]).slice(0, 300);
      const answered = [...out.slice(from, to)].reverse().find((message) => message.role === 'assistant' && firstText(message) !== '');
      folded.push(`Earlier: ${asked} → ${firstText(answered).split('\n').pop()?.slice(0, 300) ?? '(no words)'}`);
    }
    const head: RunMessage[] = starts[0] === 0 ? [first] : [];
    const summary: RunMessage = { role: 'assistant', content: [{ type: 'text', text: folded.join('\n') }] };
    const candidate = [...head, summary, ...out.slice(cutAt)];
    if (tokensOf(candidate) <= budget || keepFrom === starts.length - 1) {
      out = candidate;
      break;
    }
  }
  return out;
}

export function createPrompt(deps: PromptDeps) {
  return async (session: DesignerSession, messages: RunMessage[]): Promise<{ system: string; messages: RunMessage[] }> => {
    const provider = await deps.providerOf(session);
    const app = appNow(deps.root, deps.version, session.appKey);
    const said = messages.flatMap((message) => (message.role === 'user' ? [firstText(message)] : [])).join(' ');
    const names = skillsFor(session, { hasSides: app.hasSides, mentionsAddOn: /add-?on|invoice|receipt/i.test(said) });
    const target =
      session.target === 'dashboard'
        ? 'The person asked for a dashboard only: tables and pages, no screens of its own.'
        : session.target === 'web'
          ? 'The person asked for screens on the web: a staff side, a customer side, or both, as the request needs.'
          : 'The person left the kind of app to you: pick the lowest rung that answers the request.';
    const system = `${PREAMBLE}\n\n${VERBS}\n\n${target}${names.map((name) => skill(deps.skills, name)).join('')}\n\n===== The app now =====\n${app.text}`;

    // The limit is what a request may carry; the reply has its own room beyond it.
    const limit = ASSISTANT_INPUT_TOKEN_LIMIT[provider];
    const budget = limit - SLACK_TOKENS - estimateTokens(system);
    if (budget < 2000) {
      throw new ProviderError({
        provider,
        code: 'config',
        message: `${provider}: this model's window is too small to build with (what it must be told takes most of the ${String(limit)} tokens it reads).`,
      });
    }
    return { system, messages: trimTranscript(messages, budget) };
  };
}
