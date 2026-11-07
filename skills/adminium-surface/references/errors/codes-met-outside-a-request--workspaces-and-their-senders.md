<!-- produced from apps/docs/src/content/docs/reference/errors.md § Codes met outside a request — Workspaces and their senders; do not edit -->

# Error codes: Codes met outside a request — Workspaces and their senders

### Workspaces and their senders

| Status | Code | When |
|---|---|---|
| `409` | `UNIQUE_VIOLATION` | A workspace already has that name. |
| `404` | `NOT_FOUND` | The workspace is not there, or the caller cannot see it. A list's `?workspaceId=` answers the same, so it never tells a hidden workspace from a missing one. |
| `422` | `VALIDATION_FAILED` | A list was sent both `workspaceId` and `connectionId`; name one. |
| `422` | `VALIDATION_FAILED`, `details.code: "not-a-sending-domain"` | A workspace sender's From address is not one this server's mail settings can send for. `details.domains` and `details.addresses` list where it can. |
| `422` | `VALIDATION_FAILED`, `details.code: "no-mail"` | The server has no mail set up yet, so no workspace can have a sender. |
| `422` | `VALIDATION_FAILED`, `details.code: "not-an-address"` | The sender's reply-to is not one plain address. |
