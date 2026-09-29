---
'@adminium/widgets': patch
---

A record whose link or email column holds a value the browser does not accept as a full address can be saved again. Link and email fields, and a file column's plain field when no file storage is set up, were `type="url"` / `type="email"` inputs, so the browser refused to submit the form while one held a root-relative link such as `/covers/bookings.webp`, a scheme-less `example.com` or `n/a` — even when nobody had touched that field. They are now text fields that still bring up the address keyboard on a phone. A format an admin set on the column is still checked by the server, which names the field it refused.
