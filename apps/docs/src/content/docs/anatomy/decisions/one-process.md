---
title: One process, no Redis
description: The queue is a table, the scheduler is in-process, the rate limiter is a Map — why Adminium has no sidecars, and exactly what that costs you when you run more than one replica.
---

## The situation

An admin panel needs background work: CSV imports, exports, scheduled reports,
outbound email, automation runs, LLM calls. The industry answer is a queue
service, a worker process, and a scheduler — three things to deploy, three
things to monitor, and a Redis instance to lose.

Adminium's deployment target is one container, one VPS, or a desktop app on a
laptop. Every piece of infrastructure it requires is a cost paid by every person
who self-hosts, forever.

## The decision

One Node process, and nothing beside it.

| Concern | How it works instead |
|---|---|
| Queue | `adminium_jobs`, a table. Workers claim a row with a portable `UPDATE` guard, so claiming is safe without a lock service. |
| Retries and dead-lettering | Columns on the same row: attempt count, exponential backoff, a terminal status. |
| Scheduler | [croner](https://github.com/hexagon/croner) inside the process. Each named schedule enqueues a job; a guard skips the tick while the last job it enqueued is still pending or running, and optional jitter de-synchronises fleets. |
| Rate limiting | A fixed-window counter in a `Map`, plugged into `@fastify/rate-limit` as a custom store. Keys embed the bucket name, so buckets share one map without colliding. |
| Realtime | Server-sent events and a WebSocket from the same server. |
| Cache | The database, or a per-process memo. There is no cache tier. |

## What it costs

This is the honest part, and it is not in the marketing copy.

- **Two replicas double-enqueue schedules.** The no-overlap guard remembers the
  last job *this process* enqueued. It is in memory, not in the database, so a
  second replica's scheduler does not see it. Jitter spreads the ticks out; it
  does not deduplicate them.
- **Rate limits multiply by the replica count.** The counter is per process, so
  N replicas grant N times the allowance.
- **Extra workers are safe.** The claim guard is the one piece that *is*
  correct across processes.

So the supported shape is one process. Running more is possible, and the two
caveats above are what you are signing up for.

## What it means for a contributor

- **New background work is a job kind**, registered in
  `apps/server/src/jobs/`. It is never a new process, a `setInterval` in a route
  file, or a detached child.
- **Do not reach for a cache that is not the database.** If a value is worth
  keeping between requests, it is worth a table or a column.
- **Do not add a dependency on a broker.** If a feature seems to need one, the
  feature needs a different shape.

The self-hosting pages say the same thing to operators:
[Overview & requirements](/self-hosting/) opens with it.
