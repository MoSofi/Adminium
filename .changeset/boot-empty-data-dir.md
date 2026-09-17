---
'@adminium/server': patch
---

**A redeploy on a host with no disk no longer leaves bundled add-ons half-loaded, and it names what it lost.**
On DigitalOcean App Platform, or any container without a volume, every deploy starts with an empty
data directory. Checked on 0.2.9 with a Postgres meta store:

- The image's bundled add-ons were copied back at boot, but 60 to 90 ms after the add-on runtime
  had already been built without them. So an installed bundled add-on with server code
  (Invoices & Receipts) stayed off until something else rebuilt the runtime, and
  `GET /documents/kinds` answered with an empty list. The runtime is now built after the copy
  finishes.
- An app restored from `ADMINIUM_BUNDLED_APPS` was copied back after the list of served apps had
  been read, so it was not served. That list is now read again after the copy.
- An installed package the build does not carry (an uploaded add-on, a version other than the
  bundled one, any app) cannot come back. Studio still listed it as installed and the boot said
  nothing. The boot now logs an error for each one, with its key and version and what to do.
- Uploading the installed version of an add-on again, which is how its files are put back, now
  also reloads its server code. Before, it stayed off until the add-on was switched off and on.
