<!-- produced from apps/docs/src/content/docs/self-hosting/installing-add-ons.md § Uninstalling; do not edit -->

# Installing add-ons: Uninstalling

Uninstalling an add-on removes its **package files** and Adminium's own records
of it (including any stored credentials). It **never touches tables the add-on
created in your database** — those stay, with their rows. Data outlives the
code that produced it; drop the tables yourself if you truly want them gone.
