<!-- produced from apps/docs/src/content/docs/reference/manifest.md § A self-made app — Columns under their own names; do not edit -->

# Manifest spec: A self-made app — Columns under their own names

### Columns under their own names

In a self-made app, a column's `ref` may be the name it has in its own database: `orderDate`,
`Order Total`, `driver-name`. The column is created under that name, and every block of the file
names it the same way: pages, views, roles' column limits, rules, public entries and rows.

- A name starts with a letter or `_`, then holds letters, digits, `_`, `$`, `-` and spaces. It has
  no dot, no colon and no space at either end, so `24:00` still reads as a time.
- Two columns of a table whose names differ only by case are refused.
- A formula's `join` and the short path rules (a staff column, a night count) take names without
  spaces.
- Released apps and add-ons keep snake_case refs.
