<!-- produced from apps/docs/src/content/docs/guides/apps/roles-and-staff-access.md § People who only use the app; do not edit -->

# App roles and staff access: People who only use the app

An app can mark a role as **screens only**: for someone who works in the app and never in the
dashboard, like a cashier. When **every** role a person holds is a screens-only role, that person
is sent to the app instead of the dashboard:

- opening the dashboard takes them to the app's staff screens, on the app's staff domain when one is
  attached, otherwise at `/apps/<key>/staff/`;
- the dashboard's API refuses them with `403` and the code `APP_SCREENS_ONLY`, except for what the
  app's screens need: signing in and out, their own account, the records their roles grant, live
  updates, translations, their own app's documents (drawn for a record, then shown and printed,
  as a front desk prints a folio), and the stock words of an add-on connected to their app
  (`GET /api/v1/words/<add-on>/<words>`: "low", "3 left", the batch about to expire). A document
  still needs every table and column it prints to be one their roles read, and the stock words
  still need a read of the table asked about.
- the [assistant](https://docs.adminium.dev/guides/llm-assist/milo/#on-an-apps-own-staff-address), when an administrator
  has given their role the assistant permission: its button is on the app's staff screens, and it
  answers about their app's data within what their roles read. An app's manifest cannot grant
  that permission.

Give that person any ordinary role as well, or make them Super Admin, and the dashboard opens for
them again.
