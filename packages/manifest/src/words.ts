// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The words of a manifest that only a newer Adminium reads.
 *
 * A manifest block or rule added after a release is refused by every older
 * server as an unknown key — a sentence that names the key and not the cure.
 * So a manifest that uses one says so in `compatibility.minAdminiumVersion`:
 * the older server then answers "needs Adminium <version>" before it parses
 * anything. This walker lists the words a document uses, each with the place
 * it is written; the validator turns the list into the floor rule, and the
 * server reads the same list to refuse a word it parses and does not run yet.
 *
 * It reads the plain document, not the typed manifest, so the schema file may
 * import it without the two files importing each other.
 */

export interface ManifestWord {
  /** The word as a refusal names it: `pages`, `requiredSchema.prefixed`, `column.addOnLink`. */
  word: string;
  /** Dotted path to where the document writes it. */
  path: string;
}

type Doc = Readonly<Record<string, unknown>>;

const isDoc = (value: unknown): value is Doc => typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

/** The top-level blocks an add-on shares with an app since the install floor. */
export const ADD_ON_INSTALL_BLOCKS = [
  'pages',
  'roles',
  'optionLists',
  'emailTemplates',
  'outbox',
  'documents',
  'sampleData',
  'publicAccess',
  'publicKeys',
  'navGroups',
  'seeds',
  'addOns',
] as const;

/** Every word of `document` that needs the install floor, in document order. */
export function installFloorWords(document: unknown): ManifestWord[] {
  if (!isDoc(document)) return [];
  const out: ManifestWord[] = [];
  const addOn = document['kind'] === 'add-on';
  const schema = isDoc(document['requiredSchema']) ? document['requiredSchema'] : {};

  if (addOn) {
    for (const block of ADD_ON_INSTALL_BLOCKS) {
      if (document[block] !== undefined) out.push({ word: block, path: block });
    }
    if (schema['prefixed'] === true) out.push({ word: 'requiredSchema.prefixed', path: 'requiredSchema.prefixed' });
    const block = isDoc(document['addOn']) ? document['addOn'] : {};
    if (block['settingsTable'] !== undefined) out.push({ word: 'addOn.settingsTable', path: 'addOn.settingsTable' });
    if (block['ledgers'] !== undefined) out.push({ word: 'addOn.ledgers', path: 'addOn.ledgers' });
  } else if (isDoc(document['sampleData']) && document['sampleData']['addOns'] !== undefined) {
    out.push({ word: 'sampleData.addOns', path: 'sampleData.addOns' });
  }

  list(schema['tables']).forEach((table, t) => {
    if (!isDoc(table)) return;
    const at = `requiredSchema.tables.${String(t)}`;
    if (table['indexes'] !== undefined) out.push({ word: 'table.indexes', path: `${at}.indexes` });
    if (table['postings'] !== undefined) out.push({ word: 'table.postings', path: `${at}.postings` });
    if (isDoc(table['states'])) {
      for (const [from, moves] of Object.entries(isDoc(table['states']['moves']) ? table['states']['moves'] : {})) {
        list(moves).forEach((move, m) => {
          if (isDoc(move) && move['planned'] === true) out.push({ word: 'states.planned', path: `${at}.states.moves.${from}.${String(m)}.planned` });
        });
      }
    }
    list(table['columns']).forEach((column, c) => {
      const rules = isDoc(column) && isDoc(column['rules']) ? column['rules'] : null;
      if (rules === null) return;
      const here = `${at}.columns.${String(c)}.rules`;
      if (rules['addOnLink'] !== undefined) out.push({ word: 'column.addOnLink', path: `${here}.addOnLink` });
      if (rules['tableRef'] !== undefined) out.push({ word: 'column.tableRef', path: `${here}.tableRef` });
      for (const key of ['announce', 'plainText', 'customerKey', 'codeLast4'] as const) {
        if (rules[key] !== undefined) out.push({ word: `column.${key}`, path: `${here}.${key}` });
      }
      if (isDoc(rules['rollup']) && rules['rollup']['capUnless'] !== undefined) out.push({ word: 'rollup.capUnless', path: `${here}.rollup.capUnless` });
      if (isDoc(rules['lookup']) && isDoc(rules['lookup']['table'])) out.push({ word: 'column.addOnLink', path: `${here}.lookup.table` });
    });
  });

  list(document['publicAccess']).forEach((entry, e) => {
    if (isDoc(entry) && isDoc(entry['unlockBy']) && entry['unlockBy']['self'] === true) {
      out.push({ word: 'unlockBy.self', path: `publicAccess.${String(e)}.unlockBy` });
    }
  });
  return out;
}
