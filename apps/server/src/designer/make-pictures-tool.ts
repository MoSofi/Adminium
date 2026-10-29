// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `make_pictures`: the Designer's chat makes pictures with AI itself, for a
 * spot, for a table's sample rows, or one for each group of them, and puts
 * them in place.
 *
 * It spends the person's money without a click, so everything that holds the
 * dialog holds it too, and more: the service an `llm.run` holder chose (none
 * chosen, nothing made); the person's and everybody's day; a count a turn may
 * make (`designer.pictures.perTurn`); and a switch, `designer.pictures.chat`,
 * that turns it off while the dialog's Make stays. It runs the dialog's own
 * job (`picture-jobs.ts`): counted the same, kept on disk the same, credited
 * "Made with AI" the same.
 *
 * It saves no version of its own: the turn's version holds the pictures.
 * Stop ends the turn at once; the job goes on to the end, and what it made
 * waits in the dialog's "Made earlier", unapplied. What the page shows is
 * the job's own `picture-make` event, in the turn's log: it asks nothing of
 * the person, so it is a line under the reply, not a card.
 */
import { randomBytes } from 'node:crypto';

import type { PictureDialog } from './picture-dialog.js';
import type { MakeTarget, PictureJobs, StartAnswer } from './picture-jobs.js';
import { prepareFills, writeFills, type Fill } from './pictures-apply.js';
import type { PicturesView } from './service.js';
import type { DesignerTool, ToolContext, ToolOutcome } from './tool-types.js';
import { plainWords, quoted } from './untrusted.js';

export interface MakePicturesDeps {
  root: string;
  version: string;
  jobs: PictureJobs;
  dialog: PictureDialog;
  /** What the picture dialog shows for the session's app: its spots, rows, groups, and the words each starts from. */
  picturesOf: (sessionId: string) => PicturesView;
  settings: () => Promise<{ chat: boolean; perTurn: number }>;
  ownBuild: (appKey: string) => boolean;
  reseed?: ((appKey: string) => void) | undefined;
}

/** The most lines one call makes: the dialog's batch. */
const LINES_MAX = 12;

/** Why nothing was asked, for the model, and what to tell the person. */
function refusalFor(answer: Exclude<StartAnswer, { state: 'accepted' }>): string {
  switch (answer.state) {
    case 'none':
      return 'No picture service is chosen. Tell the person they can choose one in the Pictures dialog (Make one tab), or ask whoever manages AI settings.';
    case 'changed':
      return 'The picture service changed since it was chosen. Tell the person to choose it again in the Pictures dialog.';
    case 'model-gone':
      return 'The chosen picture model is no longer offered. Tell the person to choose another in the Pictures dialog.';
    case 'not-here':
      return 'The chosen service does not make pictures. Tell the person to choose another in the Pictures dialog.';
    case 'off':
      return 'This server calls no outside service now, so no picture can be made.';
    case 'switched-off':
      return 'Making pictures is switched off on this server.';
    case 'allowance':
      return `The day’s pictures are used up (${String(Math.min(answer.left.mine, answer.left.all))} left). Tell the person; they can be made again tomorrow.`;
    case 'busy':
      return 'Pictures are already being made for this person. Wait for those, or tell the person they will be in the Pictures dialog’s Made earlier.';
    case 'full':
      return 'This session holds as many made pictures as it can. Tell the person to apply or leave the ones in the Pictures dialog first.';
  }
}

