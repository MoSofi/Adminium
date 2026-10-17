<!-- produced from apps/docs/src/content/docs/reference/cli.md § `generate-prompt`; do not edit -->

# CLI reference: `generate-prompt`

```
adminium generate-prompt --connection <id> [--sections <list>] [--locales <list>]
                        [--sampling] [--out <file>]
```

Creates a BYO run from the connection's latest snapshot and writes the prompt.
Paste it into any chat model, save the reply, and feed it back with
[`apply-llm-response`](https://docs.adminium.dev/reference/cli/#apply-llm-response).

Nothing leaves this machine: BYO runs record no provider and no model, and the
prompt carries schema metadata + aggregates only — never your rows, unless you
opt in with `--sampling`.

| Flag | Default | |
|---|---|---|
| `-c`, `--connection <id>` | **required** | Connection id to build the prompt for |
| `--sections <list>` | all sections | Decision groups to request, e.g. `labels,enums,relations` |
| `--locales <list>` | `en_US` | Output locales, e.g. `en_US,de_DE` (`en_US` is always included) |
| `--sampling` | off — sample-free | Opt in to including sampled example values in the prompt |
| `-o`, `--out <file>` | print to stdout | Write the prompt here (chunked runs get `<name>.<n>.<ext>`) |
| `--data-dir <path>` | | Data directory |
| `--meta-url <dsn>` | | Meta store DSN |

Prints the `runId` and a token estimate.
→ [BYO round-trip](https://docs.adminium.dev/guides/llm-assist/byo-prompt/)

---
