// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The app's section of the sidebar, and where a record opens.
 *
 * Three words of a manifest are checked here:
 *
 *   `pages[].nav.offRail`      a page kept off the sidebar;
 *   `navLinks`                 an entry of the section that is not a page;
 *   `frontends[].records`      where a table's record opens on the staff side.
 *
 * ── AN ADDRESS IS NEVER WRITTEN OUT ────────────────────────────────────────
 * A link a manifest could spell freely is a link to anywhere: another app's
 * screens, the dashboard's own, a look-alike host in an e-mail's button. So
 * neither word takes an address. A record's address is a path under the side
 * that declares it, made of plain segments and one `{id}`; an entry of the
 * section names one of a closed list of places. The server joins the side's
 * own base to the path, and reads the path again with {@link recordAddressOf}
 * before it does (a stored manifest is data, not a promise).
 *
 * It reads the plain document, like `words.ts`, so `schema.ts` may import it.
 */

/** The dashboard screens an entry of an app's section may open, each narrowed to that app. */
export const NAV_LINK_SCREENS = ['automations', 'email-templates', 'settings'] as const;
export type NavLinkScreen = (typeof NAV_LINK_SCREENS)[number];

/** One segment of a path: letters, digits and `. _ ~ -`, never starting with a dot (so no `.` and no `..`). */
const SEGMENT = '[A-Za-z0-9_~-][A-Za-z0-9._~-]*';
const SIDE_PATH = new RegExp(`^(?:/${SEGMENT})+$`);
const RECORD_ADDRESS = new RegExp(`^(?:/(?:${SEGMENT}|\\{id\\}))+$`);

export const SIDE_PATH_MESSAGE = 'a path under the side: "/" then plain segments (letters, digits, ".", "_", "~", "-"), with no query, no "#" and no ".."';
export const RECORD_ADDRESS_MESSAGE = 'a path under the side with one "{id}" segment, as in "/deals/{id}": plain segments only, no query, no "#" and no ".."';

/** Whether `value` is a path under a side: `/approvals`, `/settings/team`. */
export function isSidePath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 200 && SIDE_PATH.test(value);
}

/** Whether `value` is a record's address under a side: a side path with exactly one `{id}` segment. */
export function isRecordAddress(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 200 && RECORD_ADDRESS.test(value) && value.split('/').filter((segment) => segment === '{id}').length === 1;
}

/**
 * The path a record opens at, from its table's address and its id: null when
 * the address is not one (a manifest stored by an older or a foreign hand).
 * The id is one segment whatever it holds.
 */
export function recordAddressOf(address: unknown, recordId: string): string | null {
  if (!isRecordAddress(address) || recordId === '') return null;
  return address
    .split('/')
    .map((segment) => (segment === '{id}' ? encodeURIComponent(recordId) : segment))
    .join('/');
}

type Doc = Readonly<Record<string, unknown>>;
const isDoc = (value: unknown): value is Doc => typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

/** The addresses the staff side of `document` declares, by table ref; none when it declares none. */
export function staffRecordAddresses(document: unknown): Readonly<Record<string, string>> {
  if (!isDoc(document)) return {};
  const staff = list(document['frontends']).find((frontend) => isDoc(frontend) && frontend['side'] === 'staff');
  const records = isDoc(staff) && isDoc(staff['records']) ? staff['records'] : {};
  return Object.fromEntries(Object.entries(records).filter((entry): entry is [string, string] => isRecordAddress(entry[1])));
}

export interface RailIssue {
  path: (string | number)[];
  message: string;
}

/**
 * What the three words may not say: an address on a side that is not the
 * staff side, or for a table the app does not have; two entries of one ref; an
 * entry into a staff side the app does not declare.
 */
export function railIssues(document: unknown): RailIssue[] {
  if (!isDoc(document)) return [];
  const out: RailIssue[] = [];
  const schema = isDoc(document['requiredSchema']) ? document['requiredSchema'] : {};
  const tables = new Set(list(schema['tables']).flatMap((table) => (isDoc(table) && typeof table['ref'] === 'string' ? [table['ref']] : [])));
  const frontends = list(document['frontends']);

  frontends.forEach((frontend, f) => {
    if (!isDoc(frontend) || frontend['records'] === undefined) return;
    if (frontend['side'] !== 'staff') {
      out.push({ path: ['frontends', f, 'records'], message: `only the staff side says where a record opens: a notice and a search hit are a staff member's` });
      return;
    }
    for (const ref of Object.keys(isDoc(frontend['records']) ? frontend['records'] : {})) {
      if (!tables.has(ref)) out.push({ path: ['frontends', f, 'records', ref], message: `the app has no table "${ref}"` });
    }
  });

  const hasStaff = frontends.some((frontend) => isDoc(frontend) && frontend['side'] === 'staff');
  const seen = new Set<string>();
  list(document['navLinks']).forEach((link, l) => {
    if (!isDoc(link)) return;
    if (typeof link['ref'] === 'string') {
      if (seen.has(link['ref'])) out.push({ path: ['navLinks', l, 'ref'], message: `"${link['ref']}" is named twice` });
      seen.add(link['ref']);
    }
    if (isDoc(link['to']) && link['to']['side'] === 'staff' && !hasStaff) {
      out.push({ path: ['navLinks', l, 'to', 'side'], message: 'the app declares no staff side to open' });
    }
  });
  return out;
}
