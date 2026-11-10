---
title: The Customiser add-on
description: Products a shop's customers make their own, with their words, logo, photo and colours on a ready-made design, proofed and made by the shop from the same data. What it keeps, how Maker Shop and Print Shop bind it, what their roles need, the customer's editor and the saved design's link.
---

Comes with Adminium from 0.3.44 (add-ons 1.0.16). The Customiser 1.0.25 needs Adminium 0.3.47;
Maker Shop and Print Shop 0.2, which require it at `^1.0.25`, need 0.3.53.

The Customiser lets a shop's customers make a product their own. They choose a ready-made design,
put in their own words, logo, photo and colours, and see it as it will be made. The shop proofs the
design and makes the print files or the laser's cut files from the same data. It replaces the
retired Live Personalizer and Design Studio.

It serves two apps, **Maker Shop** (`maker`) and **Print Shop** (`printing`), which require it. Its
manifest names only those two in `attaches`, so it is installed with one of them, not on its own.
One install may serve both: every row says which app it is for (its `app` column), and each app's
visitors see only that app's.

Install it from **Add-ons**, or let the app's install offer it. It makes fifteen tables under the
name `customiser_…` in the app's database, two roles (**Customiser designer** and **Customiser
reader**) and a **Customising set-up** page, at `/add-ons/customiser/customiser`. The page is on the
dashboard while one of the shop apps has the Customiser connected and switched on.

## What it keeps

- **Bases**: what gets customised. A flat page (a business card, at its finished size, with bleed
  and a safe line), a flat piece (a coaster, from its outline, material and thickness), a kit of
  **pieces** (a book nook) or a 3D-printed item (a keyring). Each has **areas** where a customer
  may add words or a logo.
- **Ready-made designs** on a base, made by the shop. Each **part** is locked, or the customer's to
  change within its rules: how many characters, which fonts, sizes and colours.
