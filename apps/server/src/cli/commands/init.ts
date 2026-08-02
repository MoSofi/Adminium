/**
 * `adminium` (no args) — the interactive setup wizard.
 *
 * Mirrors the Studio connect flow (`apps/dashboard/src/studio/connect/wizardState.ts`
 * `WIZARD_STEP_IDS`: intent → source → test → tables → meta → enrich → generate)
 * and, per the M10 risk mitigation, drives it through the SAME services the
 * Studio routes call — `manager.testDsn`, `manager.connections.create`,
 * `runIntrospection`, `runGeneration`. One code path, two front doors.
 *
 * ── THE FIRST QUESTION IS WHICH FRONT DOOR ──────────────────────────────────
 * Both doors were always built; only one was reachable from `npx`. The Docker
 * quickstart tells people to open `localhost:4600` and finish in the Studio
 * wizard, while `npx @adminiumjs/adminium` dropped them into a terminal
 * questionnaire with no hint that the graphical version of the same seven steps
 * existed. So the wizard now opens by ASKING, and browser mode boots straight
 * to the Studio wizard without asking anything else in the terminal — including
 * the meta-store question, which the Studio's own `meta` step covers.
 *
 * ── WHERE THE TERMINAL PATH DEPARTS FROM THE STUDIO'S STEP ORDER, AND WHY ────
 * The Studio asks about meta-store PLACEMENT at step 5, after tables. It can:
 * the Studio is already running, so a meta store already exists — its meta step
 * is about *where the store should live going forward*. The CLI has no such
 * luxury. Nothing can be persisted (not the connection row, not the snapshot the
 * tables step lists) until a meta store is open, so the wizard resolves meta
 * placement FIRST when nothing is configured. The §3.1 rule the meta step exists
 * to enforce — same-database placement against a read-only or DDL-less role is
 * refused (`META_PLACEMENT_INVALID`) — still runs at exactly the right moment:
 * `manager.enforceMetaPlacement`, right after the data-role probe, which is the
 * first instant both facts are known. The rule is honored; only the question's
 * position moves, because causality requires it. What the question is NOT
 * allowed to do is arrive as unexplained jargon, which is why it now leads with
 * a sentence naming the two databases it is distinguishing between.
 *
 * The `enrich` step is deliberately not prompted here: `generate-prompt` /
 * `apply-llm-response` are the CLI's LLM surface (06 §10.4) and the wizard points
 * at them rather than growing a copy-paste loop inside a readline prompt.
 */

import { GENERATE_INTENTS, type GenerateIntent } from '@adminium/engine';
import { firstRun } from '@adminium/meta';

import { readBootstrap, writeBootstrap } from '../../config/bootstrap.js';
import { runIntrospection } from '../../connections/introspect.js';
import { runGeneration } from '../../generate/run.js';
import type { ConnectionTestSummary } from '../../connections/manager.js';
import { MetaPlacementError } from '../../connections/dsn.js';
import { embeddedMetaWarning, metaEngineFromUrl, metaUrlCryptoFromSecret } from '../../meta/store.js';
import { boolFlag, numberFlag, parseFlags, stringFlag } from '../args.js';
import type { Command } from '../command.js';
import { CliError, EXIT_OK } from '../exit.js';
import type { CliIo, SelectChoice, Style } from '../io.js';
import { createStyle, supportsColor } from '../io.js';
import { loadCliEnv } from '../runtime.js';

/**
 * Engines the connect flow offers — the same three as the Studio picker's
 * `SOURCE_ENGINES` (`wizardState.ts`), and the same three the v1 build ships
 * adapters for (BRIEF §3).
 */
type SourceEngine = 'postgres' | 'mysql' | 'sqlite';

/**
 * Intent copy, split into a label and the trade-off beneath it.
 *
 * The old single strings ("Full admin — CRUD on everything, dashboards
 * included") had to carry both, so every row was a wall of prose the eye had to
 * parse before it could compare rows. The menu renders `hint` dimmed underneath,
 * which is what makes four options scannable.
 */
