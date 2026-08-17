// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The first-run wizard's state + pure rules (11-electron.md §6, task 11-T07).
 *
 * Everything decision-shaped lives here so the step components stay thin and the
 * rules are unit-testable without a DOM — the same split `studio/connect/
 * wizardState.ts` uses, and for the same reason.
 *
 * ─── THE ORDERING CONSTRAINT THAT SHAPES THIS WHOLE FILE ─────────────────────
 *
 * §6 orders the steps: data location → first database → account → generate. But
 * every endpoint that could CREATE a database — `POST /desktop/local-database`,
 * `POST /desktop/demo-database`, `POST /connections`, even
 * `POST /connections/test` — is guarded by `system:connections:manage`, and at
 * first run there are ZERO users, so the wizard is unauthenticated until step 3
 * finishes. Step 2 therefore cannot execute anything.
 *
 * So step 2 is a CHOICE and step 4 is the EXECUTION: {@link DesktopSetupState}
 * records what the user picked, `createSuperAdmin` (step 3) returns the session
 * cookie that authorizes it, and the generate step performs create →
 * introspect → generate in one go. This is not a workaround — §6's step 4 is
 * already "introspection + generation", and introspection needs a connection to
 * exist, so the source creation was always going to live at the front of it.
 * Writing it down because the alternative reading (create the database in step
 * 2) compiles, looks right, and 401s on a fresh install every single time.
 *
 * ─── WHAT IS NOT PERSISTED ───────────────────────────────────────────────────
 *
 * The account form (name/email/password) and the schema file's contents. The
 * password because a password in `sessionStorage` is a defect regardless of how
 * convenient a refresh-safe wizard is; the file because it is megabytes and
 * would blow the quota. Both live in component memory, which is exactly as long
 * as they need to.
 */

import { getFormatters } from '@adminium/i18n';
import { LOCALES, type LocaleId } from '@adminium/i18n/registry';
import type { ThemePref } from '@adminium/tokens';
import type { DesktopCloudSyncWarning } from '@adminium/desktop/api';

import { t } from '../../i18n/t.js';
import type { ConnectionEngine, GenerateIntent } from '../../studio/api.js';
import { ENRICH_SECTIONS, LOCKED_LOCALE, type EnrichIntent } from '../../studio/connect/enrichState.js';
import type { LlmLocale, LlmSection } from '../../studio/ai/api.js';

// ─── Cloud sync (§6 step 1) ──────────────────────────────────────────────────

/**
 * §6 step 1's blocking warning, as the wizard renders it.
 *
 * An alias rather than a re-declaration: `setDataDir` REFUSES an unacknowledged
 * sync path and hands this back (`api.d.ts`'s `SetDataDirResult`), so the shape
 * is the main process's and a copy here would be a second thing to drift.
 *
 * IT LIVES IN THIS MODULE, not in `desktopSetupHost.tsx`, and that is a rule the
 * import graph enforces rather than a preference: the host renders
 * `DataLocationStep`, so a step importing a type back out of the host is a cycle
 * — `pnpm check-deps`' `no-circular` catches it, and it caught exactly this. The
 * steps' shared vocabulary belongs where the rest of it already is.
 */
export type CloudSyncBlock = DesktopCloudSyncWarning;

// ─── Steps ───────────────────────────────────────────────────────────────────

export const DESKTOP_SETUP_STEP_IDS = ['location', 'database', 'account', 'generate'] as const;
export type DesktopSetupStepId = (typeof DESKTOP_SETUP_STEP_IDS)[number];

export function desktopSetupStepLabel(id: DesktopSetupStepId): string {
  switch (id) {
    case 'location':
      return t('desktop.setup.step.location', 'Welcome');
    case 'database':
      return t('desktop.setup.step.database', 'Your first database');
    case 'account':
      return t('desktop.setup.step.account', 'Your account');
    case 'generate':
      return t('desktop.setup.step.generate', 'Generate');
  }
}

// ─── Source cards (§6 step 2) ────────────────────────────────────────────────

export const SOURCE_CARD_IDS = ['local', 'open-sqlite', 'remote', 'demo'] as const;
export type SourceCardId = (typeof SOURCE_CARD_IDS)[number];

