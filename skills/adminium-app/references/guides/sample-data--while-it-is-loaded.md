<!-- produced from apps/docs/src/content/docs/guides/apps/sample-data.md § While it is loaded; do not edit -->

# Sample data: While it is loaded

The app's own pages in the dashboard show **Sample data is loaded** at the top, with **Remove it**.
Only people who can manage apps see this line.

Adminium keeps a list of every record and image it added, in a table of its own in the app's
database, named after the app's key with `_sample_data` at the end (for example
`pos_sample_data`). The **Data** card lists it as "Adminium's list of sample records". It is made the
first time you add sample data, and it is left out of the app's pages and of the public API.
