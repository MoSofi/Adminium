<!-- produced from apps/docs/src/content/docs/guides/apps/public-access.md § Guests finding their own booking; do not edit -->

# An app's public access: Guests finding their own booking

A claim lets a guest open their own row by proving they know its details, for example a booking
code and a mobile number, with no account. The guest must supply **every** field the app declared
and nothing else, and exactly one row must match. A guest who gets it right receives a session for
30 minutes (3 at a [kiosk](https://docs.adminium.dev/guides/apps/public-access/#a-kiosk)) that reaches that row, and the rows tied to it, and nothing
else.

Two kinds of field are compared by what they mean, because guests type them from memory:

- **A code** written by a column's code rule is compared the way the rule writes it: upper case,
  spaces removed, the prefix put back, and letters that look like digits read as digits (O as 0,
  I and L as 1). So `mr 4829`, `MR4829` and `4829` all find `MR-4829`.
- **A phone number**, in a column marked as one, is compared by its digits, however it is
  punctuated, and the **whole** number has to agree. A leading `0` trunk prefix and a country code
  the guest left off are allowed for; the last few digits alone never match.

A wrong answer, no match and more than one match all get the same `403` with the code
`PUBLIC_CLAIM_NO_MATCH`. An app can also ask for a [human check](https://docs.adminium.dev/guides/apps/public-access/#the-human-check) on every
claim.
