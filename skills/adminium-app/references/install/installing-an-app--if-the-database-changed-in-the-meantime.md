<!-- produced from apps/docs/src/content/docs/self-hosting/installing-apps.md § Installing an app — If the database changed in the meantime; do not edit -->

# Installing apps: Installing an app — If the database changed in the meantime

### If the database changed in the meantime

**Install** sends the check you looked at. If a table was created, dropped or changed after the
check was made, the install is refused with `SCHEMA_DRIFT`: "The database changed since this
install was checked." The wizard runs the check again and shows the new one. Nothing was written.

For an app that works with add-ons, the check also covers those add-ons on this server: one added,
updated, or still arriving when the check was made refuses the install the same way. From 0.3.52
the refusal says which of the two moved, in `details.changed`: `"database"`, or `"add-ons"` when
only the add-ons did, and the message then says the database did not change. A check made before
you updated Adminium may no longer match either. In each case, check again and install from the
new check.

A script that installs an app just after a first boot should wait for `/api/v1/readyz` first: until
the add-ons that come with Adminium are all in place it answers `503`, with
`checks.packages: "seeding"`, and a check made then would not match the install.
