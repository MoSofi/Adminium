<!-- produced from apps/docs/src/content/docs/guides/apps/public-access.md § Limits on a stranger's create; do not edit -->

# An app's public access: Limits on a stranger's create

An app can limit a create that nobody signed in for, such as a first visit booked online:

- **Per phone number or address, a day.** At most so many in 24 hours for one value of the
  columns the app names, whichever page or key it came through. A phone number counts by its last
  nine digits, so `+44 7700 900123` and `07700 900123` are one number; an address counts in lower
  case.
- **Per key, an hour.** At most so many through the key in an hour, from everyone together.
- **Per visitor, an hour.** At most so many (up to 60) through the entry in an hour from one
  visitor, counting an IPv6 subscriber's whole /64 as one. Every visitor is held to 60 an hour on
  any key anyway; this only lowers it for one entry.
- **Names as plain text.** The columns the app names hold letters, spaces and sentence
  punctuation only (Latin, CJK and Arabic), up to 80 characters: no digits, and no web or email
  address in its common forms, such as `refund-desk.com`. A note may take up to four digits and
  up to 200 characters, when the app says so
  ([Plain text](https://docs.adminium.dev/guides/apps/identity-and-own-links/#plain-text)). Anything else is refused `400`
  `PUBLIC_WRITE_REFUSED`, with `params.column` naming the column. Unlike the counts, this holds
  for a signed-in person's create too, and for every change that writes the column.

Over a limit, the create is refused `409` `PUBLIC_LIMIT_REACHED` and the page offers the phone.
A single create refused for another reason, such as a time taken meanwhile, does not count
against the phone number, the address or the key. An order sent with its lines gives its charge
back only when a value the guest typed was refused; see
[An order with its lines](https://docs.adminium.dev/guides/apps/orders-with-lines/). A quote never counts. Values are
counted as keyed hashes, so the count is never a list of numbers.

An entry anyone may call can never show a column that holds personal data: one the app marks
personal, or one whose name reads as an address, a phone number, a birth date or a person's name.
The manifest check refuses such an entry before anything is installed.
