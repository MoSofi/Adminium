<!-- produced from apps/docs/src/content/docs/guides/apps/shared-menu.md § A shape; do not edit -->

# A menu two apps share: A shape

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
