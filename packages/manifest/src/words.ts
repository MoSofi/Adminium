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
  'automations',
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
    if (block['adjuster'] !== undefined) out.push({ word: 'addOn.adjuster', path: 'addOn.adjuster' });
    if (block['words'] !== undefined) out.push({ word: 'addOn.words', path: 'addOn.words' });
    if (block['recordTabs'] !== undefined) out.push({ word: 'addOn.recordTabs', path: 'addOn.recordTabs' });
    // Pages that also need the data kit.
    if (block['hostApi'] === 2) out.push({ word: 'addOn.hostApi.2', path: 'addOn.hostApi' });
    if (block['lookUp'] !== undefined) out.push({ word: 'addOn.lookUp', path: 'addOn.lookUp' });
    // An amount Adminium decides for a ledger's action (what a card may pay).
    list(block['ledgers']).forEach((ledger, l) => {
      for (const [name, action] of Object.entries(isDoc(ledger) && isDoc(ledger['actions']) ? ledger['actions'] : {})) {
        if (isDoc(action) && action['decides'] !== undefined) out.push({ word: 'ledger.decides', path: `addOn.ledgers.${String(l)}.actions.${name}.decides` });
      }
    });
  } else {
    // An app has always had the other blocks: these two it has only since the install floor.
    if (document['automations'] !== undefined) out.push({ word: 'automations', path: 'automations' });
    if (isDoc(document['sampleData']) && document['sampleData']['addOns'] !== undefined) out.push({ word: 'sampleData.addOns', path: 'sampleData.addOns' });
  }

  list(schema['tables']).forEach((table, t) => {
    if (!isDoc(table)) return;
    const at = `requiredSchema.tables.${String(t)}`;
    if (table['indexes'] !== undefined) out.push({ word: 'table.indexes', path: `${at}.indexes` });
    if (table['postings'] !== undefined) out.push({ word: 'table.postings', path: `${at}.postings` });
    if (table['adjust'] !== undefined) out.push({ word: 'table.adjust', path: `${at}.adjust` });
    if (isDoc(table['states']) && table['states']['actions'] !== undefined) out.push({ word: 'states.actions', path: `${at}.states.actions` });
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

  list(document['roles']).forEach((role, r) => {
    if (isDoc(role) && role['tables'] !== undefined) out.push({ word: 'roles.tables', path: `roles.${String(r)}.tables` });
  });
  // A dashboard's second toolbar link, a ranking's named pair, a record page's tab words, a list's bulk action.
  list(document['pages']).forEach((page, p) => {
    const config = isDoc(page) && isDoc(page['config']) ? page['config'] : {};
    const here = `pages.${String(p)}.config`;
    const toolbar = isDoc(config['layout']) && isDoc(config['layout']['toolbar']) ? config['layout']['toolbar'] : {};
    if (toolbar['links'] !== undefined) out.push({ word: 'toolbar.links', path: `${here}.layout.toolbar.links` });
    if (config['tabs'] !== undefined) out.push({ word: 'config.tabs', path: `${here}.tabs` });
    if (config['bulk'] !== undefined) out.push({ word: 'config.bulk', path: `${here}.bulk` });
  });
  // An email block sent only with, or without, a variable; an add-on's links into its app; rows found by a table-and-row pair.
  const outbox = isDoc(document['outbox']) ? document['outbox'] : {};
  if (isDoc(outbox['pages']) && outbox['pages']['app'] !== undefined) out.push({ word: 'outbox.pages.app', path: 'outbox.pages.app' });
  list(document['emailTemplates']).forEach((template, t) => {
    for (const [locale, content] of Object.entries(isDoc(template) && isDoc(template['locales']) ? template['locales'] : {})) {
      list(isDoc(content) ? content['blocks'] : undefined).forEach((block, b) => {
        const data = isDoc(block) && isDoc(block['data']) ? block['data'] : {};
        const here = `emailTemplates.${String(t)}.locales.${locale}.blocks.${String(b)}.data`;
        for (const mark of ['onlyWith', 'onlyWithout'] as const) if (data[mark] !== undefined) out.push({ word: `email.${mark}`, path: `${here}.${mark}` });
        if (isDoc(data['from']) && data['from']['addOn'] !== undefined) out.push({ word: 'rows.pair', path: `${here}.from` });
      });
    }
  });
  list(document['documents']).forEach((entry, d) => {
    for (const [slot, source] of Object.entries(isDoc(entry) && isDoc(entry['mapping']) ? entry['mapping'] : {})) {
      const sources = isDoc(source) ? [...(isDoc(source['collection']) ? [source['collection']] : []), ...list(source['collections'])] : [];
      if (sources.some((one) => isDoc(one) && one['addOn'] !== undefined)) out.push({ word: 'rows.pair', path: `documents.${String(d)}.mapping.${slot}` });
    }
  });

  list(document['publicAccess']).forEach((entry, e) => {
    if (isDoc(entry) && isDoc(entry['unlockBy']) && entry['unlockBy']['self'] === true) {
      out.push({ word: 'unlockBy.self', path: `publicAccess.${String(e)}.unlockBy` });
    }
    if (isDoc(entry) && entry['words'] !== undefined) out.push({ word: 'availability.words', path: `publicAccess.${String(e)}.words` });
  });
  return out;
}
