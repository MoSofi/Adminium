<!-- produced from apps/docs/src/content/docs/projects/page-files.md § In `npm run dev`, the folder wins; do not edit -->

# Page files: In `npm run dev`, the folder wins

While `dev` runs, the folder is the master copy and Studio writes back into it:

| | |
|---|---|
| You save a page or schema file | It is applied at once, and open pages reload. Adminium prints `Applied pages/contacts.json.` |
| You delete a file | Its page is removed |
| You edit a page in Studio | The change is saved and written to its file, touching only the lines that changed |
| You create a page in Studio | A new file is written for it |
| A command such as `apply-llm-response` changed something | It is written to its file, including changes made while `dev` was not running |
| Both the file and the database changed | The file wins, and `dev` says so |
| A file has a mistake | It is not applied, the last good version stays in use, and the reason names the file and the field |

The last one, in full:

```
pages/contacts.json was not applied:
  source.database: "billing" is not a database in adminium.config.ts, or it has no connection yet
```

```
pages/contacts.json was not applied:
  not valid JSON: Expected ',' or '}' after property value (line 4, column 3)
```
