// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The add-ons a Designer model can name: the ones this server has, and the
 * ones its cached catalogue lists while that list is on. Read from disk;
 * nothing is fetched.
 */
import { linkInputTable, optionalInput, type Ledger, type LedgerAction } from '@adminium/manifest';
import { manifestsRepo, type MetaDb } from '@adminium/meta';

import type { AddOnStore } from '../add-ons/store.js';
import { catalogSchema, isCurrentCatalogFormat, pickLocalized } from '../add-ons/catalog.js';
import type { AddOnLine } from './tools.js';

/** How an app builds on a shape: by tables the tool writes whole, or by columns and a rule added to tables the app already has. */
export interface ShapeLine {
  name: string;
  how: 'built-on' | 'spelled-out';
}

/** The shapes a manifest document defines, as an app names them: `invoice@1`. A shape whose part carries a rule is spelled out on the app's own tables. */
export function shapesOf(document: unknown): ShapeLine[] {
  const shapes = (document as { addOn?: { shapes?: { name?: unknown; version?: unknown; parts?: Record<string, unknown> }[] } } | null)?.addOn?.shapes ?? [];
  return shapes.flatMap((shape) => {
    if (typeof shape.name !== 'string' || typeof shape.version !== 'number') return [];
    const ruled = Object.values(shape.parts ?? {}).some((part) => typeof part === 'object' && part !== null && ('postings' in part || 'adjust' in part));
    return [{ name: `${shape.name}@${String(shape.version)}`, how: ruled ? ('spelled-out' as const) : ('built-on' as const) }];
  });
}

/** An add-on's ledgers as its manifest declares them; none when the document is not an add-on's or keeps no ledger. */
export function declaredLedgers(document: unknown): Ledger[] {
  const ledgers = (document as { addOn?: { ledgers?: unknown } } | null)?.addOn?.ledgers;
  return Array.isArray(ledgers) ? (ledgers as Ledger[]) : [];
}

/** A table's primary-key column, by the add-on's own manifest. */
export const keyColumnOf =
  (document: unknown) =>
  (table: string): string | undefined => {
    const tables = (document as { requiredSchema?: { tables?: { ref?: unknown; columns?: { ref?: unknown; role?: unknown }[] }[] } } | null)?.requiredSchema?.tables ?? [];
    const found = tables.find((candidate) => candidate.ref === table)?.columns?.find((column) => column.role === 'pk')?.ref;
    return typeof found === 'string' ? found : undefined;
  };

/**
 * The actions of a ledger an app's rows post into: the ones that take the
 * row itself (`rowRef`), and the ones the add-on answers "is there enough?"
 * for. The rest are the add-on's own documents (a receipt, a count). A ledger
 * that marks none so is given whole.
 */
export function hostActions(document: unknown, ledger: Ledger): string[] {
  const asked = new Set(
    ((document as { addOn?: { words?: { ledger?: unknown; action?: unknown }[] } } | null)?.addOn?.words ?? []).flatMap((words) => (words.ledger === ledger.id && typeof words.action === 'string' ? [words.action] : [])),
  );
  const all = Object.keys(ledger.actions);
  const host = all.filter((name) => asked.has(name) || Object.values(ledger.actions[name]!.inputs).includes('rowRef'));
  return host.length === 0 ? all : host;
}

/** An input as a model reads it: `item: link to items`, `what: your row`. */
function inputInWords(document: unknown, action: LedgerAction, name: string): string {
  const type = action.inputs[name]!;
  if (type === 'rowRef') return `${name}: your row`;
  if (type === 'link' || type === 'link?') {
    const table = linkInputTable(action, name, keyColumnOf(document));
    return `${name}: link${table === null ? '' : ` to ${table}`}`;
  }
  return `${name}: ${type.replace('?', '')}`;
}

/** An action in one clause: what it needs, what it takes besides, and when it holds. */
export function actionInWords(document: unknown, name: string, action: LedgerAction): string {
  const decided = new Set((action.decides ?? []).map((rule) => rule.input));
  const names = Object.keys(action.inputs);
  const needed = names.filter((input) => !optionalInput(action.inputs[input]!) && !decided.has(input)).map((input) => inputInWords(document, action, input));
  const optional = names.filter((input) => optionalInput(action.inputs[input]!) && !decided.has(input));
  const inside = [needed.join(', '), optional.length === 0 ? '' : `optional ${optional.join(', ')}`].filter((part) => part !== '').join('; ');
  return `${name} (${inside}${action.holds === true ? '; holds until a time you give' : ''})`;
}

