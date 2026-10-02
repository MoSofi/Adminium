# Recorded provider streams

Each file is the body of one streamed reply, line for line as the provider sent it. The run tests
replay them through the normalisers, cut at awkward byte boundaries.

A file whose first line starts with `# synthetic` was WRITTEN from the provider's published stream
format, not recorded. It stands in until a recording replaces it. Lines starting with `# ` at the
top of a file are notes and are not replayed.

To record: set the provider's key or address in the environment (the `ADMINIUM_AI_*` names) and run

    ADMINIUM_LIVE_PROVIDERS=1 ADMINIUM_RECORD_STREAMS=src/providers/fixtures/streams \
      pnpm --filter @adminium/llm exec vitest run src/providers/live.smoke.test.ts

The recorder replaces the key with `[REDACTED]` and every message, completion, request and
organisation id with a fixed placeholder of the same shape, and blanks `system_fingerprint`.
Read a new file before committing it.
