---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

**An app or add-on whose files a redeploy wiped now says so, everywhere it is listed, instead of reading as installed and fine.**

On a host with no persistent disk — App Platform, or any container without a
volume — every deploy starts with an empty data directory. The meta store
remembers each install; the files are gone. Until now the only place that was
said out loud was the server log, which is not where anyone looks.

Everywhere else it looked like nothing had happened, and on four different
surfaces for three different reasons:

- **Studio's installed-apps list** showed the app with its version and install
  date, because a lost app's only tell was an empty `sides` — which also means
  "this build ships no frontends".
- **The installed add-ons list** was a pure read of the meta store and the
  credential table, and *both* outlive a wiped volume — so a gone add-on listed
  with its version, its slots, and a green **Connected** badge.
- **Both browse shelves** are assembled from the packages on disk plus the last
  cached catalog feed. A lost package is in neither, so it was either labelled
  `installed` (when the feed happened to carry it) or **left out of the reply
  altogether** — which is every uploaded package, and every install with no
  cached feed. The meta store said installed and the page showed nothing at all.
- **The app's own URL answered 200.** Nothing was mounted for it, so
  `/apps/<key>/staff/` fell through to the dashboard's SPA wildcard and got
  `index.html`, which then painted the dashboard's own 404. The request looked
  like it had succeeded.

Now `GET /apps` and `GET /add-ons` carry `missing` per row, both catalogs have a
`missing` state plus a pass over the meta store so an installed package can no
longer vanish from its own list, and `/apps/<key>/…` answers **503
`APP_FILES_MISSING`** with the coded envelope rather than a page that pretends.
Studio marks every one with a badge and a line saying what to do; the browse
shelf shows that badge *instead of* the green "Installed" it used to show. A
missing add-on the catalog still carries offers its Download again, and one the
feed does not carry says so instead of offering a button that cannot work.

All of it now asks one question — `packageIsInStore` — where three call sites
previously answered it three different ways, one of which ("does it contribute a
surface") is not the same question: a package that is present but carries no
`index.html` serves nothing while its bytes are right there, and reporting that
as missing files sends the operator looking for the wrong problem.

This is the honest-reporting half of the fix. Bringing the packages back by
themselves — a copy in the storage destination, restored at boot — is separate
and still to come; what changes here is that the loss stops being silent.
