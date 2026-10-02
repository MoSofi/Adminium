<!-- produced from apps/docs/src/content/docs/guides/apps/public-access.md § Signing in with an emailed link; do not edit -->

# An app's public access: Signing in with an emailed link

An app can let a person sign in with their address alone, such as a client opening their invoices.
The page sends the address to `POST /api/v1/public/claim/link`, with a [human
check](https://docs.adminium.dev/guides/apps/public-access/#the-human-check), and Adminium emails a link and a six-digit code for another device:

- **The same answer for any address.** The request answers `202` with the address masked, before
  anything depends on whose it is. An address that is nobody's gets nothing, and behaves the same
  in every count and lock, so a stranger learns nothing.
- **The link** lasts 20 minutes and is used once. It leads to the app's customer side, on its
  domain or under **Address in email links** ([Links](https://docs.adminium.dev/guides/apps/emails/#links)), with the token
  after `#` so no server log holds it. With neither address set, nothing is sent and the server log
  says why. Opening it shows a page to continue: reading the greeting spends nothing, and only
  **Continue** uses the link and opens the session. It opens nothing once the person's address has
  changed.
- **The session** starts **verified**, the only level such a person has, and every entry it reads
  asks for verified.
- **Limits per address:** 3 links in 15 minutes, 10 a day, at most 3 open at once. A new link
  never cancels an earlier one. Ten wrong codes in a day lock the code path only (`403`
  `PUBLIC_CLAIM_LOCKED`); the link in the mailbox still works.

A used or expired link answers `410` `LINK_EXPIRED`, and the page offers to email a new one.