/** §6 step 2 card 1's sub-choice. */
export type LocalSchemaChoice = 'blank' | 'file';

/** The engines a "server database" can be. SQLite is cards 1 and 2's business. */
export const REMOTE_ENGINES: readonly ConnectionEngine[] = ['postgres', 'mysql'];

// ─── State ───────────────────────────────────────────────────────────────────

export interface DesktopSetupState {
  step: DesktopSetupStepId;

  /**
   * §6 step 1. The directory the user picked but has not committed; `null` means
   * "keep the one the app booted against". Committing happens on Continue, via
   * the bridge's `setDataDir`, because committing RELAUNCHES the app (§2.2 step
   * 5 froze `ADMINIUM_DATA_DIR` into the server fork) and doing that on every
   * click of "Change…" would make the picker unusable.
   */
  pendingDataDir: string | null;
  /**
   * Whether the user has confirmed §6 step 1's blocking cloud-sync warning for
   * {@link DesktopSetupState.pendingDataDir}.
   *
   * A local echo of an answer the MAIN PROCESS enforces (`setDataDir` refuses an
   * unacknowledged sync path outright), not the gate itself. It exists so the
   * confirm button can be a second call rather than a second dialog — and it is
   * cleared whenever the path changes, since a confirmation is about one folder.
   */
  cloudSyncAcknowledged: boolean;

  source: SourceCardId | null;

  /** Card 1 — "Create a new local database". */
  localName: string;
  localSchema: LocalSchemaChoice;
  /** `Connect Database.dc.html`'s "Auto-generate placeholder entries". */
  placeholderRows: boolean;

  /** Card 2 — "Open an existing SQLite file". An absolute path from the bridge. */
  sqliteFile: string | null;

  /** Card 3 — "Connect to a server database". */
  remoteName: string;
  remoteEngine: ConnectionEngine;
  remoteDsn: string;

  /** Step 3. The password is deliberately absent — see the module header. */
  singleUser: boolean;
  locale: LocaleId | null;
  theme: ThemePref | null;

  /** Step 4. */
  intent: GenerateIntent;
  connectionId: string | null;
  enrichIntent: EnrichIntent | null;
  enrichSections: LlmSection[];
  enrichLocales: LlmLocale[];
  enrichSampling: boolean;
}

export const INITIAL_DESKTOP_SETUP_STATE: DesktopSetupState = {
  step: 'location',
  pendingDataDir: null,
  cloudSyncAcknowledged: false,
  source: null,
  localName: '',
  localSchema: 'blank',
  placeholderRows: false,
  sqliteFile: null,
  remoteName: '',
  remoteEngine: 'postgres',
  remoteDsn: '',
  // §6 step 3: "Skip login on this computer" is CHECKED by default.
  singleUser: true,
  locale: null,
  theme: null,
  intent: 'full-admin',
  connectionId: null,
  enrichIntent: null,
  enrichSections: [...ENRICH_SECTIONS],
  enrichLocales: [LOCKED_LOCALE],
  enrichSampling: false,
};

// ─── Slug (§6 step 2 card 1: "Name → slug") ──────────────────────────────────

/**
 * MIRROR of the server's `slugFor` (`routes/desktop-local-db/handlers.ts`). The
 * server is the authority — it is what names the file — and this copy exists
 * only so the wizard can SHOW `<slug>.sqlite` before the call. Change both
 * together; a drift here is a preview that lies, never a wrong file.
 */
