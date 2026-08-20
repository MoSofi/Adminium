---
'@adminium/i18n': patch
---

Stop the hub's introspection poll running two minutes past the screen that started it.

`awaitIntrospectJob` loops up to 100 times against `GET /jobs/:id`, so leaving
the connections hub mid-introspection kept fetching for as long as two minutes
and ended in a toast about a screen the user had left. It now takes an
`AbortSignal` the card aborts on unmount — checked at the top of each iteration
and inside the sleep, the same shape `waitForHealth` already uses in
`studio/api.ts`, where the flag is read at the loop boundary rather than threaded
into `fetch` (`app/api.ts` takes no signal, and one in-flight GET is not the
problem).

`aborted` is a THIRD outcome rather than being folded into `failed`. The job is a
server job and carries on regardless; only the watching stopped. Reporting that
as a failure would put "Introspection failed. Try again." in front of someone
whose introspection is at that moment succeeding. On the aborted path the
mutation pushes no toast at all, and `onSettled` still invalidates the
connections query, so the new snapshot is there the next time the hub opens.

This is the last of the four timers the dashboard sweep found outliving their
component, after the `page-crud` search debounce, the two builder autosaves and
the connect wizard's generate step.

One inaccuracy in the same function is left alone deliberately: exhausting all
100 iterations still returns `failed`, so a job that is merely slower than the
client's ~2-minute budget is reported as a failure. Correcting that needs a
distinct "still running" message in eight locales, which is a copy change rather
than a timer fix.
