---
'@adminium/manifest': patch
'@adminium/server': patch
'@adminium/docs': patch
---

An app's sample rows for an add-on can ship their own files (`assets` and `{"@asset": …}`, as the app's own sample file does), including 3D models (`.glb`, `.stl`, `.3mf`) and SVG pieces for a column of one product asset that takes their kind; the files are checked against their sha256 and leave with the rows. Each is held to what an upload of it is held to: an SVG is cleaned (one the cleaner refuses refuses the sample), a model is read whole and refused when it is not the kind its name says, and both keep to the public cap of their kind; `adminium app check` says the same.
