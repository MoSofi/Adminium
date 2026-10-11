<!-- produced from apps/docs/src/content/docs/guides/apps/public-access.md § Switches in the settings row; do not edit -->

# An app's public access: Switches in the settings row

An app can tie public writes to yes/no values in its settings row, such as **online booking** or
**new patients online**, so the business can switch them without touching Studio:

- While a switch is off, every write through its entry is refused `403` `PUBLIC_SWITCHED_OFF`.
  Reads keep working, so the page can say why and offer the phone.
- A switch can apply only to a **stranger's create**: new patients online off, while people
  already on file still book.
- A switch reads **off** when the settings row is missing, the column is missing, any row says
  off, or it cannot be read.
- A switch is read at most every 15 seconds, so a change takes up to 15 seconds to show.

The kiosk switch works the same way, for the whole key.
