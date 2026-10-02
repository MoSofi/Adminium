<!-- produced from apps/docs/src/content/docs/guides/apps/public-access.md § A kiosk; do not edit -->

# An app's public access: A kiosk

An app can declare a **second key** for a screen your staff set up, such as a tablet where
patients check themselves in. It is not the guests' key: the staff screens hand it only to
someone signed in with the role the app names for it, on the app's database. The **API keys**
page shows it with the badge **Staff screen only**.

That role must be screens-only, with no access but the app's staff screens, because anyone can
walk up to the tablet. Sign the tablet in with a staff account that holds that role.

Every request with the key must come:

- from a live staff sign-in holding exactly that role of that app (never a super-admin, never
  another role);
- from the page itself, on the same origin, and with the dashboard's CSRF token on a write;
- on the app's staff domain, when you mapped one.

Otherwise the answer is `403` `PUBLIC_STAFF_REQUIRED`, whatever the reason, before any limit is
spent. A token copied out of the page opens nothing on its own.

At the kiosk:

- a claim's session lasts **3 minutes**, one person after another, and asks for no proof;
- claims count **per staff sign-in**, 30 a minute, since everyone in the waiting room shares one
  address;
- the kiosk can have its own switch in the app's settings row. While it is off, the key answers
  `503` `PUBLIC_KEY_OFF` ([below](https://docs.adminium.dev/guides/apps/public-access/#switches-in-the-settings-row));
- a check-in can have a time window, such as an hour before the visit. Someone who arrives earlier
  is refused `409` `PUBLIC_TOO_EARLY`, and the screen can tell them their visit's time. The tablet
  learns that time only for the person whose details were just typed, and only for their booked
  visit later that day.

If the tablet goes missing, suspend the staff account it is signed in with, which signs it out
everywhere, or turn the kiosk's switch off.

The kiosk key stops with the app's **staff** side, not the customer side. An update never makes
again a kiosk key you revoked; uninstalling and installing the app does. An update that drops the
kiosk revokes its key. A version that turns a staff screen's key into one a shared link opens
says so on the update's check, and the key stops asking for a staff sign-in only if you allow it.
