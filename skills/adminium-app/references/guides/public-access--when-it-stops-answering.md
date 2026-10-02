<!-- produced from apps/docs/src/content/docs/guides/apps/public-access.md § When it stops answering; do not edit -->

# An app's public access: When it stops answering

The guests' key answers only while the app is on and its customer side is switched on. A kiosk
key answers only while the app is on and its staff side is switched on. Otherwise every request
with it gets `503`: `APP_DISABLED` when the whole app is disabled, `SURFACE_OFF` when only that
side is off. The change takes effect within seconds, and your own keys are not affected. See
[An app's settings page](https://docs.adminium.dev/guides/apps/settings/#sets-of-screens).

Uninstalling the app revokes its keys and removes their endpoints.
