---
'@adminium/i18n': patch
---

Give the connect wizard's generate step the cancellation its two siblings already had.

`GenerateStep.run()` is a click-started async chain — a staged delay, the
generate POST, another delay — and it narrated straight into `setPhase`,
`setResult`, `setError` and the log console with nothing checking whether the
step was still mounted. Leave the wizard mid-generate and every one of those
lands on a tree that is gone.

`TestStep` and `EnrichDirectProgress` are the same wizard, with the same `wait()`
helper copied into all three, and both carry a `cancelledRef` cleared in an
effect. This step never got one. That asymmetry is what makes it an oversight
rather than a decision, and it was found by grepping the dashboard for timers
that outlive their component after two others turned up the same week.

The ref is RE-ARMED on every effect setup rather than initialised once, because
`main.tsx` renders under `React.StrictMode`: a setup→cleanup→setup double-invoke
would otherwise leave it stuck `true` from the simulated cleanup, and the step
would silently narrate nothing. `EnrichDirectProgress` carries that same comment
for the same reason. The new test renders inside StrictMode precisely so it can
fail on that mistake — a plain render passes either way.

One call is deliberately left unguarded: the `bootstrap` invalidation after a
successful generate. Those pages exist on the server whether or not the step is
still on screen, so skipping it would leave a stale nav behind.
