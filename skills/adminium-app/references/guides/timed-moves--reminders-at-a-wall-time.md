<!-- produced from apps/docs/src/content/docs/guides/apps/timed-moves.md § Reminders at a wall time; do not edit -->

# Timed moves on the venue's clock: Reminders at a wall time

An outbox reminder before a moment is sent a number of hours before it
([emails](https://docs.adminium.dev/guides/apps/emails/#what-queues-a-row)). With `lead.at`, it is sent at a wall time on the
venue's day the lead reaches instead:

```json
"producers": [
  {
    "kind": "reminder",
    "link": "order_id",
    "before": {
      "table": "orders",
      "at": "pickup_at",
      "lead": {
        "via": "customer_id", "table": "customers", "column": "reminder_hours",
        "fallback": { "table": "settings", "column": "reminder_hours" },
        "max": 48,
        "at": "09:00"
      }
    }
  }
]
```

With a lead of 24 hours before a Saturday 20:00 pickup, the reminder goes at 09:00 on Friday. With
a lead of 3 hours, the day it reaches is Saturday, so it goes at 09:00 on Saturday. Without `at`,
it goes at the hour itself, 17:00. A reminder is sent only while its moment is still ahead, so a
wall time later in the day than the moment sends nothing that day: pick an early one.
