<!-- produced from apps/docs/src/content/docs/reference/cli.md § `apply-llm-response`; do not edit -->

# CLI reference: `apply-llm-response`

```
adminium apply-llm-response --run <runId> --file <response.json>
                           [--chunk <n>] [--yes-above <0..1>] [--dry-run]
```

Feeds a saved model reply back into its run: validates it, prints the diff
against the heuristic baseline, and applies the rows at or above the confidence
threshold in one transaction.

Your own edits are never overwritten (`user > llm > heuristic`), and applying the
same run twice writes no duplicates.

| Flag | Default | |
|---|---|---|
| `-r`, `--run <runId>` | **required** | Run id from `generate-prompt` |
| `-f`, `--file <path>` | **required** | The saved model response |
| `--chunk <n>` | unchunked | Which chunk this file answers, for chunked runs |
| `--yes-above <0..1>` | `0.8` | Accept suggestions at or above this confidence |
| `--dry-run` | off | Validate and print the diff; write nothing |
| `--data-dir <path>` | | Data directory |
| `--meta-url <dsn>` | | Meta store DSN |

**Exit codes: `0` applied · `2` validation failed · `3` nothing accepted.**

→ [BYO round-trip](https://docs.adminium.dev/guides/llm-assist/byo-prompt/)

---
