<!-- produced from apps/docs/src/content/docs/projects/apps.md; do not edit -->

# An app in your project

An **app** is a product Adminium hosts: tables in your database, pages in the dashboard, and
optionally screens of its own for staff and for customers. The apps on
[adminium.dev](https://adminium.dev/marketplace) are made this way, and you can make your own in a
[project](https://docs.adminium.dev/projects/).

An app of yours lives in the project's `apps/` folder, one folder per app, named after the app's
key:

```
my-admin/
├── adminium.config.ts
└── apps/
    └── repairs/
        ├── manifest/
        │   ├── app.json            the app itself: key, name, version, publisher, sides
        │   ├── tables/jobs.json    one file per table
        │   ├── pages/jobs.json     one file per dashboard page
        │   ├── roles.json
        │   ├── access.json         what the customer side may read and write
        │   └── sample.json         names the sample data file
        ├── staff/                  screens for staff (optional)
        ├── customer/               screens for customers (optional)
        └── seeds/sample.json       sample data (optional)
```
