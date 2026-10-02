<!-- produced from apps/docs/src/content/docs/self-hosting/installing-apps.md § Tables made before prefixes; do not edit -->

# Installing apps: Tables made before prefixes

An app that started prefixing its tables in a later version may still be installed under the old,
plain names. Its row on **Installed apps**, and the **Data** card on its settings page, then say
**This install uses the old table names.** and offer **Rename to** *prefix*….

The dialog lists every table with its new name before anything runs. **Rename tables** renames
them all in one schema change, and Adminium updates its own pages, grants, column rules, public
endpoints and table records to the new names. Open dashboards and the app's screens read the new
names without a restart.
