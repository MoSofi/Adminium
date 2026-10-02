<!-- produced from apps/docs/src/content/docs/reference/errors.md § Public API codes — Too early and too late; do not edit -->

# Error codes: Public API codes — Too early and too late

### Too early and too late

A change a guest makes can be open only inside a window: a check-in from half an hour before the
doors, a cancellation until two days before the stay.

- `409` `PUBLIC_TOO_EARLY`, `params: { at, from }`: the guest's own row is not yet inside the
  window. `at` is the time the window is counted from (the row's time, or the linked row's, such
  as the doors), and `from` is when the window opens. Both are instants. A kiosk check-in shows
  the guest their time with it.
- `409` `PUBLIC_TOO_LATE`, `params: { at }`: the window has closed, or a
  [late move](https://docs.adminium.dev/reference/manifest/#late-moves) in mode `refuse` turns the change away. `at` is
  when it closed, when that is known. A late cancellation under a slot limit's `cancelHours` or a
  booking rule's window says it with no params.

Neither is said when the window is shut by something else: a linked row that is not in the state
the window asks for (the show takes no refunds), or a moment with no value. Those are a bare
`PUBLIC_WRITE_REFUSED`, since naming them would say what another row holds. A row outside the
guest's reach is `404` `PUBLIC_REF_NOT_FOUND`, never `PUBLIC_TOO_EARLY`. See
[windows on a moment](https://docs.adminium.dev/reference/manifest/#windows-on-a-moment).
