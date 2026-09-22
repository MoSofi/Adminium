# @adminium/public-client

## 0.3.0-rc.3

### Patch Changes

- ae41762: **The public client can replace, delete and batch-write rows, and `list()` reads every response shape.**
  
  - `replace(ref, id, values)` sends a PUT. Every column the key may write must be included.
  - `remove(ref, id)` deletes one row.
  - `batch(ref, rows)` writes 1 to 500 rows in one transaction and returns `{ count }`.
  
  `list()` returns `{ data, cursor }` whether the endpoint answers wrapped, as a bare array (the
  next cursor comes from `X-Next-Cursor`) or as a single row, and it makes no extra request to
  find out which. `PublicAction` gains `replace`, `delete` and `batch`, and a ref's config may
  carry `response.shape`. These need a server from 0.3.0.

## 0.3.0-rc.2

## 0.3.0-rc.1

## 0.3.0-rc.0

## 0.2.9

## 0.2.8

## 0.2.7

## 0.2.6

## 0.2.5

## 0.2.4

## 0.2.3

## 0.2.2

### Patch Changes

- a94f776: Add the browser client for the scoped public API: a dependency-free
  `createPublicClient` that returns `null` when its build-time env is absent, so a
  demo build falls back to seed data structurally rather than in a catch, plus the
  tenant-timezone helpers every connected app needs to avoid rendering a
  15:00 London appointment at 16:00 in a Berlin browser.
