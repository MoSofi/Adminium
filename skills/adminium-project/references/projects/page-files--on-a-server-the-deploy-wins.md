<!-- produced from apps/docs/src/content/docs/projects/page-files.md § On a server, the deploy wins; do not edit -->

# Page files: On a server, the deploy wins

A server does not write your folder. It applies the files it was deployed with
and, when someone edits a page in Studio there, keeps that edit and marks it:

| | |
|---|---|
| A file changed since the last start | Applied at start |
| …but its page was also edited on this server | The server's copy is kept, and the page is a **conflict** |
| A page edited on this server | Kept, and marked **changed on server** until you [pull](https://docs.adminium.dev/projects/pull-and-check/) it |
| A page created on this server | Kept, and marked **not in project** |
| A file deleted in the deploy | Its page is removed, unless it was edited here — then it is kept and marked |
| A file with a mistake | Not applied; the boot log says why, and the last good copy stays in use |

Nothing is lost either way, and nothing is overwritten silently. Studio → Pages
shows a banner naming what happened:

> **3 pages were changed on this server** — Pull the changes into your project
> and deploy it, or they stay on this server only:
> `npm run pull -- --from https://this-server`

A page changed on both sides offers two buttons: **Keep server copy** leaves it
flagged until you pull it, and **Use project copy** applies the file's version
now. For a schema file, using the project copy needs Super Admin when it would
show a column kept from readers — a secret, or a personal column's mask — as the
same change made in Studio does.

**Studio → Settings → Project** (super admins) shows the whole picture for the
project the server runs: which folder, whether it runs as `dev` or as a server,
how many page and schema files, what changed here, and the hooks, actions, pages
and widgets it loaded — with any that failed to load, and any hook that has
errored since the server started.
