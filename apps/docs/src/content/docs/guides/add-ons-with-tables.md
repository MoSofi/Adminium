---
title: Add-ons that keep tables of their own
description: What an add-on may declare beside its code — tables under its own prefix, pages, roles, option lists, starting rows, emails, public entries — and how Adminium installs, updates and removes it.
---

Most add-ons draw something for an app: an invoice, a shipping label. Some keep data of their own:
a stock list, gift cards. From Adminium 0.3.18 such an add-on declares its tables, pages and roles
in its manifest, in the same words an app uses, and Adminium installs them the way it installs an
app. This page says what that means for you as the owner of the server. The fields themselves are
in the [manifest reference](/reference/manifest/#add-on-manifests).

## What it may declare

- **Tables**, always under the add-on's own prefix: the add-on `stock-kit` makes `stock_kit_items`,
  never `items`. A table of yours that already has one of those names is never renamed or changed:
  the check says so and the install stops.
- **Pages** in the dashboard, generated ones and screens of its own code, in a section of the
  sidebar that carries the add-on's name.
- **Roles** that open those pages and tables. Whoever installs the add-on is given its first role,
  so they can open what they just installed. Nobody else gets one until you assign it.
- **Lists of choices** for its columns, **document layouts** for its rows, **emails** it sends from
  a table of its own, and a few **starting rows** (units of measure, reasons, its one settings row).
- **Public entries**, described [below](#what-it-opens-to-the-public).

## One database

All of an add-on's tables go in one database, chosen at install and kept on its record. With one
database connected, nobody is asked. With several, the install dialog asks "Which database?" and
shows what will be made there before you confirm. An add-on cannot be moved to another database
later; uninstall it and install it again where you want it.

## The check, before anything is made

Studio › Add-ons shows, before you confirm: the tables it creates, the pages and roles it adds,
its lists, whether its tables start with rows, and what it would open to the public. The install
makes exactly that. If the database changed between the check and the install, the install stops
and asks you to check again.

An install that stops part way (a full disk, a lost connection) undoes nothing and says at which
step it stopped. Press Install again: it carries on from there, and nothing is made twice.

## Its pages are a screen, not a wall

A page of the add-on's own code is shown only to someone whose role holds that page. That hides
the screen. What actually protects the data is the same thing that protects every table in
Adminium: a person reads or writes one of the add-on's tables only with a role that grants that
table, whichever screen or API they come through.

The page's code is handed out the same way: only to someone who may open the page, and to nobody
while the add-on is switched off for the dashboard. Three rules keep that true:

- A page is built into a file of its own. A file a slot loads is served to everybody signed in, so
  an add-on whose page and slot name the same file is refused.
- A page's name opens it, so no two add-ons installed together may share one. An add-on whose page
  is named under another installed add-on's key (`inventory` naming `inventory-pro-stock` beside
  `inventory-pro`) is refused with `ADD_ON_PAGE_REF_TAKEN`.
- A version that drops a page takes the page back from the add-on's roles, and uninstalling takes
  it back from every role, your own included.

## The data kit

A page of the add-on's own code does not fetch its tables itself. It imports
`@adminium/add-on-data`, which the build aliases to a shim, and gets the dashboard's own parts and
hooks: the signed-in reader's grants, the dashboard's cache, its look in light, dark and
right-to-left. A manifest whose pages use it says `"hostApi": 2`.

```tsx
import { Card, DataTable, StatusPill, useAccess, useRecords, useWrite } from '@adminium/add-on-data';

export default function Transfers() {
  const { rows, loading } = useRecords('transfers', { sort: [{ column: 'id', direction: 'desc' }] });
  const { canCreate } = useAccess();
  // …
}
```

Tables are named by the add-on's own short names (`transfers`, never `inventory_transfers`).
Nothing a page does through the kit is something its reader could not do on a generated page: a
read or a write the role does not grant is refused the same way.

| Hook | What it gives |
|---|---|
| `useRecords(table, options?)` | A filtered, sorted page of rows, and whether more exist. The server filters and pages. |
| `useRecord(table, key)` | One row. |
| `useRead()` | `list` and `get` as promises, for a read made when something happens (a scan, a run over a sheet's lines) and not while the page is drawn. |
| `useWrite(table)` | `create`, `update`, `remove`, and `createEach` / `updateEach` for up to 500 rows, one save each. `updateEach` takes `{from}`, the state the rows were seen in, and answers what a ledger said of each row. `remove(key, { reason })` says why, for a table that asks ([Removed rows](/reference/manifest/#removed-rows)). |
| `useTreeWrite(table)` | A row with the rows under it in one save, and a `dryRun` of it. |
| `useStateMove(table)` | Makes one of the table's declared [actions](/reference/manifest/#buttons-on-a-record) on a row. |
| `useAccess()` | `canRead`, `canCreate`, `canUpdate`, `canMove`, `has(feature)`, and `currency`: the currency of the database your tables are in, or `null` when the owner set none. |
| `useLookUp()` | Finds a row by a typed or scanned code, through the add-on's [`lookUp`](/reference/manifest/#what-a-typed-code-may-find). |
| `useWords(id)` | Asks the add-on's [stock words](/reference/manifest/#stock-words) about up to 60 rows. |
| `useDocument()` | Draws a document for a row and opens it, or prints it. |
| `useExport()` | Starts an export of a table's rows and downloads it. |
| `useFormSummary(formId)` | A forms add-on: the form's results, counted by Adminium over every answer (per choice, per score, per star, the recommend score, answers per language, and how many were invited and answered), under the reader's read grant on the answers. No row reaches the page. From Adminium 0.3.40. |
| `useFormTables()` | A forms add-on: the tables an app opens to forms (its `publicAccess` entry under the key `forms`), each with its app's name and the columns an answer may fill, the link columns marked (filled only from a named survey's invitation). A page lists them and reads none of their rows. From Adminium 0.3.40. |
| `useUpload(table, column)` | `upload(key, file, { name? })` puts a file into a file column of one of the add-on's own rows: the bytes are judged by the column's rule, then the row is saved with the file. Answers the reference the column holds, the file's id, name, type, size, and `removed`: what was taken out of an SVG. See [Files in its own columns](#files-in-its-own-columns). From Adminium 0.3.43. |

The parts are `Card`, `Grid`, `Stack`, `Sheet` (with `SheetHeader`, `SheetBody`, `SheetFooter`),
`StickyBar`, `Divider`, `Skeleton`, `DataTable`, `Stat`, `KeyValueList`, `StatusPill`,
`ProgressBar`, `Pagination`, `MonoText`, `Field`, `Input`, `NumberInput`, `Textarea`, `DateInput`,
`Select`, `Combobox`, `Switch`, `Checkbox`, `RadioGroup`, `RadioCard`, `ToggleChip`, `InputGroup`,
`Menu`, `MenuItem`, `ConfirmModal` and `Link`.

Three things to know:

- **Lay a page out with the parts.** A class of your own is in no stylesheet the dashboard
  loads. A part carries no words: pass every label from the add-on's own strings.
- **Money and decimals are text** in a row, so no figure is rounded on the way.
- **An older Adminium has no kit.** Importing the shim there throws, and the dashboard shows "This
  page needs a newer Adminium." in place of the page. `compatibility.minAdminiumVersion` keeps the
  add-on from being installed there in the first place.

### Printing from a page

`useDocument().open(kind, table, key, options?)` draws one of the add-on's
[documents](/reference/manifest/#documents) for a row of one of its tables and opens it;
`{ "print": true }` opens the print dialog, and `paper` picks one of the papers the kind lists
(`a4`, `letter`, `receipt-80mm`, `a6`). The reader must be able to read everything the document
reads. A document that prints a [money code](/reference/manifest/#documents-that-print-a-money-code)
is kept nowhere, so it is not in the documents register: pass the `once` ticket the create
answered to print the code that was shown once.

### Files in its own columns

A column of one of the add-on's tables holds files when its manifest gives it a
[`file` rule](/reference/manifest/#files-in-a-column): the kinds it takes and how large one may be. A
page puts a file there with `useUpload`:

```tsx
const { upload, uploading, error } = useUpload('bases', 'outline_file');

const done = await upload(base.id, picked); // a File from an <input type="file">
if (done.removed.length > 0) say(`We removed ${done.removed.join(', ')}.`);
```

It does what a record form does, in two steps. The bytes go to the files route for that table and
column, where they are read whole: a file of a kind the column does not take is refused by what it
is (not by its name), an SVG is kept only as Adminium writes it again (a script, an event handler
or an editor's notes are taken out, and named in `removed`; a part that would draw something else,
such as a `foreignObject`, refuses the file), and a WOFF2 font, a GLB, STL or 3MF model is checked
before it is kept. Then the row is saved with the reference in the column, through every rule of
the table. That save is when the file becomes the row's.

The reader needs `update` on the table, and their role must be able to write that column. A
reader without them is refused (`403`), and so is a file the column does not take (`415`, with a
sentence that names what was wrong). A file whose save is refused is thrown away at once.

`useUpload` is absent from an Adminium older than 0.3.43. Check for it before offering an upload
(`host.data.useUpload` is undefined there), and ask for 0.3.43 in
`compatibility.minAdminiumVersion` once the add-on relies on it.

### Reading an app's prices

An add-on's features may cost the shopper something, and the price is the app's: each app sells
them at its own price. The app keeps it on a row of its own that links to the add-on's row with
[`addOnLink`](/reference/manifest/#binding-an-add-on-to-the-apps-rows), and a page of the add-on reads it
there. Nothing new is granted for it.

```json
{ "ref": "options", "columns": [
  { "ref": "feature_id", "type": "int", "nullable": true,
    "rules": { "addOnLink": { "addOn": "customiser", "table": "features" } } },
  { "ref": "price", "type": "decimal", "scale": 2 },
  { "ref": "cost", "type": "decimal", "scale": 2 } ] }
```

A table with a link into one of the add-on's tables is one of those that hand it rows, so the
kit's read lists it as `maker:options`, and `useRecords('maker:options', …)` reads it. The page
reads it with the reader's own grant on the app's table, which the app's role gives. Give it only
the link and the price:

```json
{ "key": "designer", "name": "Designer",
  "permissions": ["table:@options:read"],
  "limits": { "options": { "readable": ["feature_id", "price"] } },
  "tables": [{ "addOn": "customiser", "table": "features", "actions": ["read"] }] }
```

```tsx
const { rows } = useRecords('maker:options', {
  filter: [{ column: 'feature_id', op: 'in', value: featureIds }],
  columns: ['feature_id', 'price'],
});
```

The price comes back as text, so nothing is rounded. A page only reads such a table: a write there
is refused. A reader whose role does not read it is refused (`403`), so show the feature without
its price then.

## Starting rows

An add-on may ship rows its tables hold from the first second. They are written once, at install,
into a table that is empty, in the language of the person installing. They are your rows from then
on: change or delete them freely. Installing the add-on again over tables you kept adds none of
them a second time, and removing sample data never touches them.

## Updating

An update may add tables, columns and indexes to the add-on's own tables. Studio shows what it
adds first when it changes a table or would open something new to the public. While an update
runs the add-on does nothing; when it stops part way, press Update again.

An add-on installed on several databases (one copy for each app's database) runs one version
everywhere: **Update** on the Add-ons page updates every copy in turn, each through its own check
named by its database. An app whose new version needs a newer add-on is updated after every copy
of that add-on is.

A version that would let visitors see more through an endpoint they already use (its entry shows
one more column, say) lists each such endpoint on the check, and the update waits until you tick
**Allow it**. Through the API, send `"publicWider": true`; without it the update is refused with
`PUBLIC_WIDER` before anything moves.

What you changed is kept: a page you edited, a rule you changed, a role you narrowed.

## Removing

Uninstalling removes its pages, roles, rules, email templates, public entries and keys. **Its
tables stay, with every row**, unless you tick "Also delete its tables" and type its key, which
needs Super Admin. A page you edited stays as an ordinary page of your own.

A key you made by hand that reads one of its public entries loses that entry too: it does not go
on serving a table the add-on left behind.

It cannot be removed while an app still hands rows to it or uses it for a feature that is switched
on; the dialog says which.

## A ledger, and code that decides

An add-on may keep a [ledger](/reference/manifest/#ledgers): tables Adminium writes for it inside
the save of another table's row, from rows the add-on's own code answers. The add-on thinks;
Adminium reads and writes.

The code is **one file**, a classic script with no `import` and no `require`, at most 512 KiB,
that sets `module.exports = { rows }`. `rows(input)` is called with the lines to plan, the rows
Adminium read for it (the action's `reads`), the add-on's one settings row, and the moment as
text (`now`, `today`, `zone`). It answers the rows to insert or update, any refusals, and — in
`words` mode — what is left of each line.

- **It is pure.** No clock, no randomness, no network, no timers: `Date`, `Intl`, `Math.random`,
  `fetch`, `setTimeout`, `eval` and `Function` are not there. The same input gives the same
  answer.
- **It is quick.** A call is stopped at 250 ms and the save refused; a call over 50 ms is logged.
  The server waits on it, so a slow answer slows every request.
- **It is checked.** Every row it answers must be for a table and column the ledger's `writes`
  list, must hang under a row one of its reads returned, and is prepared, capped and settled by
  Adminium like any row. An answer that fails a check fails the save
  (`POSTING_REFUSED {reason: "planner-failed"}`) and leaves one audit row, `ledger.refused`, that
  says which check.
- **This is hardening, not a sandbox.** It stops mistakes, not an attacker. So the file runs only
  when its package is one this server can vouch for: bundled with the release, or downloaded from
  the catalogue. A package uploaded by hand installs, and every save that would ask its code is
  refused `add-on-unavailable` until that version is released. On a developer's own server,
  `ADMINIUM_ADD_ON_DEV_TRUST` names the add-ons whose code runs as it is.

The contracts package ships a conformance suite, `postingRowsConformance`, that an add-on's own
tests run over its case table: every answer inside `writes`, a give-back that nets to zero, two
calls that agree.

## Checking a design

An add-on that keeps designs may answer the question an order line asks before it is ordered:
does this design stand, and which priced features does it use? It declares
[`addOn.checker`](/reference/manifest/#the-design-question) and provides the contract
`design-check`, version 1, as one more method of the same kind of file: `module.exports = { check }`,
pure, at most 250 ms, run only from a package this server can vouch for. An app asks it with a
[`check`](/reference/manifest/#a-design-an-add-on-checks) rule on its order lines.

`check(input)` is called once for the save's lines (and once for the dry run, the same way):

- `mode`: `save` or `dry`;
- `lines`: for each line that names a design, its `key`, the `design` row, the `rows` of each
  declared read by its `id`, the feature codes the line pays for (`paid`, each once, sorted), and
  the design's `files`: `{ column, kind, size }` for each file a file column of the design holds
  (`kind` its type as stored, `size` in bytes; `""` and `0` for a file that is not there), never
  its bytes;
- `settings`: the add-on's settings row; `version`: its installed version.

It answers `{ lines: [{ key, ok, used, refusals }] }`: one entry for each line and no other, the
features the design `used`, and `refusals` (`{ part?, reason }`, from the closed list) exactly
when `ok` is false. The answer is checked before it is read; a fault in it refuses the save.
Adminium then holds each line to it: a refusal refuses the save, and the features used must be
the features paid for, both ways. There are no fonts: a rule about how much text fits is
arithmetic on the sizes the design declares (its most characters at its base size, scaled by the
size chosen), the same arithmetic the browser runs.

The contracts package ships `designCheckConformance` (in its testing entry, beside
`priceAdjustConformance`) for an add-on's own tests to run over its case table — the answer's
shape, every line answered once, a dry run answered as the save, the same answer twice — and
`checkQuestion` to build a question the way Adminium puts one.

## A panel on another table's record

A page of the add-on's own code may also be drawn on another table's record page:
[`addOn.panels`](/reference/manifest/#a-panel-on-another-tables-record) names the file, the
add-on's table that the record links into, and the tab's title. The panel is handed the record and
the key of the row it links to, and runs with the data kit of the add-on's own tables. It is
shown only to a reader who reads the record, holds a grant on that table of the add-on's, and
holds the panel's permission, which the add-on's roles grant as `page:@<id>:view`.

## What an app's roles may hold of its tables

An app that names the add-on may give its own roles a hold on the add-on's tables: a hotel's
housekeeping adds stock transfers, a sales team reads what is in stock. Those rows are the
add-on's, and another app may use them too. So the add-on says how far an app's role may go, table
by table, with [`appGrants`](/reference/manifest/#what-an-apps-role-may-hold-of-an-add-ons-table):
which actions, and which columns it may read, change or fill in.

```json
{ "ref": "items", "columns": [ … ],
  "appGrants": { "actions": ["read"], "never": ["cost_avg", "supplier_cost", "value"] } }
```

- **Say it for every table an app may use.** Once one table has it, a table without it is given to
  no app's role.
- **Name what an app may write.** `writable` and `creatable` are lists, never "every column". Leave
  out what decides where something is sent or what it costs: a supplier's address, a price.
- **Keep back what only your own staff should read** with `readable` (the only columns) or `never`
  (every column but these). A secret is never read either way.
- An add-on that says nothing is held only by its own shape, as before: no hold on a ledger's
  receipt table, read only on a table its ledger writes. Add `appGrants` in a release that asks for
  Adminium 0.3.28.

What an app asks for past it is left out and named. As the owner, you see each role's hold with its
columns on the install check, under the add-on's row ("…'s roles get 6 of its tables"). An app
update that would let its roles do more with an add-on's tables shows what is new and asks before
it is given. An add-on update that narrows its `appGrants` narrows what the apps' roles hold at
once; one that widens them lists each app's role that would get more, and asks before it is given
(Studio's **Update** button allows it; through the API, `"roleTables": true`, or the update is
refused with `ROLE_TABLES_WIDER`).

## Rules, tabs and stock words

Three more things are declared, not coded:

- **Rules it ships** ([`automations`](/reference/manifest/#automations)): installed with the
  add-on and shown on the rules page under "From your add-ons", where the owner switches them or
  edits a copy.
- **A tab on another table's record** ([`addOn.recordTabs`](/reference/manifest/#a-tab-on-another-tables-record)):
  the add-on's rows for a dish, a product or an order, listed on that record's own page. Where the
  add-on needs its own code there, it declares a [panel](#a-panel-on-another-tables-record).
- **Stock words** ([`addOn.words`](/reference/manifest/#stock-words)): "in", "low" or "out" for
  each row a page asks about, answered by the ledger's code with nothing written. Answer each line
  by itself: a page asks about many rows at once, and one row's answer must not depend on the
  others in the same question.

## What it opens to the public

An add-on may ask for two kinds of public access. Neither is opened by installing it.

1. **Entries served through an app's public key.** A gift-card add-on may let a customer read a
   card's balance by typing its code on the shop's own page. Such an entry is put on the public key
   of an app that names the add-on, and only when you tick **Allow public access** — and only if
   you may manage API keys. Left unticked, the add-on is installed and its entries wait.
2. **One link key of its own.** Whoever holds a row's link opens that one row and can only read
   it. It is made with the same tick.

The entries leave an app's key the moment the add-on stops being there for that app: when you
switch it off for the app, uninstall it, or update it to a version that drops the entry. Switching
it back on does not put them back by itself; Studio asks.

See [An app's public access](/guides/apps/public-access/#what-an-add-on-adds) for how this looks
from the app's side.
