---
'@adminium/server': minor
'@adminium/dashboard': minor
'@adminium/i18n': minor
---

The Designer offers a published app before it builds one, and ends a reply with buttons.

- **A ready-made app, offered first.** While a new session's app has no name yet, the Designer is shown the apps this server could install (the cached list of adminium.dev, less what is installed). When one is the kind of thing the person asked for, it asks on a card of the server's own words ("There is a ready-made app for this: Maker Shop"). "Use it" builds nothing and opens Studio → Apps on that app; "Build my own" goes on as before. One offer a session, made before any instruction on how to build is followed. A server that has never read the list (a trial at its first start) asks adminium.dev for it once, when a new session first needs it. In the start prompt's run, where every other card is answered no at once, this card waits up to ten minutes for the person, then takes no and builds.
- **What next, as buttons.** A reply no longer ends with a list of next steps in words. The Designer's `suggest_next` puts up to four buttons under the newest reply of a turn that applied: a request the person sends with one press; an add-on by the server's own name, which a press asks the Designer for (its card then asks before anything is installed, or the Designer says who can install it); and a table the person fills themselves ("Add your Products"), which opens its page in the dashboard.