const INTENT_CHOICES: Readonly<Record<GenerateIntent, SelectChoice>> = {
  'full-admin': {
    label: 'Full admin panel',
    hint: 'CRUD on every table, plus dashboards. The usual choice.',
  },
  'read-only-analytics': {
    label: 'Read-only analytics',
    hint: 'Dashboards and browsing. No forms, no writes, every role capped at Viewer.',
  },
  crud: {
    label: 'Data entry',
    hint: 'One editing page per table, minimal dashboards.',
  },
  'support-console': {
    label: 'Support console',
    hint: 'Lookup-first — built around finding one record fast.',
  },
};

const DEFAULT_PORTS: Readonly<Record<SourceEngine, number>> = {
  postgres: 5432,
  mysql: 3306,
  sqlite: 0,
};

/** Worked examples, not grammars. See {@link askForDsn}. */
const DSN_EXAMPLE: Readonly<Record<'postgres' | 'mysql', string>> = {
  postgres: 'postgres://user:password@localhost:5432/mydb',
  mysql: 'mysql://user:password@localhost:3306/mydb',
};

/**
 * The one origin `--bridge` allows. Hard-coded rather than prompted: the flag's
 * whole meaning is "let the site I just came from finish the job", and an
 * origin the user can type is an origin a copy-pasted command can smuggle.
 * Anyone running their own marketing site sets `ADMINIUM_BRIDGE_ORIGINS` and
 * takes that decision knowingly.
 */
const BRIDGE_SITE = 'https://adminium.dev';

/** Compose a DSN from host/port/user/password/database — the Studio's `fields` mode. */
export function composeDsn(input: {
  engine: SourceEngine;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}): string {
  const auth =
    input.password === ''
      ? encodeURIComponent(input.user)
      : `${encodeURIComponent(input.user)}:${encodeURIComponent(input.password)}`;
  return `${input.engine}://${auth}@${input.host}:${String(input.port)}/${input.database}`;
}

/** Parse the tables step's answer: blank/`all` → everything, else a CSV subset. */
export function parseTableSelection(answer: string, available: readonly string[]): string[] {
  const trimmed = answer.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'all') return [...available];
  const wanted = trimmed
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const byLocalName = new Map<string, string>();
  for (const id of available) byLocalName.set(id.slice(id.lastIndexOf('.') + 1), id);
  const chosen: string[] = [];
  for (const entry of wanted) {
    const match = available.includes(entry) ? entry : byLocalName.get(entry);
    if (match !== undefined && !chosen.includes(match)) chosen.push(match);
  }
  return chosen;
}

/** Table ids from a stored snapshot model. */
function tableIds(schema: unknown): string[] {
  if (schema === null || typeof schema !== 'object') return [];
  const tables = (schema as { tables?: unknown }).tables;
  if (!Array.isArray(tables)) return [];
  return tables
    .map((table) => (table as { id?: unknown }).id)
    .filter((id): id is string => typeof id === 'string');
}

function describeProbe(summary: ConnectionTestSummary): string {
  const bits = [`${String(Math.round(summary.latencyMs))} ms`];
  if (summary.serverVersion !== null) bits.push(summary.serverVersion);
  if (summary.readOnly) bits.push('read-only role');
  return bits.join(' · ');
}

// ── meta placement ───────────────────────────────────────────────────────────

interface MetaChoice {
  /** `null` = keep the embedded SQLite fallback. */
  url: string | null;
  /** Persist the choice to `<dataDir>/adminium.json` (§7.2). */
  persist: boolean;
}

/**
 * Ask where the meta store lives — only when nothing already answers that
 * (env or bootstrap file). Returns the DSN to use, or null for embedded.
 *
 * The preamble is load-bearing. This question arrives before the user has told
 * us anything about their database, so without it "where should Adminium keep
 * its own data" reads as a question about the database they came here to
 * connect — the exact confusion that made this the wizard's worst step.
 */
