---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/meta': patch
'@adminium/i18n': patch
---

One Install button for add-ons and apps, and the Designer can get an add-on itself.

**A new install now asks adminium.dev for the two lists (add-ons and apps).** One request when the server starts and once a day, which tells adminium.dev the server's IP address, the time and its Adminium version. No add-on or app is named until a person presses Install. To switch it off: the switch on each page, or `ADMINIUM_NETWORK_FEATURES=off` (set before the first start, the request is never made). **A server upgraded from an earlier version is unchanged**: a list that was off stays off, and its page shows one button, "Show what is available".

- Add-ons page: Install downloads the add-on and then shows what it adds, with Cancel and Install.
- Apps page: Install downloads the app and opens one dialog (the database, what it adds, the add-ons it brings); "More choices" opens the full wizard. An add-on the app requires is downloaded by the dialog's own Install, and the dialog says so before it is pressed.
- The Designer: when a request needs an add-on that is not on the server, a card asks, by the add-on's name and version, and a yes downloads and installs that version. Where the list is off, a first card says what switching it on sends and downloads nothing; the add-on's own card follows.
- An add-ons page whose list is off no longer shows rows cached from an earlier refresh.
