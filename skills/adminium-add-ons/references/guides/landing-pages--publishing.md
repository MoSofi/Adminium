<!-- produced from apps/docs/src/content/docs/guides/add-ons/landing-pages.md § Publishing; do not edit -->

# The Landing pages add-on: Publishing

**Publish** checks the page first and lists what to fix: an empty page, a field too long, a
picture without a description, a link that is not `https`, a mark left by Milo, an address that is
not allowed or is taken. Nothing is published until all of it is fixed.

Publishing keeps a copy of the page as it is. Visitors see that copy. Your changes after it stay in the
editor until you press **Update** (**Publish the changes**).

**It needs the privacy notice.** Every public page links to it at the bottom, so Publish stays off
until the business name and the privacy notice address are set (see
[The privacy notice](https://docs.adminium.dev/guides/email/privacy/#the-privacy-notice-and-the-postal-address)).

**Visitors can't reach it yet.** A page can be published while visitors cannot reach this server.
The editor then says "Published, but visitors can't reach it yet", with a note above the page
saying why:

- the server has no public https address (the **Address in email links**);
- public pages are switched off (`ADMINIUM_NETWORK_FEATURES`);
- the server runs on this computer only (the desktop app);
- the server is behind a proxy it does not trust: set `ADMINIUM_TRUST_PROXY=on` (see
  [Behind a reverse proxy](https://docs.adminium.dev/self-hosting/reverse-proxy/)).

The page shows as soon as the note is gone.
