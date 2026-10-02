<!-- produced from apps/docs/src/content/docs/projects/apps.md § An app you made yourself; do not edit -->

# An app in your project: An app you made yourself

An app made in your own project carries the publisher `local`:

```json
"publisher": { "id": "local", "name": "Local" }
```

It installs from a file you upload. Adminium says so where it shows the app — "Made on this
install" — because nobody but you has checked it. Any other publisher but Adminium's own is
refused, an add-on can never be `local`, and a `local` app can neither replace an installed app
from another publisher nor take the key of an app the online catalogue lists.

An app with no screens of its own — tables and dashboard pages only — declares one frontend of
kind `none`:

```json
"frontends": [{ "side": "staff", "kind": "none" }]
```
