<!-- produced from apps/docs/src/content/docs/self-hosting/installing-apps.md § Installing an app — Public access and sample data; do not edit -->

# Installing apps: Installing an app — Public access and sample data

### Public access and sample data

Two boxes can sit under the table check:

- **Public access**, when the app has customer screens. It lists what they will be able to do
  through the public API, and **Allow this public access** is ticked. See
  [An app's public access](https://docs.adminium.dev/guides/apps/public-access/).
- **Sample data**, when the app ships some. **Add sample data** is **not** ticked. When ticked,
  the records are added after the install finishes, and a failure there does not undo the install.
  See [Sample data](https://docs.adminium.dev/guides/apps/sample-data/).

When the app's roles reach tables of an add-on it works with, that add-on's row on the **Add-ons**
card says how many of its tables they get. Open it to see each table, the roles, and the columns
each one reads, changes or fills in. What the app asked for and the add-on does not allow is listed
as not given. See [What an app's roles may hold of its tables](https://docs.adminium.dev/guides/add-ons-with-tables/#what-an-apps-roles-may-hold-of-its-tables).
