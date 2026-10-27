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

export type KitPartName = 'mentions' | 'board' | 'map' | 'import' | 'signature' | 'photos' | 'consent';

/** The parts a mount can draw today. The others are named so that adding one changes no signature. */
export const KIT_PARTS_AVAILABLE: readonly KitPartName[] = ['mentions', 'board', 'map', 'import', 'signature', 'photos', 'consent'];

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
   * One of the map's eight colours, by its number from 0 (8 is 0 again), in
   * place of `tone`: for pins coloured by something of their row, such as
   * its owner. An area takes the same numbers, so a pin and its area match.
   * Each colour has an outline of its own (round, square, a drop…), because
   * colour alone tells some readers nothing. Not a whole number from 0 up:
   * the tone stands.
   */
  colour?: number | undefined;
  /** What the colour stands for ("Dana Whitlock"): said with the pin's name, and written beside it in the list. */
  group?: string | undefined;
  /**
   * How the position is known, as a place column says it: `town` is the
   * middle of a town (the place is somewhere in it), drawn hollow and marked
   * "by town"; several in one town stand in a ring round it.
   */
  by?: 'town' | 'exact' | undefined;
}

/** An area's outline: a GeoJSON `Polygon` or `MultiPolygon`, positions as `[lng, lat]`. */
export type MapAreaGeometry = { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] };

/**
 * An area drawn on the map as a filled outline, and named in the list. Its
 * `name` is also written on the map, in the middle of its largest piece,
 * wherever the area is large enough on screen to hold it.
 */
export interface MapAreaShape {
  id: string;
  /** Left out, the list calls it "Area 1". */
  name?: string | undefined;
  geometry: MapAreaGeometry;
  /** The colour of the outline and its fill. Default `accent`. */
  tone?: KitTone | undefined;
  /** One of the map's eight colours, by its number from 0, in place of `tone`: the numbers a pin's `colour` takes. */
  colour?: number | undefined;
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
  /** Why the leg has no length. `same-town`: both stops are pinned to the town; placing them lets it be measured. */
  why?: 'same-town' | undefined;
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
   * joined, and each leg's length is listed, with its drive time where the
   * answer has one, and the whole way under the list where every leg has a
   * length. The map calls this with the stops whenever their positions
   * change and draws what it answers: post them to `/api/v1/geo/route` and
   * answer its `data`. Until the answer is in the legs are straight dashed
   * lines of unknown length; when it does not come (a rejection) the map
   * says so above itself, with "Try again", which calls this once more.
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
  /**
   * The `id` of the area that is picked: drawn stronger, its name and its
   * row marked. Give a new one with `update` and the map brings that area
   * into view; where areas can be changed (`onAreaChange`), it is also the
   * one being changed. The map keeps what the person picks on it.
   */
  selectedArea?: string | null | undefined;
  /** Called when an area is picked, on the map or in the list. */
  onSelectArea?: ((areaId: string) => void) | undefined;
  /**
   * A PROMISE, NOT A SWITCH. The `id` of the element in the page that holds
   * the list the app draws itself. While an element with that id is in the
   * page, the map leaves its own list out; while there is none, the map's
   * own list is drawn whatever this says.
   *
   * The map's list is what a screen reader and a keyboard have in place of
   * a canvas of pins, and what stands in while there is no map. An app that
   * names its own has taken on all of it: every pin and area as real text,
   * a row that picks its pin (`update({ selected })`, which also brings it
   * into view), the picked row marked, and a list that is whole while maps
   * are off or the map server is out of reach (`onStatus`). The pins on the
   * map stay buttons that are focused, picked and moved by keyboard.
   */
  hostList?: string | undefined;
  /**
   * A row with no position yet is being put on the map: the line above the
   * map says so with `label`, and the next click on the map, or Enter with
   * the map focused, or the button, for the cross at its middle, is told to
   * `onPlacePin` with this `id`. Null or left out: nothing is being placed.
   * The map is in this state only while the app says so.
   */
  placing?: { id: string; label: string } | null | undefined;
  /**
   * Saves where a row was put. A pin stands on the spot while the promise
   * is out. `{ refused }`, or a rejection, takes the pin away and says why
   * above the map and aloud; `placing` stays, for another try. Held: the
   * pin is kept (a pin of `pins` with that id takes the position; without
   * one, a pin is added under the `label`), and `placing` is set to null.
   */
  onPlacePin?: ((pinId: string, at: { lat: number; lng: number }) => void | Promise<void | KitRefused>) | undefined;
  /** The person stopped placing ("Stop placing", or Escape with the map focused). The map has already left the state. */
  onPlacingStop?: (() => void) | undefined;
  /**
   * What the map is doing, whenever it changes: `loading`, `ready`,
   * `unreachable` (the map server did not answer; the person has "Try
   * again") or `off`. For a list of the app's own: "Place it" needs `ready`.
   */
  onStatus?: ((status: 'loading' | 'ready' | 'unreachable' | 'off') => void) | undefined;
  /**
   * False leaves out the link that shows a place on OpenStreetMap's site.
   * On a phone every placed row has "Open in my maps app" (the device's
   * own app). On a desk, while maps are on, the picked place has "Open on
   * OpenStreetMap (new tab)", under its row, or under the map when the list
   * is the app's own: a plain link, followed only when the person presses
   * it, that carries the position and nothing else (no name, no row, no
   * referrer).
   */
  mapsSiteLink?: boolean | undefined;
  /** The list's heading for a screen reader. Default "Places", or "Stops" on a route. */
  listLabel?: string | undefined;
  /** Said in place of the map while there is no pin and no area. */
  emptyLabel?: string | undefined;
  /** The map's name for a screen reader ("Customers"). */
  ariaLabel?: string | undefined;
}