- **Fonts** (an open-licence starter set every install has, and the shop's own), **palettes** and
  their **colours**.
- **Priced features**: what costs more ("Your own logo"). The Customiser keeps the feature and its
  code. The price is the app's: an option row of its own that names the feature.
- **Customers' designs**, kept as data, never as a picture, each with a code the order line finds
  it by. A design nobody ordered is removed 90 days after its last change, with its files.
- **Design versions** (the snapshot an order is made from, and its proof) and **production files**
  (the print PDF of each side, the laser's SVG of each piece), made in the shop's browser.

The **Customising set-up** page is where the shop adds its bases, ready-made designs, fonts,
colours and features, and keeps its **Shop settings**: the one-colour line a customer's logo starts
on, a new page's bleed and safe line, the thinnest line and the sharpness a picture needs. The
settings are one row for the whole install, covering every shop app on it.

## How an app binds it

The app binds the Customiser from its own side; the add-on never names a table of the app. Maker
Shop and Print Shop do it with four links ([`addOnLink`](/reference/manifest/#column-rules)):

| Column | Links into | What it is for |
|---|---|---|
| `products.base_id` | `bases` | The base a product is customised on. The product's record shows the Customiser's product panel. |
| `options.feature_id` | `features` | The option row that prices a feature. |
| `order_lines.design_id` | `designs` | The customer's design an order line is made from. The line's record shows the order-line panel. |
| `order_line_features.feature_id` | `features` | A feature a line pays for. |

The line's design is filled only from the code the customer's page sends, never from a key the
browser names: a [`lookup`](/reference/manifest/#typed-codes) from a text column into the
Customiser's designs. The public entry lists `design_code` among a line's `writable` columns, never
`design_id`.

```json
{ "ref": "design_code", "type": "text", "maxLength": 40, "nullable": true },
{ "ref": "design_id", "type": "int", "nullable": true,
  "rules": { "addOnLink": { "addOn": "customiser", "table": "designs" },
             "lookup": { "from": "design_code", "table": { "addOn": "customiser", "table": "designs" },
                         "column": "code" } } }
```

The order lines' table then asks the Customiser whether each design may be ordered as it is, and
posts it when the line is made:

```json
{ "ref": "order_lines", "columns": [ … ],
  "check": { "by": { "addOn": "customiser" }, "design": "design_id",
             "paid": { "table": "order_line_features", "via": "line_id", "feature": "feature" } },
  "postings": [
    { "id": "design",
      "into": { "addOn": "customiser", "ledger": "designs", "action": "order" },
      "via": "order_id",
      "post": { "on": { "create": true } },
      "map": { "design": "design_id" },
      "only": { "column": "design_id", "set": true } } ] }
```

- **The check** runs inside the save and the quote. It refuses a design that breaks its own rules
  (words too long, a font the base does not offer, a part that is locked), and a line whose paid
  features are not the ones the design uses. See
  [A design an add-on checks](/reference/manifest/#a-design-an-add-on-checks) and
  [A refused design](/reference/errors/#a-refused-design).
- **The posting** snapshots the design as a new version and locks its draft, in the same save as
  the line. A design ordered again without a change gets no new version. See
  [Rows that post into a ledger](/guides/apps/postings/).

## What the app's roles need

The Customiser draws two panels on the app's records: `customiser-product` on a product, and
`customiser-line` on an order line, where the shop makes the proof and the production files. An
app's role is given what a panel needs in its `roles.json`: the panel's `page:@<panel>:view`, and
the Customiser's tables in `tables` (up to 24 add-on tables a role). A panel that misses a right says
which, and makes nothing.

```json
{ "key": "studio", "name": "Studio",
  "permissions": ["table:@order_lines:read", "page:@customiser-line:view", "page:@customiser:view"],
  "tables": [
    { "addOn": "customiser", "table": "designs", "actions": ["read", "read_pii"],
      "limit": { "rows": { "read": { "reach": "all", "while": { "column": "app", "in": ["maker"] } } } } },
    { "addOn": "customiser", "table": "bases", "actions": ["read"] }
  ] }
```

This is a part of the order-line entry; the full list for each panel and for the set-up page is in
the [Customiser's README](https://github.com/Adminiumjs/add-ons/tree/main/packages/customiser).
Three things to know:

- **How far a role may go.** The Customiser's `appGrants` say the most an app's role may hold of
  each table: the shop's set-up tables may be read and changed, a customer's design only read (with
  `read_pii` for their words, logo and photo), a version and its files made and replaced. Its
  postings and its log of mailed links go to no app's role. An entry that asks for more is cut, and
  the install check says what was cut. Needs Adminium 0.3.47. See
  [What an app's roles may hold of its tables](/guides/add-ons-with-tables/#what-an-apps-roles-may-hold-of-its-tables).
- **A limit on `app` keeps each shop to its own rows.** `appGrants` says how far, never on which
  rows. With Maker Shop and Print Shop on one install, a role with no row limit on `app` reads the
  other shop's customers' designs. With it, another app's rows are "not found" to the role.
- **`page:@customiser:view` on a role that makes files**, screens-only roles too. A starter font
  nobody uploaded is read from the file the package ships, beside the set-up page, and only a role
  that may open that page reads it. A screens-only role never sees the page in a menu.

A shop's owner opens the set-up page with a role the app gives `page:@customiser:view` and the
set-up tables: it adds, changes and removes only its own app's rows, and reads the starter fonts
every app shares, but removes none of them. The Customiser's own designer and reader roles reach
every app's rows, for someone who works in the dashboard.

## The customer's editor

Adminium serves no add-on code to a shop's visitors. The editor a customer designs in ships in the
Customiser's package, under its `./browser` export, and the shop app bundles it into its own
customer side, at the version its range asks for. The editor reads the shop's published bases,
designs, fonts, palettes and features through the Customiser's public entries, which ride the app's
own customer key, each held to the app's rows by `appColumn`. Saving a design asks for the human
check. See [An add-on's entry on each app's key](/reference/manifest/#an-add-ons-entry-on-each-apps-key).

## The saved design's link

**Save and come back** asks the customer for their email and mails them the design's private
link. It is the Customiser's one email, a service message in the customer's language. Its button
opens the page the app names on its customer side under the route key `customiserDesign`, with the
link's code after the `#`. An app that names no such page sends the message without a button.

The link changes the design while it is a draft, and deletes it (its logo and photo with it). Once
the design is ordered, the link only reads it. Nobody reads a saved design through the shop: it
opens again only by its link. See [A shopper's own link](/reference/manifest/#a-shoppers-own-link).

## Sample data

Each shop app ships its own sample for the Customiser: Maker Shop a maker's bases, designs and
pieces, Print Shop a print shop's. They are added with the app's sample while the Customiser is
connected to the app. See [Sample data](/guides/apps/sample-data/#rows-for-an-add-on-the-app-names).

## On two databases

Each shop app on its own database has its own copy of the Customiser there, with its own set-up and
customers. The sidebar shows one **Customising set-up** row for each copy you can open, with its
database's name beside it. See [An app on several databases](/self-hosting/apps-per-database/).
