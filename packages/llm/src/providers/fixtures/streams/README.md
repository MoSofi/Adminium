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

## What is recorded, and what is not (2026-10-03)

- `ollama-*` (but `ollama-in-stream-error`) and `openai-compatible-*` are recordings, taken through a
  local Ollama (its own protocol, and its OpenAI-style address at `/v1`) from the two models named
  on each file's first line. One of them thinks before it answers: the thinking arrives in its own
  field (`thinking`, `reasoning`) and is not part of the reply.
- `anthropic-*` and `openai-*` are still synthetic: no key for either was available when the
  Designer was first evaluated. Record them before trusting a change to those two readers.
