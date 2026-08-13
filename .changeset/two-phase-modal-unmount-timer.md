---
"@adminium/ui": patch
---

Cancel `TwoPhaseModal`'s deferred reset timer on unmount.

The component defers `flow.reset()` past the exit animation so the success phase never flashes back to the form while closing, but cleared that timer only if the modal was closed again before it fired. An unmount in between left it running, so the reset landed on a component that no longer existed — a setState-after-unmount in the app, and in CI a load-sensitive failure where the timer fired after the test environment had been torn down.

The clear-on-reclose behaviour is unchanged; the two are complementary.
