<!-- produced from apps/docs/src/content/docs/guides/apps/roles-and-staff-access.md § People who only use the app; do not edit -->

# App roles and staff access: People who only use the app

An app can mark a role as **screens only**: for someone who works in the app and never in the
dashboard, like a cashier. When **every** role a person holds is a screens-only role, that person
is sent to the app instead of the dashboard:

- opening the dashboard takes them to the app's staff screens, on the app's staff domain when one is
  attached, otherwise at `/apps/<key>/staff/`;
- the dashboard's API refuses them with `403` and the code `APP_SCREENS_ONLY`, except for what the
  app's screens need: signing in and out, their own account, the records their roles grant, live
  updates, translations, the server's name and logo (`GET /api/v1/branding` and
  `/api/v1/branding/logo`, from 0.3.50), their own app's documents (drawn for a record, then shown and printed,
  as a front desk prints a folio), and the stock words of an add-on connected to their app
  (`GET /api/v1/words/<add-on>/<words>`: "low", "3 left", the batch about to expire). A document
  still needs every table and column it prints to be one their roles read, and the stock words
  still need a read of the table asked about. They may also bring a file in to a table their
  role may import, from a screen of their app ([the import part](https://docs.adminium.dev/guides/apps/kit-parts/#the-import-wizard)):
  the routes of one import and its progress, each of which still asks the table's own rights. And
  they may upload a file for a [file column](https://docs.adminium.dev/reference/manifest/#files-in-a-column) of a table
  their role creates or changes rows of (a crew's signature and photos), copy a file they may read
  into such a column (`POST /api/v1/files/<id>/copy`: a photo a past order has, chosen again; judged
  by the target table's own create or update, never by a files-wide right), read a file back with
  the record that holds it, and throw away one of their own uploads no record holds yet; the list of
  files and the rest of the file routes stay the dashboard's. A screen of their app may show an
  add-on's [record panel](https://docs.adminium.dev/reference/manifest/#a-panel-on-another-tables-record) too (a design kit's panel on an order
  line): its code (`GET /api/v1/add-ons/<add-on>/panels/<panel>/bundle`) is served for an add-on
  connected to their app, and still only for a row they reach, with a grant on the panel's table
  and the panel's own permission (`page:@<panel>:view` in the app's role). Needs Adminium 0.3.45.
  The files such an add-on ships beside one of its pages (a starter font the panel draws a proof
  with: `GET /api/v1/add-ons/<add-on>/pages/<page>/files/…`) are served to them too, while the
  add-on is connected to their app and their role holds that page's permission
  (`page:@<page>:view`). Needs Adminium 0.3.47.
  They may also ask which add-ons their app has (`GET /api/v1/add-ons`), so a screen offers what
  an add-on adds once it is there ("Book a collection" when a carrier add-on is connected). The
  answer names only the add-ons connected to their own apps, and of each only those apps; it never
  carries an add-on's settings values, whatever their role may change. Needs Adminium 0.3.52.
  And they are served the code with which such an add-on fills a place on their app's staff screens
  (`GET /api/v1/add-ons/<add-on>/bundle/<file>`, a fill of a staff-side slot). The add-ons list
  names only those files, each at an address that ends in `?v=` and a pin of its bytes, so a new
  version is a new address and the browser may keep the file. An add-on's page, or a file that
  fills nothing on their screens, is refused `403`. Needs Adminium 0.3.53.
- the [assistant](https://docs.adminium.dev/guides/llm-assist/milo/#on-an-apps-own-staff-address), when an administrator
  has given their role the assistant permission: its button is on the app's staff screens, and it
  answers about their app's data within what their roles read. An app's manifest cannot grant
  that permission.

Give that person any ordinary role as well, or make them Super Admin, and the dashboard opens for
them again.
