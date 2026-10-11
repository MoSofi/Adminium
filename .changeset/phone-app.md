---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/i18n': patch
---

An app can have a phone app for its customers: a third side, `mobile`, an Expo (React Native) project in `apps/<key>/mobile/`. `adminium app new <key> --mobile` writes one, and the Designer's "what to build" menu has **Mobile**. Adding one installs Expo's packages (about 350 MB), and a person is asked first; `adminium app approve-build` gives that yes for a phone side that came from elsewhere.

In the Designer the preview has a **Phone app** side: the app in a phone's frame, built for the web by Expo. **Open on a phone** shows a code that a phone with Expo Go, on the same network, scans to run the real app against this computer's data. Nothing is sent to anyone else, and the Designer itself stays on this computer. A phone side is a preview of a project being designed or developed: `adminium start`, a packed app and an installed app never serve it.

An app with a phone side gets an **app key** (`adm_app_…`) beside its customer key when it is installed. It reaches what the customer key reaches, needs no `Origin`, and is refused from a browser. Studio's API keys page lists it as "PHONE APP"; an update that adds a phone side asks before making it. A server key is now also refused when a request carries `Sec-Fetch-Dest`.

New skill for coding agents: `adminium-mobile`.
