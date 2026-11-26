---
'@adminium/server': minor
'@adminium/dashboard': minor
---

The Designer can show its preview on a server people reach, once the server has a second address for it.

Until now the Preview tab there read "The preview is off on a live server": such a server has one name, and an app's screens, which a model wrote, would have run on the same site as the signed-in person. A new setting, `ADMINIUM_PREVIEW_ORIGIN`, gives the instance a second name on a different site (another registrable domain), the way `adminium design` has `localhost` beside `127.0.0.1`.

- **What the preview's address does.** The instance answers on it. Everything that acts for a person is refused there: the Designer's routes, every way to sign in, setup, the models, users, roles, API keys and settings. The only user ever signed in there is the preview user, who holds the roles of the app being built, through a one-use ticket. A person's own session is not read on the preview's address, and the preview user's is read nowhere else. The instance's own addresses may frame it, and nothing else may.
- **For operators.** It needs `ADMINIUM_PUBLIC_ORIGIN`, and is refused when it names an address the instance already answers on. It must be on another registrable domain, which Adminium cannot check: see "The Designer's preview address" in the environment variables page.
- **Unchanged.** Without the setting a live server has no preview, as before. `adminium design` and the desktop app work as they did. An app's screens are still served at their own address.

`GET /api/v1/system/info` now says whether the Designer has a preview here (`designer.preview`).
