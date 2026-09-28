---
title: A menu two apps share
description: How two installed apps, such as a point of sale and online ordering, keep one menu between them, what the install offers, what stays when either leaves, and how sample data keeps off a real menu.
---

A restaurant runs its till on Point of Sale and takes pickup orders online. Both apps need the
menu, and the restaurant wants one menu: a dish renamed or marked sold out at the till reads the
same on the website a moment later. Two apps can share tables for this, when both declare them
with the same **shape**.

The manifest fields are in the [manifest reference](/reference/manifest/#shared-tables).

## A shape

A shape is a set of tables Adminium itself writes down, column by column, so two apps can agree on
them. Adminium knows one: `menu@1`, the menu Point of Sale keeps, in four tables.

| Table | What it holds |
|---|---|
| `menu_categories` | The menu's sections: a name, a slug, a position, an icon and a tint. |
| `menu_items` | The dishes: category, name, short name, description, price, image, available, featured, tags, position, barcode. |
| `modifier_groups` | A dish's choices ("Size", "Extras"): pick one or pick several, with the fewest and the most a guest may pick. |
| `modifiers` | The options in a group, each with a price difference and whether it is available. |

An app shares a table by declaring it under its part's name, with `"shape": "menu@1"`:

```json
{
  "ref": "menu_categories",
  "shape": "menu@1",
  "columns": [
    { "ref": "id", "type": "int", "role": "pk" },
    { "ref": "slug", "type": "text", "maxLength": 48, "nullable": true },
    { "ref": "name", "type": "text", "maxLength": 80 },
    { "ref": "position", "type": "int", "default": 0 },
    { "ref": "icon", "type": "text", "maxLength": 40, "nullable": true },
    { "ref": "tint", "type": "text", "maxLength": 32, "nullable": true }
  ]
}
```

An app need not declare all four. It declares the ones it uses, and every table one of them links
to: dishes need their categories, and options need their groups, which need their dishes. The
manifest check holds each declared table to the shape, so neither app can write what the other
would refuse:

| Rule | What the check refuses |
|---|---|
| The table is a part of the shape | A shape Adminium does not know (`TABLE_SHAPE_UNKNOWN`), a table that is no part of it (`TABLE_SHAPE_PART`). |
| Every column of the part is there, declared as the part declares it | A column missing, retyped or of another length (`TABLE_SHAPE_MISMATCH`). Labels and the `semantic` hint are the app's own. The only rule an app may add to a part's column is `enumLabels`: any other would refuse the other app's writes. |
| A part's link points at a part the app declares | Dishes declared without their categories (`TABLE_SHAPE_REFERENCE`). |
| A column the app adds is one the other app can ignore | A column that is required with no default, unique, numbered or coded by Adminium, or linking to a table outside the shape (`TABLE_SHAPE_EXTRA`). |
| The table carries no rule over the other app's rows | States, a capacity, a booking rule or a unique set on a shared table (`TABLE_SHAPE_TABLE_RULE`). |

So an online shop may add the portions left for the day to the dishes, as long as the column may
be empty:

```json
{ "ref": "stock_today", "type": "int", "nullable": true }
```

A limit that counts against those portions lives on the shop's own order lines, not on the shared
dishes. It counts the shop's orders only: the till's walk-in sales of the same dish do not use up
the portions offered online.

## Installing the second app

Install Point of Sale, then the online shop, or the other way round. When the second app declares
a shape the first already keeps tables of, **Check the tables** asks which menu it uses:

- **Use Point of Sale's menu.** The recommended answer, and the one taken when none is given. Its
  tables show the badge **Shared with Point of Sale**, under Point of Sale's real names
  (`pos_menu_items`), whatever prefix the shop's own tables get. Columns the shop adds are listed
  ("Adds 2 columns to Point of Sale's tables") and are added to those tables; nothing Point of Sale
  reads changes. The shop's order lines then point at Point of Sale's dishes.
- **Keep a separate menu.** The shop makes its own tables under its own prefix, and the two menus
  never meet.

When more than one installed app keeps that menu, each is offered, and the first installed is
recommended. Through the API, the install takes the answer per shape:
`"shares": { "menu@1": { "action": "share", "with": "pos" } }`, or `{ "action": "separate" }`.

Two more things follow from sharing:

- **Rules both apps keep.** Labels, choices and column rules on a shared table are kept once. A
  rule the first app already keeps is not written again: the install skips it and names the app
  that keeps it.
- **Public endpoints.** A public endpoint takes its name from the table's real name, so two apps
  sharing a table can ask for the same one. The check then says so with `SHARE_REF_TAKEN`, naming
  the endpoint and whose it is, and **Install** is refused until the app keeps a separate menu or
  that endpoint is removed.

## While both are installed

- **Both read and write the same rows.** A dish the till adds and renames reads renamed through
  the shop's public key.
- **Switching one app off** leaves the other's pages, roles and public key on the shared menu
  working.
- **Updates go on sharing.** A new version of either app that adds a column adds it to the shared
  table, under the same rules as any column an app adds.
- **Dropping the shape.** An update that stops declaring a table's shape while another app shares
  it is refused with `409` `SHAPE_IN_USE`, naming that app: it goes on writing the table as the
  shape. Uninstall that app first, or keep the shape. When no other app shares the table, the
  update is applied and the shape is cleared from it, so a later app is no longer offered it.
- **Never renamed out of the way.** When a check finds one of an app's names taken, it can offer to
  rename the existing table. A table another app still uses is never offered for renaming.

## When one app leaves

Uninstall either app and the shared tables stay, for the other:

- **The preview names the other app.** The uninstall dialog lists the shared tables as kept:
  "Online Ordering also uses 4 tables, never deleted". **Also delete its tables and data** drops
  only tables no other app uses. It makes no difference which app made the menu first.
- **Its rules are handed over.** The labels and choices the leaving app kept on the shared tables
  pass to the app that stays (to the first installed, when several do), so the menu reads as it
  did. They survive that app's updates, unless a version of it declares its own value for the same
  column, which then replaces the handed one. They are taken back when the last app using the
  table leaves. A rule someone changed by hand stays theirs, as always.
- **Its sample rows stay.** Sample rows the leaving app put in the shared tables are kept with
  them. Remove its sample data before uninstalling to take them out.

**Reinstalling.** An app installed again beside a menu it used to share is offered that menu
again, recommended, exactly as the first time. It can still choose **Keep a separate menu**.

## Sample data on a shared menu

Each app may ship sample dishes. A venue's real menu should never gain them, nor sample orders of
them. `sampleData.skipWhenShared` keeps an app's sample rows off a shared table that already holds
real rows:

```json
"sampleData": {
  "file": "seeds/ordering.sample.json",
  "skipWhenShared": {
    "table": "menu_items",
    "skip": ["menu_categories", "menu_items", "modifier_groups", "modifiers", "orders", "order_items"]
  }
}
```

When sample data is added, Adminium looks at `table`. If another installed app uses it too and it
holds at least one real row (a row no installed app's sample data added), the sample rows of every
table in `skip` are left out: the dialog does not list them, and nothing is written there. A
shared menu that holds only sample rows, or a menu the app keeps alone, takes the whole sample.

| Field | Rule |
|---|---|
| `table` | One of the app's tables, declared with a `shape`. |
| `skip` | 1 to 50 of the app's own tables, each once. Every table left in whose rows link to a skipped one must be skipped too, or its sample rows would point at rows never added. |

The check says which table is missing:

```text
"order_items" links to "menu_items" (menu_item_id), which is skipped: skip "order_items" too, or its sample rows point at rows never added
```

Removing sample data keeps any sample row a real row uses, and on a shared menu that includes the
other app's real rows: a sample dish the shop's real order points at stays, with its category. See
[Sample data](/guides/apps/sample-data/).

## Upgrading

The upgrade records the shape of every app table declared with one, and fills it in for apps
installed before. A Point of Sale installed on an earlier release is then found by the next app
that declares the menu, and offered.
