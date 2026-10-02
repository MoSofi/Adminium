<!-- produced from apps/docs/src/content/docs/guides/apps/roles-and-staff-access.md § Who may open an app's staff screens; do not edit -->

# App roles and staff access: Who may open an app's staff screens

Under **People → Roles & permissions**, the **Apps** rows decide it:

- **Open every app's staff screens** covers every installed app, now and later.
- **Open** *app*'s staff screens covers one app.

Super Admin needs neither. The built-in Admin, Editor and Viewer roles hold **Open every app's
staff screens** from the start, so anyone with one of them can open every app. A role you create
starts without it, like every other permission; tick one of the rows to give it.

The permission is checked on every address the staff screens answer on: `/apps/<key>/staff/`, an
extra instance, a domain mapped to them, and inside the dashboard.
