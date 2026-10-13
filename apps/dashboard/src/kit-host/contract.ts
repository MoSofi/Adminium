// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an app's own screen and the kit agree on: the names of the parts, what
 * each takes, and what a mount answers.
 *
 * An app's screen is a bundle of its own (its own React, or none), so it
 * cannot draw the kit's components. It asks for one instead: it imports the
 * kit's entry from the address its side's config names (`kit.entry`) and
 * calls `mount(part, element, props)`. The part is drawn inside `element` by
 * the kit's own React; the app's never meets it.
 *
 * This file is types, two constants and one error class. A change that an app built
 * against an older kit could not live with raises `KIT_CONTRACT`.
 */

/** The contract's number, as the side's config and `kit.json` say it. */
export const KIT_CONTRACT = 1;

export type KitPartName = 'mentions' | 'board' | 'map' | 'import';

/** The parts a mount can draw today. The others are named so that adding one changes no signature. */
export const KIT_PARTS_AVAILABLE: readonly KitPartName[] = ['mentions', 'board', 'map'];

/** One language's words, part by part: `ns:key` to its text (./words/, written by scripts/gen-kit-words.mjs). */
export type KitWords = Record<KitPartName, Record<string, string>>;

/** What every part takes. */
export interface KitCommonProps {
  /** The person's language as the side's config says it (`locale`), such as `ar-EG`. An unknown one reads as en-US. */
  locale: string;
  /** The direction of that language, from the same config (`dir`). */
  dir: 'ltr' | 'rtl';
  /** Light or dark, for an app that has no colour tokens of its own. Left out, the part follows the page's `color-scheme`. */
  theme?: 'light' | 'dark' | undefined;
}

export interface KitPerson {
  /** The person's id, `usr_…`. */
  id: string;
  name: string;
}

/** The text area in which people are mentioned. */
export interface MentionsProps extends KitCommonProps {
  /** The text as it is stored: each person as `@[Name](usr_…)`. */
  value: string;
  /** Called with the text as it is to be stored, on every change. */
  onChange: (stored: string) => void;
  /** Drawn above the box and tied to it. */
  label?: string | undefined;
  /** The box's name for a screen reader when there is no `label`. */
  ariaLabel?: string | undefined;
  placeholder?: string | undefined;
  /** Default 3. */
  rows?: number | undefined;
  disabled?: boolean | undefined;
  /** Draws the box as wrong and says so to a screen reader. */
  invalid?: boolean | undefined;
  /**
   * Who may be named, for what was typed after the `@`. Left out, the people
   * who sign in to this Adminium, read with the person's own session.
   */
  people?: ((query: string) => Promise<readonly KitPerson[]>) | undefined;
}

/** The six tones a column's dot and a card's tag are drawn in. */
export type KitTone = 'neutral' | 'accent' | 'pos' | 'warn' | 'danger' | 'info';

/** What an app answers a save with when the server said no: the reason, in words a person can read. */
export interface KitRefused {
  refused: string;
}

export interface BoardColumn {
  id: string;
  /** The heading, in the reader's language. */
  label: string;
  /** The colour of the dot before the heading. Default `neutral`. */
  tone?: KitTone | undefined;
  /**
   * How many cards the column holds in all, when the app has counted them (a
   * list stops at its limit). Left out, the number of cards given.
   */
  count?: number | undefined;
  /** A figure for the column, already written as text ("€12,400"), drawn at the heading's far end. */
  total?: string | undefined;
  /** The most cards the column should hold: the count reads "4/3" and turns red above it. */
  limit?: number | undefined;
  /** A few quiet characters right after the heading, already written as text ("10%": a stage's odds). */
  badge?: string | undefined;
}

/** One thing a card's own menu offers. */
export interface BoardCardAction {
  /** What `onAction` is called with. */
  id: string;
  /** In the reader's language. */
  label: string;
  /** `danger` for something that cannot be taken back: drawn in red. */
  tone?: 'danger' | undefined;
  /** Listed, and not to be had just now: said as unavailable, and a press does nothing. */
  disabled?: boolean | undefined;
}

/** One line of a card: the text, and the label before it when it has one. Both already in the reader's words. */
export interface BoardCardLine {
  label?: string | undefined;
  value: string;
}