export function makePicturesTool(deps: MakePicturesDeps, appKey: string): DesignerTool {
  /** Pictures asked for in each turn, by session and turn: `perTurn` is a turn's share. */
  const used = new Map<string, number>();
  const refused = (content: string): ToolOutcome => ({ content, label: 'No pictures were made', isError: true, facts: { outcome: 'refused' } });
  return {
    name: 'make_pictures',
    description:
      'Make pictures with AI and put them in place, charged to the account of the picture service the person chose. Only when the person asked for pictures or said yes to your suggestion, and ask first before more than 4. "for": "spot" with "spot" (its id), or "for": "rows" with "table" and either "groupBy" (a column: one picture for each of its values, shared by its rows, best for things sold) or "rows" (row numbers from 1; left out, all). "words": what the picture shows, in English, short (for rows, an object by row name or group value; left out, the dialog’s own words). Never a logo, a real person or a real brand.',
    inputSchema: {
      type: 'object',
      properties: {
        for: { type: 'string', enum: ['spot', 'rows'] },
        spot: { type: 'string' },
        table: { type: 'string' },
        groupBy: { type: 'string' },
        rows: { type: 'array', items: { type: 'integer', minimum: 1 }, maxItems: LINES_MAX },
        words: { description: 'A string for a spot; an object by row name or group value for rows' },
      },
      required: ['for'],
      additionalProperties: false,
    },
    running: () => 'Making pictures',
    subject: (input) => (typeof input['spot'] === 'string' ? input['spot'] : typeof input['table'] === 'string' ? input['table'] : undefined),
    async run(input, ctx: ToolContext) {
      const settings = await deps.settings();
      if (!settings.chat || settings.perTurn === 0) return refused('Making pictures in the chat is switched off here. Tell the person they can make pictures in the Pictures dialog (Make one tab).');
      if (deps.ownBuild(appKey)) return refused('This app is a copy of a published one and keeps its own pictures in src/.');
      const view = deps.picturesOf(ctx.session.id);
      const wordsOf = (given: unknown, fallback: string): string => {
        const own = typeof given === 'string' ? plainWords(given, 600) : '';
        return own === '' ? fallback : own;
      };
      /** Each line: what is made, and where each picture goes. */
      const lines: { words: string; target: MakeTarget; fills: Omit<Fill, 'from'>[] }[] = [];
      let shape: 'wide' | 'tall' | 'square' = 'square';
      if (input['for'] === 'spot') {
        const spot = view.spots.find((one) => one.id === input['spot']);
        if (spot === undefined) return refused(`There is no spot ${quoted(String(input['spot'] ?? ''), 40)}. Its ids: ${view.spots.map((one) => one.id).join(', ') || 'none yet (name them with add_spots)'}.`);
        shape = spot.shape;
        lines.push({ words: wordsOf(input['words'], spot.words), target: { spot: spot.id }, fills: [{ spot: spot.id, version: spot.version }] });
      } else {
        const table = view.tables.find((one) => one.table === input['table']);
        if (table === undefined) return refused(`No table ${quoted(String(input['table'] ?? ''), 60)} takes a picture on its sample rows. Those that do: ${view.tables.map((one) => one.table).join(', ') || 'none'}.`);
        const given = (input['words'] !== null && typeof input['words'] === 'object' ? input['words'] : {}) as Record<string, unknown>;
        if (typeof input['groupBy'] === 'string') {
          const group = table.groups.find((one) => one.column === input['groupBy']);
          if (group === undefined) return refused(`"${table.table}" has no column to group its rows by called ${quoted(String(input['groupBy']), 60)}. Those it has: ${table.groups.map((one) => one.column).join(', ') || 'none (make one for each row)'}.`);
          for (const value of group.values) {
            const fills = value.rows.flatMap((row) => {
              const at = table.rows.find((one) => one.row === row);
              return at === undefined ? [] : [{ row: { table: table.table, row }, version: at.version }];
            });
            // A table of people never takes the model's words for a row: they may name someone.
            lines.push({ words: table.people ? value.words : wordsOf(given[value.value], value.words), target: { table: table.table, column: group.column, value: value.value }, fills });
          }
        } else {
          const wanted = Array.isArray(input['rows']) ? new Set((input['rows'] as unknown[]).filter((row): row is number => Number.isInteger(row))) : null;
          for (const row of table.rows) {
            if (wanted !== null && !wanted.has(row.row)) continue;
            lines.push({ words: table.people ? row.words : wordsOf(given[row.label], row.words), target: { table: table.table, row: row.row }, fills: [{ row: { table: table.table, row: row.row }, version: row.version }] });
          }
        }
      }
      if (lines.length === 0) return refused('Nothing to make a picture for.');
      const key = `${ctx.session.id}:${String(ctx.turn)}`;
      const already = used.get(key) ?? 0;
      const room = Math.min(LINES_MAX, settings.perTurn - already);
      if (lines.length > room) {
        return refused(`This turn may make ${String(Math.max(0, room))} more picture(s) and this asks for ${String(lines.length)}. Ask the person, or make fewer (one for each group costs less than one for each row).`);
      }

      const answer = await deps.jobs.start(
        ctx.session,
        ctx.handle.by,
        { id: `chat-${randomBytes(8).toString('hex')}`, lines: lines.map((line) => ({ words: line.words, target: line.target })), shape, count: 1 },
        { quiet: true },
      );
      if (answer.state !== 'accepted') return refused(refusalFor(answer));
      used.set(key, already + lines.length);

      // Stop ends the turn now; the job goes on, and its pictures wait in Made earlier.
      const stopped = new Promise<'stopped'>((resolve) => {
        if (ctx.signal.aborted) resolve('stopped');
        ctx.signal.addEventListener('abort', () => resolve('stopped'), { once: true });
      });
      const ended = await Promise.race([deps.jobs.settled(answer.job.job).then(() => 'done' as const), stopped]);
      if (ended === 'stopped') return refused('Stopped. The pictures already asked for will be in the Pictures dialog’s Made earlier.');
      const job = (await deps.jobs.get(ctx.session.id, answer.job.job)) ?? answer.job;

      const fills: Fill[] = job.lines.flatMap((line, index) => {
        const picture = line.pictures[0];
        const subject = (lines[index]?.words.split(',')[0] ?? '').trim();
        return picture === undefined ? [] : (lines[index]?.fills ?? []).map((fill): Fill => ({ ...fill, from: { shelf: picture.shelf, picture: picture.id }, alt: subject }));
      });
      let placed: string[] = [];
      if (fills.length > 0) {
        const prepared = await prepareFills(fills, { root: deps.root, key: appKey, sessionId: ctx.session.id, dialog: deps.dialog, signal: ctx.signal });
        const written = await writeFills(prepared.ready, { root: deps.root, key: appKey, version: deps.version, by: ctx.handle.by });
        placed = written.names;
        if (written.rows) deps.reseed?.(appKey);
      }
      ctx.handle.events.emit(ctx.turn, { kind: 'picture-make', job });

      const made = job.lines.reduce((sum, line) => sum + line.made, 0);
      const notMade = job.lines.filter((line) => line.made === 0).map((line) => `${quoted(line.name, 60)} (${line.code === 'refused' ? 'the service refused it' : line.state === 'gone' ? 'it changed meanwhile' : 'it failed'})`);
      if (made === 0) return refused(`No picture was made: ${notMade.join('; ')}. Say so to the person in one sentence.`);
      return {
        content: `Made ${String(made)} picture(s) with ${job.label} · ${job.model} and put them in place: ${placed.map((name) => quoted(name, 60)).join(', ')}. Spots draw them with <Picture spot="…" />; sample rows show them once the app is applied.${notMade.length === 0 ? '' : ` Not made: ${notMade.join('; ')}.`} Tell the person these are made-up pictures to replace with their own photos before they open.`,
        label: `Made ${String(made)} pictures`,
        facts: { outcome: 'added', count: made },
      };
    },
  };
}
