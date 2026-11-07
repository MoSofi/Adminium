<!-- produced from apps/docs/src/content/docs/guides/apps/settings.md; do not edit -->

# An app's settings page

Every installed app has a page of its own. Open **Studio → Hosted apps** and click the app's name
under **Installed apps**. It needs the **Install and manage apps and add-ons** permission; without
it the page is not offered at all.

The header shows the app's name, its version and publisher, and one status: **Active**,
**Disabled**, or **Update available** with the version. **Open the app** opens its staff screens,
in the dashboard or at their own address. **Update** reads **Up to date** until a newer version
exists.

Installing, updating and uninstalling are covered in
[Installing apps](https://docs.adminium.dev/self-hosting/installing-apps/).

An app installed on several databases has a page per copy: the first at `/studio/apps/<key>`, a
later one at `/studio/apps/<key>~<slug>`, each reading "on *database*". Everything on a copy's page
acts on that copy alone, and **Update every copy** moves them all to one version. See
[An app on several databases](https://docs.adminium.dev/self-hosting/apps-per-database/). An app saved with Save as app has a
few cards of its own, described in [Installing your own app](https://docs.adminium.dev/guides/your-own-apps/install/#the-apps-page).
