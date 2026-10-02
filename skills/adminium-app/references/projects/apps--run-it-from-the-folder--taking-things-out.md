<!-- produced from apps/docs/src/content/docs/projects/apps.md § Run it from the folder — Taking things out; do not edit -->

# An app in your project: Run it from the folder — Taking things out

### Taking things out

When the manifest no longer declares something, the next apply deals with it:

| Taken out of the manifest | What happens |
|---|---|
| a page | Removed. A page somebody edited in Studio is kept, as an ordinary page of yours |
| a role | Removed with its grants. The terminal says how many people and API keys held it |
| all of its emails, or all of its documents | Removed, as an uninstall removes them |
| what the customer side may reach | Taken back from the app's key at once |
| a table or a column **that holds nothing** | Dropped |
| a table or a column **that holds data** | Kept, and asked about |
| a column that now holds less (a shorter text, an option taken away, a value now required) | Never changed in the database. The rows that no longer fit are counted and stay as they are; new writes follow the new rule |

Nothing that holds data is dropped on the way. The rest of the manifest is applied, and the question
waits in **Studio → Hosted apps**, under the app:

```
apps/repairs/ no longer declares these, and they hold data. Nothing was removed.
  · The column repairs_items.colour: 2 rows hold a value
[Keep the data]  [Remove them]
```

**Keep the data** leaves the table or column in the database and takes it out of the app; the same
manifest does not ask again. **Remove them** drops them, with their data, and takes a second click
and a Super Admin. The same question can be read and answered without Studio:
`GET /api/v1/project/apps/<key>/removals`, and `POST` the same address with `{ "accept": true }` or
`{ "accept": false }`.

A column that stays — kept, or still waiting for its answer — would refuse every new row if it
required a value, because the app no longer gives it one. Such a column is made optional in the
database, which loses nothing, and the log says so. This is only ever done to a table the app made
itself and uses alone; a column of a table another app or an add-on also uses is always kept.
