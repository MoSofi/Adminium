<!-- produced from apps/docs/src/content/docs/self-hosting/installing-apps.md § On a host with no persistent disk; do not edit -->

# Installing apps: On a host with no persistent disk

An installed app's files are kept in `ADMINIUM_DATA_DIR/apps`. The meta store only records that the
app is installed, and a [storage destination](https://docs.adminium.dev/self-hosting/env-vars/#adminium_storage_url) does not
hold it. So on a host that empties the data directory on every deploy — DigitalOcean App Platform,
or a container with no volume — **every installed app is lost at the next deploy**:

- Studio lists it under **Installed apps** marked **Missing**, with a line saying its files are not
  on this server. The shelf shows the same badge in place of the green "Installed".
- Its `/apps/…` addresses answer `503` with the code `APP_FILES_MISSING`. Before 0.3.0 they
  answered the dashboard's "page not found" page with **HTTP 200**, so an uptime check that read
  only the status code stayed green; a check on `/apps/<key>/<side>/` now goes red, which is what
  you want it to do.
- The tables it created in your database are kept, with their rows.
- The boot log names it: `installed app is not on this server …`, with its key and version.
- The cached catalogue is gone too, so the shelf is empty until **Check for newer** runs again.
  A lost app you uploaded yourself is never in that feed, so before 0.3.0 it appeared in no list
  at all while the install record still said it was there; it is now listed as Missing regardless.

To bring an app back, choose **Install an app**, upload the same version's file with its
fingerprint, and confirm. The plan reuses the tables the app already has: nothing is created twice
and nothing is dropped. The shelf cannot do this for you: it shows the app as missing and offers
no download.

To keep apps across deploys, run Adminium where the data directory is on a persistent disk, or build
your own image that carries the app files in `/app/apps-bundle` — see
[`ADMINIUM_BUNDLED_APPS`](https://docs.adminium.dev/self-hosting/installing-apps/#adminium_bundled_apps). Each boot then copies them back.
