<!-- produced from apps/docs/src/content/docs/guides/apps/emails.md § Links; do not edit -->

# An app's emails: Links

`manage_url` and `booking_url` lead to the app's customer pages: the page for managing a booking
and the booking page, as the app names them. Adminium builds them from:

1. the domain attached to the app's customer side, when there is one
   (see [Addresses and domains](https://docs.adminium.dev/guides/apps/settings/#addresses-and-domains));
2. else **Address in email links** under **Studio → Settings → Email**, followed by
   `/apps/<key>/customer` (see [Links in emails](https://docs.adminium.dev/guides/email/#links-in-emails));
3. else nothing. The link is left empty rather than guessed, because a send has no request to
   take an address from.

If your emails arrive without their links, set one of the first two.
