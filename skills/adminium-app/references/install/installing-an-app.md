<!-- produced from apps/docs/src/content/docs/self-hosting/installing-apps.md § Installing an app; do not edit -->

# Installing apps: Installing an app

**Install an app** (an upload) and **More choices** (in the one dialog) open the wizard. It has four steps:
**Bundle**, **Database**, **Schema plan** and **Done**.

1. **Bundle.** For an upload, the `.tgz`. For an app from the shelf, the app you picked.
2. **Database.** The connection the app's tables go into, and the one it reads afterwards. Only a
   writable connection that is already connected can be chosen. The step says which version is
   being installed, and a database that already has the app reads **Installed** with its version.
3. **Schema plan.** The table check, the app's public access and the sample data box, described
   below. Nothing has been written yet.
4. **Done.** Which version went onto which database, which tables were created, which were used as
   they were, and which pages were made.

An uploaded file shows **Check against the fingerprint published with the release** on the review.
Paste the `sha512-` fingerprint from where you got the file: if it does not match, Install stays
off. A file you or someone else saved with **Save as app** gets a longer review; see
[Installing your own app](https://docs.adminium.dev/guides/your-own-apps/install/).
