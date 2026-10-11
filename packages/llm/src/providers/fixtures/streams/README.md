# Recorded provider streams

Each file is the body of one streamed reply, line for line as the provider sent it. The run tests
replay them through the normalisers, cut at awkward byte boundaries.

A file whose first line starts with `# synthetic` was WRITTEN from the provider's published stream
format, not recorded. It stands in until a recording replaces it. Lines starting with `# ` at the
top of a file are notes and are not replayed.

To record: set the provider's key or address in the environment (the `ADMINIUM_AI_*` names) and run

    ADMINIUM_LIVE_PROVIDERS=1 ADMINIUM_RECORD_STREAMS=/tmp/streams \
      pnpm --filter @adminium/llm exec vitest run src/providers/live.smoke.test.ts

The recorder replaces the key with `[REDACTED]` and every message, completion, request and
organisation id with a fixed placeholder of the same shape, and blanks `system_fingerprint`.
Read a new file before committing it.

## What is recorded, and what is not (2026-10-11)

- `ollama-*` (but `ollama-in-stream-error`) and `openai-compatible-*` are recordings, taken through a
  local Ollama (its own protocol, and its OpenAI-style address at `/v1`) from the two models named
  on each file's first line. One of them thinks before it answers: the thinking arrives in its own
  field (`thinking`, `reasoning`) and is not part of the reply.
- `anthropic-recorded-*` and `openai-recorded-*` are recordings from the two services
  (`claude-haiku-5-5`, `gpt-6-luna`): text, one tool call, two tool calls, the tokens running out.
  The run tests replay them as they are. Anthropic's "one tool" shows the cache being read, and its
  "tokens ran out" is a reply whose every token went to thinking.
- `anthropic-*` and `openai-*` without `recorded` in the name are still written by hand, and stay:
  each holds a shape a recording does not happen to have (fragments of two calls interleaved, a call
  cut off in the middle of its arguments, the cache's counts given twice). Recording into this folder
  writes over them: record into another folder and copy the files in under their `-recorded-` names.
- `*-bad-arguments` and `*-in-stream-error` cannot be made on demand and stay written.
