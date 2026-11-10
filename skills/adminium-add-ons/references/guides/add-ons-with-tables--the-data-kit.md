<!-- produced from apps/docs/src/content/docs/guides/add-ons-with-tables.md § The data kit; do not edit -->

# Add-ons that keep tables of their own: The data kit

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
| `useWrite(table)` | `create`, `update`, `remove`, and `createEach` / `updateEach` for up to 500 rows, one save each. `updateEach` takes `{from}`, the state the rows were seen in, and answers what a ledger said of each row. `remove(key, { reason })` says why, for a table that asks ([Removed rows](https://docs.adminium.dev/reference/manifest/#removed-rows)). |
| `useTreeWrite(table)` | A row with the rows under it in one save, and a `dryRun` of it. |
| `useStateMove(table)` | Makes one of the table's declared [actions](https://docs.adminium.dev/reference/manifest/#buttons-on-a-record) on a row. |
| `useAccess()` | `canRead`, `canCreate`, `canUpdate`, `canMove`, `has(feature)`, and `currency`: the currency of the database your tables are in, or `null` when the owner set none. |
| `useLookUp()` | Finds a row by a typed or scanned code, through the add-on's [`lookUp`](https://docs.adminium.dev/reference/manifest/#what-a-typed-code-may-find). |
| `useWords(id)` | Asks the add-on's [stock words](https://docs.adminium.dev/reference/manifest/#stock-words) about up to 60 rows. |
| `useDocument()` | Draws a document for a row and opens it, or prints it. |
| `useExport()` | Starts an export of a table's rows and downloads it. |
| `useFormSummary(formId)` | A forms add-on: the form's results, counted by Adminium over every answer (per choice, per score, per star, the recommend score, answers per language, and how many were invited and answered), under the reader's read grant on the answers. No row reaches the page. From Adminium 0.3.40. |
| `useFormTables()` | A forms add-on: the tables an app opens to forms (its `publicAccess` entry under the key `forms`), each with its app's name and the columns an answer may fill, the link columns marked (filled only from a named survey's invitation). A page lists them and reads none of their rows. From Adminium 0.3.40. |
| `useUpload(table, column)` | `upload(key, file, { name? })` puts a file into a file column of one of the add-on's own rows: the bytes are judged by the column's rule, then the row is saved with the file. Answers the reference the column holds, the file's id, name, type, size, and `removed`: what was taken out of an SVG. See [Files in its own columns](https://docs.adminium.dev/guides/add-ons-with-tables/#files-in-its-own-columns). From Adminium 0.3.43. |

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
