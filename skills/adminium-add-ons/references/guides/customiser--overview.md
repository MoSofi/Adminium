<!-- produced from apps/docs/src/content/docs/guides/add-ons/customiser.md; do not edit -->

# The Customiser add-on

Comes with Adminium from 0.3.44 (add-ons 1.0.16). The Customiser 1.0.25 needs Adminium 0.3.47;
Maker Shop and Print Shop 0.2, which require it at `^1.0.25`, need 0.3.53.

The Customiser lets a shop's customers make a product their own. They choose a ready-made design,
put in their own words, logo, photo and colours, and see it as it will be made. The shop proofs the
design and makes the print files or the laser's cut files from the same data. It replaces the
retired Live Personalizer and Design Studio.

It serves two apps, **Maker Shop** (`maker`) and **Print Shop** (`printing`), which require it. Its
manifest names only those two in `attaches`, so it is installed with one of them, not on its own.
One install may serve both: every row says which app it is for (its `app` column), and each app's
visitors see only that app's.

Install it from **Add-ons**, or let the app's install offer it. It makes fifteen tables under the
name `customiser_…` in the app's database, two roles (**Customiser designer** and **Customiser
reader**) and a **Customising set-up** page, at `/add-ons/customiser/customiser`. The page is on the
dashboard while one of the shop apps has the Customiser connected and switched on.
