---
'@adminium/server': patch
'@adminium/add-on-contracts': patch
---

A forms builder reads one status for its staff: `GET /api/v1/forms/status` answers whether mail a stranger causes goes (and why not), whether strangers can reach the public pages (the Privacy page's own answer), whether the privacy notice is set, the public address, the listed websites and every role by name. It is for a signed-in person who may read an installed forms add-on's forms (a marketer needs neither the privacy nor the roles action), never an API key, and carries no address of a person and no member of a role. `GET /api/v1/forms/mail` answers as before. The kit's forms tables (`useFormTables()`) now give each column's enum `values` and `maxLength`, the table's `sourceColumn` (the app's `source` word), and the `page` slug of a generated page of the table the reader may open, where a row a form became is shown. A forms add-on's kit also says whether the reader may start a campaign (`has['system:settings:manage']`), for its "Send by e-mail".