export interface BoardCard {
  /** The row's key, as text. It is what `onMove`, `onOpen` and `canMove` are called with. */
  id: string;
  /** The `id` of the column the card is in. A card whose column is not among `columns` is not drawn. */
  columnId: string;
  title: string;
  /** A quiet line under the title (a company's name). */
  subtitle?: string | undefined;
  /** A figure at the far end of the subtitle's line, already written as text by the app ("€4,200"). */
  amount?: string | undefined;
  /** Short lines with no label of their own, under the subtitle. */
  meta?: readonly string[] | undefined;
  /** Labelled lines under those: "Close" and "12 Mar". */
  lines?: readonly BoardCardLine[] | undefined;
  /** A small pill above the title. */
  tag?: string | undefined;
  /** Default: the column's tone. */
  tagTone?: KitTone | undefined;
  /** A person's name: drawn as their initials in a small round. */
  owner?: string | undefined;
  /** A short date or time left, already written as text, in a chip at the foot. */
  due?: string | undefined;
  /** 0 to 100: a bar under the lines. */
  progress?: number | undefined;
  /** Small print at the foot (a reference such as "D-1042"). Left out, nothing is printed there. */
  reference?: string | undefined;
  /**
   * What the card's own menu offers: with `onAction`, the card gets a small
   * "more" button at its far corner (after the card in the Tab order) that
   * opens them. Left out or empty, the card has no button.
   */
  actions?: readonly BoardCardAction[] | undefined;
}

/** The board: columns of cards a person moves with a pointer or the keyboard. */
export interface BoardProps extends KitCommonProps {
  columns: readonly BoardColumn[];
  cards: readonly BoardCard[];
  /**
   * Saves a move. The board has already drawn the card in its new column;
   * answer a promise and it waits for it. `{ refused }`, or a rejection (its
   * `message` is the reason), puts the card back and says why on the board
   * and aloud. Left out, no card can be moved.
   */
  onMove?: ((cardId: string, toColumnId: string, fromColumnId: string) => void | Promise<void | KitRefused>) | undefined;
  /** Which cards may be moved: all (the default with `onMove`), none (`false`), or the ones the function says. */
  canMove?: boolean | ((cardId: string) => boolean) | undefined;
  /**
   * Called when a card is clicked. By keyboard: Enter on a card that cannot
   * be moved, and Shift+Enter on one that can (Enter alone picks it up); a
   * screen reader is told so on each such card.
   */
  onOpen?: ((cardId: string) => void) | undefined;
  /** Called when one of a card's `actions` is chosen from its menu. Left out, no card has a menu. */
  onAction?: ((cardId: string, actionId: string) => void) | undefined;
  /**
   * Saves a new card typed at a column's foot. `{ refused }` or a rejection
   * keeps the typed title in its box and says why. Left out, no column has
   * an "Add card".
   */
  onAdd?: ((columnId: string, title: string) => void | Promise<void | KitRefused>) | undefined;
  /** The app is reading: the board says so to a screen reader, dims, and no card can be moved. */
  busy?: boolean | undefined;
  /** Said above the columns while there is no card at all, and in place of the board while there is no column. */
  emptyLabel?: string | undefined;
  /** The board's name for a screen reader ("Pipeline"). */
  ariaLabel?: string | undefined;
}

/** Whether maps are on in this Adminium and where they come from: the `maps` of the side's config, handed over as it came. */
export interface KitMaps {
  /** False: maps are switched off. The part shows its list and a line saying so, and asks the map server nothing. */
  enabled: boolean;
  /** The map server's address; null while maps are off. The kit holds no address of its own. */
  server: string | null;
  /** Whether a route may follow roads. The config says it; the map does not read it. */
  routing?: boolean | undefined;
}

/** One place on the map. */
export interface MapPin {
  /** The row's key, as text. It is what `onSelect` and `onMovePin` are called with, and what `selected` names. */
  id: string;
  lat: number;
  lng: number;
  /** The place's name: said by its pin, and written in the list beside the map. */
  label: string;
  /** The colour of the pin. Default `accent`. */
  tone?: KitTone | undefined;
  /**
   * How the position is known, as a place column says it: `town` is the
   * middle of a town (the place is somewhere in it), drawn hollow and marked
   * "by town"; several in one town stand in a ring round it.
   */
  by?: 'town' | 'exact' | undefined;
}

/** An area's outline: a GeoJSON `Polygon` or `MultiPolygon`, positions as `[lng, lat]`. */
export type MapAreaGeometry = { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] };

/** An area drawn on the map as a filled outline, and named in the list. */
export interface MapAreaShape {
  id: string;
  /** Left out, the list calls it "Area 1". */
  name?: string | undefined;
  geometry: MapAreaGeometry;
  /** The colour of the outline and its fill. Default `accent`. */
  tone?: KitTone | undefined;
}

/** One stop of a route: a pin's position, in the pins' order. */
export interface MapStop {
  lat: number;
  lng: number;
  by?: 'town' | 'exact' | undefined;
}

/** One leg of a route, as `POST /api/v1/geo/route` answers it. */
export interface MapLeg {
  distanceM: number | null;
  durationS: number | null;
  /** A straight line and not a road: said as "about". */
  estimate: boolean;
  /** Both ends are known only as the same town: said as "unknown", never 0. */
  unknown?: true | undefined;
}

