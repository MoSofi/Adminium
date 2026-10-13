// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The kit's door for an app's own screens: the one file a screen imports.
 *
 *     const config = await (await fetch('surface-config.json')).json();
 *     const kit = await import(config.kit.entry);
 *     const box = await kit.mount('mentions', element, { value: '', onChange, locale: config.locale, dir: config.dir });
 *     box.update({ value: '' });
 *     box.unmount();
 *
 * Nothing but this function and two constants is in the file: each part, the
 * React that draws it and its styles arrive when that part is first asked
 * for, so a screen that mounts one part pays for one.
 */
import { KIT_CONTRACT, KIT_PARTS_AVAILABLE, KitPartUnavailableError, type KitMounted, type KitPartName, type KitPartProps } from './contract.js';

export type { BoardCard, BoardCardAction, BoardCardLine, BoardColumn, BoardProps, ImportProps, ImportResult, ImportTable, KitCommonProps, KitMaps, KitMounted, KitPartName, KitPartProps, KitPerson, KitRefused, KitTone, MapAreaGeometry, MapAreaShape, MapLeg, MapPin, MapProps, MapStop, MapWay, MentionsProps } from './contract.js';

/** The contract this kit speaks; the side's config says the same number. */
export const contract = KIT_CONTRACT;

/** The parts this kit can mount. */
export const parts = KIT_PARTS_AVAILABLE;

type Mounter<P extends KitPartName> = (element: Element, props: KitPartProps[P]) => Promise<KitMounted<KitPartProps[P]>>;

const LOADERS: { [P in KitPartName]: (() => Promise<{ default: Mounter<P> }>) | null } = {
  mentions: () => import('./parts/mentions.js'),
  board: () => import('./parts/board.js'),
  map: () => import('./parts/map.js'),
  import: () => import('./parts/import.js'),
};

/**
 * Draws a part inside `element` and resolves, once it is in the page, with
 * the handle that changes its props and takes it away. Rejects with a
 * `KitPartUnavailableError` for a part this kit does not have.
 */
export async function mount<P extends KitPartName>(part: P, element: Element, props: KitPartProps[P]): Promise<KitMounted<KitPartProps[P]>> {
  if (!Object.hasOwn(LOADERS, part)) throw new KitPartUnavailableError(String(part), 'KIT_PART_UNKNOWN');
  const load = LOADERS[part];
  if (load === null) throw new KitPartUnavailableError(part, 'KIT_PART_NOT_YET');
  if (!(element instanceof Element)) throw new TypeError('kit.mount: the second argument must be the element the part is drawn in.');
  const module = await load();
  return module.default(element, props);
}