/** The ledgers a manifest document declares, a line each: `stock — use-item (item: link to items, quantity: number; optional place), use (…)`. */
export function ledgersOf(document: unknown): string[] {
  return declaredLedgers(document).map((ledger) => `${ledger.id} — ${hostActions(document, ledger).map((name) => actionInWords(document, name, ledger.actions[name]!)).join(', ')}`);
}

/** An add-on's manifest: the installed one, else the newest in this server's store. Null when it is neither. */
export async function readAddOnManifest(
  deps: { meta: MetaDb; credentialCrypto: { encrypt(value: string): string; decrypt(value: string): string }; store: AddOnStore },
  key: string,
): Promise<unknown> {
  if (!/^[a-z][a-z0-9-]{0,79}$/.test(key)) return null;
  const installed = await manifestsRepo(deps.meta, deps.credentialCrypto).findByKey(key);
  if (installed !== null && installed.row.kind === 'add-on') return installed.document;
  try {
    const version = (await deps.store.versions(key)).at(-1);
    return version === undefined ? null : (JSON.parse((await deps.store.readFile(key, version, 'manifest.json')).toString('utf8')) as unknown);
  } catch {
    return null;
  }
}

export async function addOnLines(deps: {
  meta: MetaDb;
  credentialCrypto: { encrypt(value: string): string; decrypt(value: string): string };
  store: AddOnStore;
  /** Whether this server's list of adminium.dev is on: the setting and the environment, as the pages read it. */
  catalogEnabled: () => Promise<boolean>;
}): Promise<AddOnLine[]> {
  const out = new Map<string, AddOnLine>();
  for (const installed of await manifestsRepo(deps.meta, deps.credentialCrypto).list('add-on')) {
    const document = (installed.document ?? {}) as { name?: unknown; description?: { fallback?: unknown } };
    out.set(installed.row.manifestKey, {
      key: installed.row.manifestKey,
      name: typeof document.name === 'string' ? document.name : installed.row.manifestKey,
      version: installed.row.version,
      line: typeof document.description?.fallback === 'string' ? document.description.fallback : '',
      state: 'installed',
      shapes: shapesOf(installed.document),
      ledgers: ledgersOf(installed.document),
    });
  }
  // On disk and not installed: bundled with this server, or downloaded, or uploaded.
  for (const key of await deps.store.keys()) {
    if (out.has(key)) continue;
    const version = (await deps.store.versions(key)).at(-1);
    if (version === undefined) continue;
    let name = key;
    let line = '';
    let shapes: ShapeLine[] = [];
    let ledgers: string[] = [];
    try {
      const document = JSON.parse((await deps.store.readFile(key, version, 'manifest.json')).toString('utf8')) as { name?: unknown; description?: { fallback?: unknown } };
      shapes = shapesOf(document);
      ledgers = ledgersOf(document);
      if (typeof document.name === 'string') name = document.name;
      if (typeof document.description?.fallback === 'string') line = document.description.fallback;
    } catch {
      // Listed by its key.
    }
    out.set(key, { key, name, version, line, state: 'available', shapes, ledgers });
  }
  // What the catalogue listed when it was last read. A list that is off is not read, even where an older one is still on disk (D100).
  if (await deps.catalogEnabled()) {
    const cached = await deps.store.readCatalogCache();
    if (cached !== null && isCurrentCatalogFormat(cached.document)) {
      const parsed = catalogSchema.safeParse(cached.document);
      if (parsed.success) {
        for (const entry of parsed.data.addOns) {
          if (out.has(entry.key)) continue;
          out.set(entry.key, { key: entry.key, name: pickLocalized(entry.name, 'en-US') ?? entry.key, version: entry.version, line: pickLocalized(entry.tagline, 'en-US') ?? '', state: 'listed' });
        }
      }
    }
  }
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key));
}
