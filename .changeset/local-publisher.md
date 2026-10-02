---
'@adminium/server': patch
---

An app you made yourself can now be installed from a file. A manifest whose publisher is `local` uploads and installs like any other app, and the install wizard and the installed list say it was made on this install and does not come from adminium.dev. Such an app may also be only tables and pages, with no screen of its own: declare its one frontend as `kind: "none"`. Everything else stays as it was: any other publisher is still refused, an add-on can never be `local`, a catalogue download that claims `local` is taken back out, a package cannot replace an installed app from another publisher, and a self-made app cannot take the key of an app the online catalogue lists.
