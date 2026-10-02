<!-- produced from apps/docs/src/content/docs/reference/errors.md § Public API codes — A typed code; do not edit -->

# Error codes: Public API codes — A typed code

### A typed code

A code a guest types (a discount, a gift card) is a guess. Each miss (`unknown`, `used-up`)
costs the visitor one of 5 a minute, and the key one of 60 a minute. Once they are spent, a
request with a code answers `429` `PUBLIC_RATE_LIMITED` with `Retry-After`, before anything is
looked up. A code that works costs nothing.
