<!-- produced from apps/docs/src/content/docs/guides/apps/roles-and-staff-access.md § Personal data; do not edit -->

# App roles and staff access: Personal data

Columns that hold personal data, such as a patient's mobile, email, address or an allergy note, are
masked: a person without the right permission reads them as empty. Two permissions show them:

- **See personal data** on a table shows that table's personal columns, and no other table's. An app
  grants it to the roles whose work needs it, such as a clinic's reception, which rings patients.
- **Manage database connections** shows every table's personal columns. Super Admin and the built-in
  Admin role hold it.

The table asked about is always the one the value lives in. A list of appointments that shows each
patient's mobile needs **See personal data** on the patients table, not on the appointments table.
The same holds for record pages, dashboard cards and exports.

Under **People → Roles & permissions**, **See personal data in records** gives a role the
permission on every table. It is never included in anything else, so no existing role gains it. An
app role's grant on a single table is counted in the line above the matrix and kept when you save.

Live updates pushed to open pages are masked for everyone, whatever their roles, because everyone
watching a table receives the same update.
