<!-- produced from apps/docs/src/content/docs/reference/errors.md § Public API codes — Limits reached; do not edit -->

# Error codes: Public API codes — Limits reached

### Limits reached

`409` `PUBLIC_LIMIT_REACHED` carries no params. The page offers the phone instead. It is said
when:

- a signed-in person already holds as many open rows as the entry's `maxOpen` allows (a hold
  the same write lets go does not count);
- a create nobody signed in for is over one of the entry's `anonymous` caps: `perValue` (so many
  a day for one phone number or address), `perKeyHour` (so many an hour through the key),
  `perIpHour` (so many an hour from one visitor), or the 60 an hour any one visitor may make
  through a key;
- a change is over the entry's `limits.perValue` (so many a day written to one address);
- a row's own link has been renewed 5 times today with "Make a new link".

A quote is never charged and never told a cap is spent. A create refused for the guest's own
value gives its charge back. See [limits on a guest's
change](https://docs.adminium.dev/reference/manifest/#limits-on-a-guests-change).