export function slugPreview(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

// ─── Network-share detection (§6 step 2 card 2: "Warn on network-share paths") ─

/**
 * Is this SQLite file on a network share? A hit is a WARNING, never a block —
 * unlike §6 step 1's cloud-sync gate, which blocks.
 *
 * The asymmetry is deliberate and worth stating: a cloud-sync folder is a
 * corruption near-certainty (the provider forks the file behind an open handle),
 * while a network share is a risk that depends on the protocol, the lock
 * implementation, and whether anyone else has the file open. SQLite's own
 * documentation says to avoid it; plenty of single-user setups do it anyway
 * without ever noticing. Blocking that would be us overruling the user about
 * their own file.
 *
 * ONLY the shapes that cannot be anything else:
 *
 *  - `\\server\share\…` — a Windows UNC path, unambiguous.
 *  - `smb://`, `afp://`, `nfs://` — protocol URLs.
 *
 * NOT `/Volumes/…` (macOS), even though every SMB mount lands there: so does
 * every external disk, every DMG, and on many machines the boot volume itself.
 * A warning that fires on a USB stick teaches the user to ignore warnings, which
 * costs more than the one true positive it would have caught.
 */
export function isNetworkSharePath(path: string): boolean {
  return /^\\\\[^\\]/.test(path) || /^(smb|afp|nfs):\/\//i.test(path);
}

// ─── Step gating ─────────────────────────────────────────────────────────────

/** Continue on step 2 — is the chosen card's form complete? */
export function sourceCardValid(state: DesktopSetupState): boolean {
  switch (state.source) {
    case null:
      return false;
    case 'local':
      // The slug, not the name: "!!!" is a non-empty name with no slug, and the
      // server would 422 it. Checking what the server checks is the point.
      return slugPreview(state.localName).length > 0;
    case 'open-sqlite':
      return state.sqliteFile !== null;
    case 'remote':
      return state.remoteName.trim().length > 0 && state.remoteDsn.trim().length > 0;
    case 'demo':
      return true;
  }
}

/**
 * The DSN card 2 registers: §6 says the file is "opened IN PLACE (no silent
 * copy); registered in `adminium_connections` as `sqlite:<absolute path>`".
 */
export function sqliteDsn(file: string): string {
  return `sqlite:${file}`;
}

/** The connection name card 2 proposes — the file's basename, sans extension. */
export function nameFromSqlitePath(file: string): string {
  const base = file.split(/[/\\]/).pop() ?? file;
  return base.replace(/\.(sqlite3?|db)$/i, '') || base;
}

// ─── Persistence (refresh-safe wizard) ───────────────────────────────────────

const STORAGE_KEY = 'adminium-desktop-setup';

export function loadDesktopSetupState(): DesktopSetupState {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) return INITIAL_DESKTOP_SETUP_STATE;
    const parsed = JSON.parse(raw) as Partial<DesktopSetupState>;
    if (typeof parsed !== 'object' || parsed === null) return INITIAL_DESKTOP_SETUP_STATE;
    return { ...INITIAL_DESKTOP_SETUP_STATE, ...parsed };
  } catch {
    return INITIAL_DESKTOP_SETUP_STATE;
  }
}

export function saveDesktopSetupState(state: DesktopSetupState): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota/serialization failures degrade to a non-resumable wizard.
  }
}

export function clearDesktopSetupState(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ─── Formatting ──────────────────────────────────────────────────────────────

/** `1,234` in the active locale — for the "rows seeded" summary. */
export function formatCount(value: number): string {
  return getFormatters(navigatorLocaleTag()).number(value);
}

function navigatorLocaleTag(): string {
  return typeof navigator === 'undefined' ? 'en-US' : (navigator.language || 'en-US');
}

/**
 * The OS locale, mapped onto a locale this build ships — §6 step 3's "Locale/
 * theme pickers pre-filled from OS locale".
 *
 * Matched on the registry's `tag` (`en-US`), not its `id` (`en_US`): the id is
 * ours and the tag is BCP-47, which is what `navigator.language` speaks. Exact
 * tag first, then the language subtag, because `zh-Hans-CN` and `zh-CN` are the
 * same request and `de-AT` should land on German rather than on English.
 *
 * `null` when nothing matches — the honest answer for a locale we do not ship,
 * and the caller then leaves the picker on the workspace default rather than
 * asserting that a German speaker asked for English.
 */
export function localeFromNavigator(tag: string = navigatorLocaleTag()): LocaleId | null {
  const wanted = tag.toLowerCase();
  const exact = LOCALES.find((locale) => locale.tag.toLowerCase() === wanted);
  if (exact !== undefined) return exact.id;
  const language = wanted.split('-')[0] ?? '';
  return LOCALES.find((locale) => locale.tag.toLowerCase().split('-')[0] === language)?.id ?? null;
}