async function askMetaPlacement(io: CliIo, dataDir: string): Promise<MetaChoice> {
  io.out('');
  io.out('Adminium keeps a little state of its own — your login, the generated page');
  io.out('layouts, saved settings. That is separate from the database you are about to');
  io.out('connect, which Adminium only ever reads.');

  const index = await io.select('Where should that state live?', [
    {
      label: `In a file, right here (${dataDir}/meta.db)`,
      hint: 'Nothing to set up. Right for trying Adminium out, or a single instance.',
    },
    {
      label: 'In a PostgreSQL or MySQL database I already run',
      hint: 'Right for production or several instances. You provide a connection string.',
    },
  ]);
  if (index === 0) return { url: null, persist: false };

  const url = await io.ask('Connection string for that database', {
    hint: `For example: ${DSN_EXAMPLE.postgres}`,
    validate: (answer) => {
      if (answer === '') return 'A connection string is required.';
      try {
        metaEngineFromUrl(answer);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
  });
  return { url, persist: true };
}

/**
 * Render the bridge pairing code, or nothing when the bridge is off.
 *
 * This terminal is the only place the code is ever displayed — it is not
 * logged, not written to disk, and not served by any route. That is the point:
 * possessing it proves the same person is at both the terminal and the web
 * page, which is the consent the cross-origin hand-off rests on.
 */
function printPairing(io: CliIo, style: Style, code: string | null): void {
  if (code === null) return;
  io.out('');
  io.out(`Pairing code for ${BRIDGE_SITE}:  ${style.bold(code)}`);
  io.out(
    style.dim('Type it there to hand this instance the connection string you pasted.'),
  );
  io.out(style.dim('It is valid until you stop Adminium, and only for that one site.'));
}

// ── front door ───────────────────────────────────────────────────────────────

type SetupSurface = 'browser' | 'terminal';

/**
 * Which front door to use. Flags win outright so scripts and docs can pin one;
 * otherwise ask, defaulting to the browser — it is the surface with the schema
 * preview, the per-table row counts and the enrich step, none of which fit in a
 * terminal. A terminal that cannot host a redrawing menu (a pipe, `TERM=dumb`,
 * CI) is not asked at all: the graphical path is strictly better there too.
 */
async function chooseSurface(
  io: CliIo,
  flags: { browser: boolean; terminal: boolean },
): Promise<SetupSurface> {
  if (flags.terminal) return 'terminal';
  if (flags.browser) return 'browser';

  const index = await io.select('How would you like to set this up?', [
    {
      label: 'In your browser',
      hint: 'Adminium starts, then walks you through it with a UI. Recommended.',
    },
    {
      label: 'Here in the terminal',
      hint: 'Same steps, no browser. Good over SSH.',
    },
  ]);
  return index === 0 ? 'browser' : 'terminal';
}

export const initCommand: Command = {
  name: 'init',
  summary: 'Interactive setup: connect a database and generate the app',
  usage: 'adminium [init] [--browser|--terminal] [--port <n>] [--host <addr>]',
  describe:
    'Walks through connecting a database and generating an admin app, then\n' +
    'starts the server. This is what `adminium` runs with no arguments.\n' +
    '\n' +
    'Asks first whether to continue in your browser (a UI, recommended) or\n' +
    'here in the terminal; --browser / --terminal skip that question.',
  flags: {
    browser: { type: 'boolean', describe: 'Set up in the browser, without asking' },
    terminal: { type: 'boolean', describe: 'Set up in the terminal, without asking' },
    'no-open': { type: 'boolean', describe: 'Do not launch a browser; just print the URL' },
    bridge: {
      type: 'boolean',
      describe: `Let ${BRIDGE_SITE} hand this instance a connection string`,
    },
    port: { type: 'string', short: 'p', placeholder: '<n>', describe: 'Port to listen on', defaultDescription: 'PORT or 4600' },
    host: { type: 'string', placeholder: '<addr>', describe: 'Address to bind', defaultDescription: 'HOST or 0.0.0.0' },
    'data-dir': { type: 'string', placeholder: '<path>', describe: 'Data directory' },
    'meta-url': { type: 'string', placeholder: '<dsn>', describe: 'Meta store DSN (skips the meta question)' },
    name: { type: 'string', placeholder: '<name>', describe: 'Connection name', defaultDescription: 'prompted' },
  },

  async run({ io, deps, argv }) {
    const { values } = parseFlags(argv, initCommand.flags, initCommand.name);
    const style = createStyle(supportsColor(deps.env));

    if (!io.isInteractive) {
      throw new CliError('The setup wizard needs an interactive terminal.', {
        hint: 'Non-interactive? Configure via environment and run `adminium start`.',
      });
    }

    const port = numberFlag(values.port, 'port', initCommand.name);
    const host = stringFlag(values.host);
    const dataDirFlag = stringFlag(values['data-dir']);
    const metaUrlFlag = stringFlag(values['meta-url']);
    const wantsBrowser = boolFlag(values.browser);
    const wantsTerminal = boolFlag(values.terminal);
    const noOpen = boolFlag(values['no-open']);
    // `--bridge` is the ONLY thing that opens the cross-origin door, and it
    // opens it for exactly one origin (see BRIDGE_SITE). An explicit
    // ADMINIUM_BRIDGE_ORIGINS in the environment still wins — someone running
    // their own site has made that decision deliberately.
    const bridgeOrigins =
      boolFlag(values.bridge) && deps.env.ADMINIUM_BRIDGE_ORIGINS === undefined
        ? BRIDGE_SITE
        : undefined;

    if (wantsBrowser && wantsTerminal) {
      throw new CliError('--browser and --terminal ask for opposite things.', {
        hint: 'Pass one, or neither to be asked.',
      });
    }

    // Fails fast and actionably when ADMINIUM_SECRET is absent — before a single
    // question, because nothing we collect could be stored without it.
    let env = loadCliEnv(deps.env, {
      ...(port === undefined ? {} : { port }),
      ...(host === undefined ? {} : { host }),
      ...(dataDirFlag === undefined ? {} : { dataDir: dataDirFlag }),
      ...(metaUrlFlag === undefined ? {} : { metaUrl: metaUrlFlag }),
      ...(bridgeOrigins === undefined ? {} : { bridgeOrigins }),
    });

    io.out(style.bold('Adminium setup'));
    io.out(style.dim('Connect a database, get an admin app. Ctrl-C to stop.'));

    const surface = await chooseSurface(io, {
      browser: wantsBrowser,
      terminal: wantsTerminal || !io.supportsTui,
    });

    // ── Step 0 — meta placement (see the module note on ordering) ───────────
    // Skipped entirely in browser mode: the Studio wizard owns a `meta` step,
    // and asking here would be the one terminal question a browser user never
    // agreed to answer.
    if (surface === 'terminal' && env.ADMINIUM_META_URL === undefined) {
      const existing = await readBootstrap(env.ADMINIUM_DATA_DIR);
      if (existing?.metaUrl === undefined) {
        const choice = await askMetaPlacement(io, env.ADMINIUM_DATA_DIR);
        if (choice.url !== null) {
          env = loadCliEnv(deps.env, {
            ...(port === undefined ? {} : { port }),
            ...(host === undefined ? {} : { host }),
            ...(dataDirFlag === undefined ? {} : { dataDir: dataDirFlag }),
            metaUrl: choice.url,
            ...(bridgeOrigins === undefined ? {} : { bridgeOrigins }),
          });
          if (choice.persist) {
            // §7.2: the meta DSN cannot live in the meta store itself, so it is
            // persisted here, AES-256-GCM-encrypted under ADMINIUM_SECRET.
            await writeBootstrap(env.ADMINIUM_DATA_DIR, {
              v: 1,
              metaUrl: metaUrlCryptoFromSecret(env.ADMINIUM_SECRET).encrypt(choice.url),
              createdAt: new Date().toISOString(),
              instanceId: crypto.randomUUID(),
            });
          }
        }
      }
    }

    const runtime = await deps.openRuntime(env, { blockLoopback: false });
    let started = false;
    try {
      if (runtime.metaStore.source === 'embedded') {
        io.err(embeddedMetaWarning(runtime.metaStore.url));
      }
      // `firstRun`, not `applyMigrations`: no migration seeds the built-in roles,
      // and without `super-admin` on disk the account this wizard tells the user
      // to create at the end cannot be created at all (see `start.ts`).
      const { appliedMigrations } = await firstRun(runtime.metaStore.meta);
      io.out(
        appliedMigrations.length === 0
          ? `Meta store ready (${runtime.metaStore.engine}).`
          : `Meta store ready (${runtime.metaStore.engine}) — ${String(appliedMigrations.length)} migration(s) applied.`,
      );

      if (surface === 'browser') {
        const server = await deps.startServer(runtime);
        started = true;
        io.out('');
        io.out(style.bold(`Adminium is running at ${server.url}`));
        if (noOpen) {
          io.out('Open that URL to continue.');
        } else {
          const opened = await deps.openBrowser(server.url);
          io.out(opened ? 'Opening it in your browser…' : `Open that URL to continue.`);
        }
        io.out('');
        io.out('The first screen creates your admin account. The one after it is the');
        io.out('connect wizard — paste your connection string there and Adminium reads');
        io.out('the schema, shows you the tables it found, and generates the pages.');
        printPairing(io, style, server.bridgePairingCode);
        io.out('');
        io.out(style.dim('Next time, skip straight to it with: adminium start'));
        io.out(style.dim('Prefer the terminal? adminium --terminal'));
        return EXIT_OK;
      }

      // ── Step 1 — intent ───────────────────────────────────────────────────
      const intentIndex = await io.select(
        'What is this admin panel for?',
        GENERATE_INTENTS.map((intent) => INTENT_CHOICES[intent]),
      );
      const intent = GENERATE_INTENTS[intentIndex] as GenerateIntent;

      // ── Step 2 — source ───────────────────────────────────────────────────
      const dsn = await askForDsn(io);

      // ── Step 3 — test (+ the §3.1 meta-placement rule) ────────────────────
      const engine = engineOfDsn(dsn);
      io.out('');
      io.out('Testing the connection…');
      const summary = await runtime.manager.testDsn(engine, dsn);
      if (!summary.ok) {
        throw new CliError(summary.error?.message ?? 'Could not connect to that database.', {
          ...(summary.error?.hint == null ? {} : { hint: summary.error.hint }),
        });
      }
      io.out(`${style.ok('Connected')} — ${describeProbe(summary)}`);

      // 01 §3.1: same-database meta placement against a read-only or DDL-less
      // role is refused here, in the manager, not merely in a wizard UI.
      try {
        runtime.manager.enforceMetaPlacement(dsn, summary);
      } catch (error) {
        if (error instanceof MetaPlacementError) {
          throw new CliError(error.message, {
            hint: 'Point ADMINIUM_META_URL at a separate database, or grant the role write + DDL.',
            cause: error,
          });
        }
        throw error;
      }

      const name =
        stringFlag(values.name) ?? (await io.ask('Name this connection', { default: 'primary' }));

      const connection = await runtime.manager.connections.create({
        name,
        engine,
        introspectDsn: dsn,
        dataDsn: dsn,
        settings: { intent },
      });
      io.out(`Created connection ${connection.id}.`);

      // ── Step 4 — introspect + tables ──────────────────────────────────────
      io.out('');
      io.out('Reading the schema (never your rows)…');
      const introspection = await runIntrospection({
        manager: runtime.manager,
        meta: runtime.metaStore.meta,
        connectionId: connection.id,
      });
      const available = tableIds(introspection.snapshot.schema);
      io.out(`Found ${String(available.length)} tables.`);
      if (introspection.proposedMasks > 0) {
        io.out(`Masked ${String(introspection.proposedMasks)} likely-PII column(s) by default.`);
      }

      const included = await askForTables(io, available);
      if (included.length !== available.length) {
        await runtime.manager.connections.update(connection.id, {
          settings: { ...connection.settings, intent, includedTables: included },
        });
        io.out(`Including ${String(included.length)} of ${String(available.length)} tables.`);
      }

      // ── Step 5 — generate ─────────────────────────────────────────────────
      io.out('');
      io.out('Generating pages…');
      const generated = await runGeneration({
        manager: runtime.manager,
        meta: runtime.metaStore.meta,
        connectionId: connection.id,
        intent,
      });
      io.out(
        `Generated ${String(generated.pages.length)} page(s) across ` +
          `${String(generated.navGroups.length)} nav group(s).`,
      );
      for (const warning of generated.warnings) io.err(`note: ${warning}`);

      // ── Step 6 — boot ─────────────────────────────────────────────────────
      const server = await deps.startServer(runtime);
      started = true;
      io.out('');
      io.out(style.bold(`Adminium is running at ${server.url}`));
      io.out('Open it to create your first admin account.');
      printPairing(io, style, server.bridgePairingCode);
      io.out('');
      io.out(style.dim('Next time, skip the wizard with: adminium start'));
      io.out(
        style.dim(`AI-enrich your schema: adminium generate-prompt --connection ${connection.id}`),
      );
      return EXIT_OK;
    } finally {
      await io.close();
      // The server owns the meta handle once it is listening; closing the
      // runtime here would pull the store out from under it.
      if (!started) await runtime.close();
    }
  },
};

/** `postgres://…` → `postgres`. The DSN grammar is validated by `guardDsn` downstream. */
function engineOfDsn(dsn: string): SourceEngine {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(dsn)?.[1]?.toLowerCase();
  switch (scheme) {
    case 'postgres':
    case 'postgresql':
      return 'postgres';
    case 'mysql':
    case 'mariadb':
      return 'mysql';
    case 'sqlite':
    case 'file':
      return 'sqlite';
    default:
      throw new CliError(`Unsupported database DSN "${dsn}".`, {
        hint: `Use one of:\n  ${DSN_EXAMPLE.postgres}\n  ${DSN_EXAMPLE.mysql}\n  sqlite:./app.db`,
      });
  }
}

/**
 * The source step: paste a DSN, fill in fields, or point at a SQLite file.
 *
 * Every prompt here shows a COMPLETE example rather than a grammar. The old
 * hints were shaped like `postgres://… or mysql://…`, which reads as a literal
 * template — and `…` is not a character on anyone's keyboard, so the one hint
 * meant to unblock people was itself a thing to decipher.
 */
async function askForDsn(io: CliIo): Promise<string> {
  const mode = await io.select('How do you want to connect?', [
    { label: 'Paste a connection string', hint: 'The quickest, if you have one to hand.' },
    { label: 'Type host, port, user, password, database', hint: 'The password stays hidden.' },
    { label: 'Point at a SQLite file', hint: 'A path to a .db / .sqlite file.' },
  ]);

  if (mode === 0) {
    return io.ask('Connection string', {
      hint: `For example: ${DSN_EXAMPLE.postgres}`,
      validate: (answer) => (answer === '' ? 'A connection string is required.' : null),
    });
  }

  if (mode === 2) {
    const path = await io.ask('Path to the SQLite file', {
      hint: 'For example: ./data/app.db',
      validate: (answer) => (answer === '' ? 'A file path is required.' : null),
    });
    return `sqlite:${path}`;
  }

  const engineIndex = await io.select('Which engine?', [
    { label: 'PostgreSQL' },
    { label: 'MySQL / MariaDB' },
  ]);
  const engine: SourceEngine = engineIndex === 0 ? 'postgres' : 'mysql';
  const host = await io.ask('Host', { default: 'localhost' });
  const port = Number(await io.ask('Port', { default: String(DEFAULT_PORTS[engine]) }));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new CliError(`"${String(port)}" is not a valid port.`);
  }
  const user = await io.ask('User');
  const password = await io.ask('Password', { mask: true });
  const database = await io.ask('Database');
  return composeDsn({ engine, host, port, user, password, database });
}

/**
 * The tables step. Everything is included unless the user narrows it — and the
 * narrowing is now behind a menu, so nobody has to guess that an empty line at a
 * free-text prompt meant "all of them".
 */
async function askForTables(io: CliIo, available: readonly string[]): Promise<string[]> {
  if (available.length === 0) return [];

  const mode = await io.select('Which tables should the admin panel cover?', [
    { label: `All ${String(available.length)} of them`, hint: 'You can narrow this later in Studio.' },
    { label: 'Let me pick a subset' },
  ]);
  if (mode === 0) return [...available];

  const names = available.map((id) => id.slice(id.lastIndexOf('.') + 1));
  const preview = names.slice(0, 12);
  const answer = await io.ask('Tables to include, comma-separated', {
    hint: `Available: ${preview.join(', ')}${names.length > preview.length ? `, and ${String(names.length - preview.length)} more` : ''}`,
    validate: (value) =>
      parseTableSelection(value, available).length === 0
        ? 'None of those matched a table name. Try again, or type: all'
        : null,
  });
  return parseTableSelection(answer, available);
}
