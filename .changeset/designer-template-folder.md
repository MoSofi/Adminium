---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/desktop': patch
---

A project can keep site templates in `site-templates/<name>/`. The Designer's home offers them ("There is a site template in this project: harbor-bakery." with "Start from it"), and the Attach menu lists them under "A site template in this project", beside a new "A folder…" item for picking a template's folder. The server reads such a folder without following links and judges it as it judges a zip.

`adminium design` in a folder that holds a site template, and the Desktop app's "Make a new project here" on one, make the new project inside it and copy the template into its `site-templates/`, through the same checks; the folder's own files are not changed. A folder that is not a template (too many files, or refused) still gets its project, and the Designer says why the template was not copied. `adminium new` takes `--site-template <folder>` for this.

Fixed: a site template put with a first message on the Designer's home now goes with it (it was left behind when no other file was attached).
