---
'@adminium/server': patch
'@adminium/meta': patch
'@adminium/dashboard': patch
---

An app in your project now runs from its folder. `adminium dev` and `adminium start` install each `apps/<key>/` that `adminium build` built, and apply it again in place when its manifest changes: new tables are made, the app's own tables gain their new columns, pages, roles, rules and emails are rewritten, and the rows stay. Nothing is uploaded and no version has to change. A change that cannot be applied leaves the app running as it was and says why, in the terminal and in Studio ("Not applied").

What happens with nobody to ask depends on where it runs. Under `adminium dev` the add-ons the app requires are installed, public access is given as the manifest declares it, and the sample data is added once. Under `adminium start` nothing is installed for it, no table it did not make is changed, and it gets no public access until `adminium.config.ts` says `apps: { <key>: { publicAccess: true } }`. The new `apps` block also takes `database` (which of the project's databases the app lives in; the first by default) and `sampleData: false`. `adminium check` validates the block and warns when an app declares public access the config has not allowed.

An app that runs from the folder is changed and removed from the folder: Studio refuses to install, update or uninstall it while `apps/<key>/` is there. Delete the folder and it stays installed, marked "Folder gone", until you uninstall it.
