<!-- produced from apps/docs/src/content/docs/reference/errors.md § Public API codes — Switched off; do not edit -->

# Error codes: Public API codes — Switched off

### Switched off

`403` `PUBLIC_SWITCHED_OFF` means the app's settings row switches this off: online booking,
new patients online. Every write through that entry is refused. A create sent again with a retry
key that went through before the switch still answers that create.