/** The way through the stops: what `POST /api/v1/geo/route` answers in `data`. Anything more it says is let by. */
export interface MapWay {
  /** One leg between each two neighbours: one fewer than the stops. */
  legs: readonly MapLeg[];
  /** The road, as a GeoJSON `LineString`. Without one, straight dashed legs are drawn. */
  line?: { type: 'LineString'; coordinates: number[][] } | undefined;
}

/**
 * The map: a pin for each place and a list of the same places beside it
 * (under it, on a narrow screen), areas, and a route through the pins.
 */
export interface MapProps extends KitCommonProps {
  /** The `maps` of the side's config, as it came. */
  maps: KitMaps;
  /** A pin whose `lat` or `lng` is not a number is left out. */
  pins: readonly MapPin[];
  areas?: readonly MapAreaShape[] | undefined;
  /**
   * The `id` of the pin that is picked: drawn filled, with a ring, and its
   * row in the list marked. The map keeps what the person picks; give a new
   * one (or null) to change it from the app's side.
   */
  selected?: string | null | undefined;
  /** Called when a pin, or its row in the list, is picked. */
  onSelect?: ((pinId: string) => void) | undefined;
  /**
   * Saves a pin dragged to a new spot (with the keyboard: Enter picks a
   * focused pin up, the arrows move it, Enter keeps the spot, Escape puts it
   * back). Giving this turns dragging on. Answer a promise and the map waits
   * for it. `{ refused }`, or a rejection (its `message` is the reason), puts
   * the pin back and says why above the map and aloud.
   */
  onMovePin?: ((pinId: string, at: { lat: number; lng: number }) => void | Promise<void | KitRefused>) | undefined;
  /**
   * Saves an area that was drawn (`areaId` is null) or changed. Giving this
   * turns drawing on. A new shape is a `Polygon`; a changed one comes back
   * as the kind it was, holes and further pieces kept, so save `geometry`
   * whole and hand the areas back with `update`. `{ refused }`, or a
   * rejection, is said above the map; the shape stays as it was drawn.
   */
  onAreaChange?: ((areaId: string | null, geometry: MapAreaGeometry) => void | Promise<void | KitRefused>) | undefined;
  /**
   * Makes the pins the stops of a route, in their order: they are numbered,
   * joined, and each leg's length is listed. The map calls this with the
   * stops whenever their positions change and draws what it answers: post
   * them to `/api/v1/geo/route` and answer its `data`. Until the answer is
   * in, and when it does not come, the legs are straight dashed lines of
   * unknown length.
   */
  route?: ((stops: readonly MapStop[]) => Promise<MapWay>) | undefined;
  /** The unit a route's legs are said in. Default `km`. */
  units?: 'km' | 'mi' | undefined;
  /** Where the map starts, as `[lat, lng]`. Left out, it fits what it draws. Read once, at the mount. */
  center?: readonly [number, number] | undefined;
  /** 1 (the world) to 18 (a street). Read once, at the mount. */
  zoom?: number | undefined;
  /**
   * Where maps are switched on, for a person who may do it: the "switched
   * off" line then ends in a link there. Left out, the line has no link.
   */
  settingsHref?: string | undefined;
  /** The list's heading for a screen reader. Default "Places", or "Stops" on a route. */
  listLabel?: string | undefined;
  /** Said in place of the map while there is no pin and no area. */
  emptyLabel?: string | undefined;
  /** The map's name for a screen reader ("Customers"). */
  ariaLabel?: string | undefined;
}

/** A part that is named but cannot be mounted yet. */
export type KitPartNotYet = Record<string, never>;

export interface KitPartProps {
  mentions: MentionsProps;
  board: BoardProps;
  map: MapProps;
  import: KitPartNotYet;
}

/** What a mount answers. */
export interface KitMounted<Props> {
  /** Changes the props named; the others stay as they were. The caret and the focus are kept; so are a map's view and a pin being dragged. */
  update(props: Partial<Props>): void;
  /** Takes the part out of the element and frees what it held. */
  unmount(): void;
}

/** A part was asked for that this kit does not have, or does not have yet. `code` tells the two apart. */
export class KitPartUnavailableError extends Error {
  readonly code: 'KIT_PART_UNKNOWN' | 'KIT_PART_NOT_YET';
  readonly part: string;
  constructor(part: string, code: 'KIT_PART_UNKNOWN' | 'KIT_PART_NOT_YET') {
    super(
      code === 'KIT_PART_NOT_YET'
        ? `The kit part "${part}" is not available in this version of Adminium yet.`
        : `The kit has no part called "${part}". Its parts are: mentions, board, map, import.`,
    );
    this.name = 'KitPartUnavailableError';
    this.code = code;
    this.part = part;
  }
}
