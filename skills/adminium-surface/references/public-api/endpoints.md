<!-- produced from apps/docs/src/content/docs/guides/public-api/endpoints-and-keys.md § Endpoints; do not edit -->

# Endpoints and keys: Endpoints

An endpoint is one route, such as `/orders`, over one table or view. Open **API keys**
from Workspace settings to see them.

Every table has an endpoint generated from your schema. It stays virtual until a key
grants it or you edit it, and then it is stored. A generated endpoint:

- exposes every column that is not a secret and not marked as personal data;
- offers every method the table supports — GET, POST, PATCH, PUT, DELETE and BATCH on a
  table with a primary key. It offers no DELETE when another table's foreign key would
  cascade into rows the endpoint was never granted, and no POST when the server cannot
  choose the new row's key;
- returns 20 rows by default and at most 200, newest primary key first;
- is limited to 120 requests a minute.

A column added to the table later is never exposed by itself. Open the endpoint and add
it.

An installed app with customer screens makes its own endpoints and one browser key at
install, marked as the app's. That key can never be widened, and it stops when the app is
switched off. See [An app's public access](https://docs.adminium.dev/guides/apps/public-access/).

**Edit endpoint** opens the builder. The form on the left and the JSON definition on the
right are the same document, and editing one updates the other. The definition also
accepts keys the form does not draw (`writable`, `defaults`, `filterable`, `searchable`,
`orderable`, `identity`, `sensitive`, `allow_cascade`), and the form keeps them when you
edit. Save is refused while the JSON has changes you have not applied, and a save that
would break a live key names that key.

**Default filters** are the rows an endpoint can reach at all. They are part of every
statement the endpoint runs, reads and writes alike, and a caller cannot remove them.
