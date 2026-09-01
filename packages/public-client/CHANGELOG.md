# @adminium/public-client

## 0.2.4

## 0.2.3

## 0.2.2

### Patch Changes

- a94f776: Add the browser client for the scoped public API: a dependency-free
  `createPublicClient` that returns `null` when its build-time env is absent, so a
  demo build falls back to seed data structurally rather than in a catch, plus the
  tenant-timezone helpers every connected app needs to avoid rendering a
  15:00 London appointment at 16:00 in a Berlin browser.