/** One table rows may be brought in to. */
export interface ImportTable {
  /** The table, as the `tables` of the side's config gives it. */
  table: string;
  /** What the person reads for it ("Companies"): in the picker, and in a refusal. */
  label: string;
  /**
   * The columns a file's columns can be mapped to: each one's stored name
   * and what to call it. `unique` marks a column no two rows share: when any
   * column is marked, lines can be matched on the marked ones only. (Somebody
   * held to their own rows may match on no other kind; the server refuses.)
   */
  columns: readonly { key: string; label?: string | undefined; unique?: boolean | undefined }[];
  /** The column (one of `columns`, by its key) lines are matched on to begin with. The person may change it. */
  matchOn?: string | undefined;
}

/** What an import did, once it has run. `failed` are the lines the server refused; they are among `skipped`. */
export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

/** The import wizard: paste or upload, map the columns, see what each line would do, run. */
export interface ImportProps extends KitCommonProps {
  /** `connectionId` of the side's config. */
  connectionId: string;
  /** One table and the person is not asked; several and they pick one, by its label. */
  tables: readonly ImportTable[];
  /**
   * `csrfToken` of the side's config. The part talks to this Adminium with
   * the person's own session, and the server takes no change without it.
   * A new one (after signing in again) is taken by `update`.
   */
  csrfToken: string;
  /**
   * Used in place of the browser's `fetch` for every call the part makes
   * (same-origin paths under `/api/v1/imports` and `/api/v1/jobs`). Left
   * out, the browser's own, with the session's cookie and `csrfToken`.
   */
  fetch?: ((input: string, init?: RequestInit) => Promise<Response>) | undefined;
  /**
   * What may be done with a line that is already in the table: left as it
   * is (`skip`), or updated (`update`). The first is the one chosen to begin
   * with. Default both, `skip` first. Updating needs the right to update,
   * which the server checks when the import is made and again when it runs.
   */
  modes?: readonly ('skip' | 'update')[] | undefined;
  /** Whether rows are pasted, a file is dropped, or either. Default both. */
  sources?: readonly ('paste' | 'file')[] | undefined;
  /** A heading above the steps. */
  title?: string | undefined;
  /** The wizard's name for a screen reader, when there is no `title`. */
  ariaLabel?: string | undefined;
  /** Called once, when the import has run. */
  onDone?: ((result: ImportResult) => void) | undefined;
  /** Gives the last step a "Close" button, and is called by it. */
  onClose?: (() => void) | undefined;
}

/**
 * Where a file part sends what a person gives it: a column an app's manifest
 * makes a file column (`rules.file`), with the person's own session. The
 * server judges the file by its bytes against the column's kinds and size,
 * takes a picture's camera notes (the place, the device) out of it, and
 * keeps it for this person alone until a record they save names it.
 */
export interface KitFileTarget {
  /** `connectionId` of the side's config. */
  connectionId: string;
  /** The table, as the `tables` of the side's config gives it. */
  table: string;
  /** The column the files are for. */
  column: string;
  /** `csrfToken` of the side's config: the server takes no upload without it. A new one is taken by `update`. */
  csrfToken: string;
  /** Used in place of the browser's `fetch` (same-origin paths under `/api/v1/files`). Left out, the browser's own. */
  fetch?: ((input: string, init?: RequestInit) => Promise<Response>) | undefined;
}

