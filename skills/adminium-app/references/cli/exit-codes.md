<!-- produced from apps/docs/src/content/docs/reference/cli.md § Exit codes; do not edit -->

# CLI reference: Exit codes

| Code | |
|---|---|
| `0` | Success |
| `1` | Error — usage, unreachable database, missing file, bad configuration |
| `2` | `apply-llm-response`: validation failed. `check`: the project has a problem. |
| `3` | `apply-llm-response`: nothing accepted |
| `78` | Refused to start because of the environment |

`2` and `3` are a published contract, meaningful only for
[`apply-llm-response`](https://docs.adminium.dev/reference/cli/#apply-llm-response) and, for `2`, [`check`](https://docs.adminium.dev/reference/cli/#check).

`78` is sysexits(3)'s `EX_CONFIG`: the setup is in a state Adminium will not act
on — a meta store migrated by a **newer** Adminium (a rollback), a pre-upgrade
snapshot that could not be written, or a Node version too old to load the
database driver. Re-running cannot fix any of them, so a supervisor should stop
rather than retry:
[`RestartPreventExitStatus=78`](https://docs.adminium.dev/self-hosting/vps/). Everything else uses
`0` / `1`.

---
