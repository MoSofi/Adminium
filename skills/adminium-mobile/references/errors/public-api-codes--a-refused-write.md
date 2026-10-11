<!-- produced from apps/docs/src/content/docs/reference/errors.md § Public API codes — A refused write; do not edit -->

# Error codes: Public API codes — A refused write

### A refused write

`PUBLIC_WRITE_REFUSED` is `400`, and `409` on "delete my details" and "make a new link". It takes
one of these shapes:

| params | When |
|---|---|
| none | Anything the guest cannot be told more about: a column the entry does not let them write, a value outside what it allows, a unique or foreign-key refusal, a state move, a locked row, a balance, a refusal that would say what another row holds. |
| `{ column }` | A value the entry `requires` was left empty, or text that must be plain holds a link, a handle or a web address. On a child row, with `child`, `index` and `path`. |
| `{ column, reason }` | The guest's own value, for the reason below. |
| `{ child, reason }` | A list the request sends: `not-offered` (the entry declares no such list), `too-many` or `too-few` (outside its least and most, or more than 200 rows in all). `path` is added for a list below a row. |
| `{ child, index, path }` | A child row writes a column, or a value, its entry does not let a guest write. |
| `{ child, index, path, column, reason }` | A child row's own value. `group` is added when a count by group refused it (too many options of one group). |
| `{ index }`, `{ index, column, reason }` | A row of a batch, by its place in `rows`. |
| `{ max }` | A batch of 0 rows or more than 500, or a request that costs more than the endpoint's rate allows in one window. |

The reasons:

| Reason | The value |
|---|---|
| `required` | Left empty on a create. A change is never told `required`. |
| `too-long` | Longer than the column allows. |
| `too-short`, `too-small`, `too-large` | Outside the column's bounds. Named on a create that goes the tree's way only: child rows, a dry run, a price check, a retry key, a person found by address, a row's own link or an agreement. |
| `format` | Not an address, phone number or web address the column asks for; a time of day that does not read as `HH:MM`; a retry key that is not 22 to 64 letters, digits, `-` or `_`. |
| `invalid-character` | Holds the character U+0000. |
| `unknown` | A typed code that finds no code. |
| `used-up` | A typed code whose uses are all taken. |
| `unchanged` | The row is already in the state the write names (a ticket already let in). |
| `closed` | A closure covers the day, or the venue is closed then. |
| `out-of-hours` | Outside the hours. |
| `out-of-range` | In the past, beyond the booking window, inside the notice, or no place the venue offers (a party of none, no time at all). |
| `not-offered` | The kind is not offered with that person, or the row is not one the entry [agrees](https://docs.adminium.dev/reference/manifest/#a-create-with-its-child-rows) with (an option that is not the chosen dish's). |
| `paused` | The venue paused that slot. |
| `not-on-sale` | What the line asks for is not on sale now. |
| `too-many` | More than one order may take ("up to six per order"), or more than a list or a group allows. |
| `too-few` | Fewer than a list or a group needs. |

`unknown` and `used-up` also spend one of the visitor's guesses at a code.