/**
 * A signature pad: drawn with a finger, a pen or the mouse, or the name typed
 * instead (by keyboard alone). "Keep this signature" sends it as a PNG and
 * tells the app the new file's id; the app then names that id in the
 * record it saves. "Sign again" clears it, and a signature this mount sent
 * and the app did not give back as `value` is thrown away on the server.
 */
export interface SignatureProps extends KitCommonProps, KitFileTarget {
  /** The file id the column holds now: shown as the kept signature. Null or left out: the pad is empty. */
  value?: string | null | undefined;
  /** Called with the file's id once a signature is kept, and with null when it is cleared. */
  onChange: (fileId: string | null) => void;
  /** Drawn above the pad and tied to it ("Customer's signature"). */
  label?: string | undefined;
  /** The pad's name for a screen reader when there is no `label`. */
  ariaLabel?: string | undefined;
  /** Nothing can be drawn, typed or kept: a signed record shown again. */
  disabled?: boolean | undefined;
  /** Draws the pad as wrong and says so to a screen reader (the record was refused for its signature). */
  invalid?: boolean | undefined;
}

/**
 * A field of photos: "Add a photo" opens the phone's camera or its pictures;
 * each photo is turned upright, made at most `maxSide` pixels a side, sent,
 * and shown small with a button that takes it out. The app hears the ids of
 * the photos it holds, in order, and names them in the record it saves. A
 * photo this mount sent and the person took out again (and that the app did
 * not give back as `value`) is thrown away on the server.
 */
export interface PhotosProps extends KitCommonProps, KitFileTarget {
  /** The file ids the column holds now, in order. */
  value?: readonly string[] | undefined;
  /** The most photos the field takes: the column's `maxCount`. Default 6. */
  max?: number | undefined;
  /** The longest side a photo is sent at, in pixels. Default 2048. */
  maxSide?: number | undefined;
  /** Called with the ids the field holds, in order, after every photo kept or taken out. */
  onChange: (fileIds: string[]) => void;
  /** Called with whether a photo is still being sent: a screen waits before it saves. */
  onBusy?: ((busy: boolean) => void) | undefined;
  label?: string | undefined;
  ariaLabel?: string | undefined;
  disabled?: boolean | undefined;
  invalid?: boolean | undefined;
}

/**
 * A person's e-mail consent on a record of a table the app declares as
 * people: the panel the dashboard's record page draws ("E-mail consent"),
 * with "Replied", "Record consent…" and "They said no" for a person who may
 * change the record. It reads the same consent log every screen reads, so an
 * app's own line ("May be e-mailed since…") and this panel never disagree.
 *
 * The part asks the server itself, with the person's own session: what it
 * shows and offers is what their rights on the table and the row allow. It
 * never shows an address the server sent (the server sends none); the
 * Record consent form names the person by `name` and `address` as the app's
 * screen shows them to this person, so leave `address` out where it is
 * masked for them.
 *
 * On a table no app declares as people it draws nothing; a record the person
 * may not read is said in a line, with "Try again".
 */
export interface ConsentProps extends KitCommonProps {
  /** `connectionId` of the side's config. */
  connectionId: string;
  /** The table, as the `tables` of the side's config gives it. */
  table: string;
  /** The record's key, as text: what the app's own record route names it by. */
  recordId: string;
  /** The person's name as the screen shows it, for the Record consent form. */
  name?: string | undefined;
  /** Their address as the screen shows it to this person. Leave it out where it is masked for them. */
  address?: string | undefined;
  /** `csrfToken` of the side's config: the server takes no change without it. A new one is taken by `update`. */
  csrfToken: string;
  /** Used in place of the browser's `fetch` (same-origin paths under `/api/v1/consent`). Left out, the browser's own. */
  fetch?: ((input: string, init?: RequestInit) => Promise<Response>) | undefined;
  /** Called after a change was saved (consent recorded, "Replied", "They said no"): an app that shows its own line reads it again. */
  onChange?: (() => void) | undefined;
}

/** A part that is named but cannot be mounted yet. None is, today; the type stays for the next one. */
export type KitPartNotYet = Record<string, never>;

export interface KitPartProps {
  mentions: MentionsProps;
  board: BoardProps;
  map: MapProps;
  import: ImportProps;
  signature: SignatureProps;
  photos: PhotosProps;
  consent: ConsentProps;
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
        : `The kit has no part called "${part}". Its parts are: mentions, board, map, import, signature, photos, consent.`,
    );
    this.name = 'KitPartUnavailableError';
    this.code = code;
    this.part = part;
  }
}
