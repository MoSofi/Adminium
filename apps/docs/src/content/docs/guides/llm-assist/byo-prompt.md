---
title: 'BYO round-trip: copy the prompt, paste the response'
description: Use any model you like to enrich the generated app, with zero network I/O from Adminium. Copy the prompt, paste the reply back, review the diff.
---

The BYO ("bring your own") path lets you use any model — Claude, ChatGPT, a
local Llama, a colleague with good judgment — without Adminium making a single
network request.

:::tip[The two guarantees]
**BYO runs perform zero network I/O.** Adminium builds a prompt, writes it to
your terminal or a file, and stops. Nothing is transmitted. There is no provider
to configure and none is recorded.

**BYO runs are never metered.** On Adminium Cloud, AI credits count only
Adminium-managed keys. A BYO run costs nothing because nothing happened on our
side.
:::

This is the path for air-gapped networks, for policies that forbid schema
leaving the building, and for anyone who would rather see exactly what is being
asked before it is asked.

## The round-trip

### 1. Generate the prompt

```bash
adminium generate-prompt --connection <id> --out ./prompt.md
```

```
Wrote /work/prompt.md

runId:          run_01HQ8F2K3M
token estimate: ~4820

Next: paste the prompt into your model, save the reply, then run
  adminium apply-llm-response --run run_01HQ8F2K3M --file ./response.json
```

Two facts matter here. The **runId** identifies this run for the rest of the
round-trip — a first-class row, exactly as a direct-API run would be. The
**token estimate** tells you whether it fits your model's context before you
find out the hard way.

Without `--out`, the prompt prints to stdout — pipe it wherever you like:

```bash
adminium generate-prompt --connection prod-db | pbcopy
```

The prompt is self-contained: a `=== SYSTEM ===` section and a `=== USER ===`
section, everything the model needs, no Adminium-specific tooling required at
the other end. It is byte-identical to what the Studio's BYO screen shows and to
what the direct-API path would have sent — one prompt, three front doors.

### 2. Paste it into your model

Any chat interface. Claude, ChatGPT, a local model, a web UI. Paste the whole
file and let it answer.

### 3. Save the reply

Save the model's JSON response to a file:

```bash
# whatever your model gave you, as JSON
cat > response.json
```

### 4. Feed it back

```bash
adminium apply-llm-response --run run_01HQ8F2K3M --file ./response.json --dry-run
```

`--dry-run` validates, prints the diff, and **writes nothing**:

```
  category   target            status     heuristic         llm                conf
✓ label      public.cust       proposed   Cust              Customers          0.94
✓ label      public.cust.ref   proposed   Ref               Reference number   0.91
✓ enum       public.ord.st     proposed   —                 draft|paid|void    0.88
  relation   public.ord.cid    proposed   —                 → public.cust.id   0.62

--dry-run: would apply 3 of 4 suggestion(s) at confidence ≥ 0.8. Nothing was written.
```

Drop `--dry-run` to apply:

```bash
adminium apply-llm-response --run run_01HQ8F2K3M --file ./response.json
```

```
Applied 3 suggestion(s): 3 override(s), 0 page(s).
1 suggestion(s) below the bar were not applied.
```

## Exit codes

`apply-llm-response` is scriptable, and its exit codes are a published contract:

| Code | Meaning |
|---|---|
| `0` | Applied (or `--dry-run` validated and would apply) |
| `2` | **Validation failed** — the response did not match the schema. Nothing applied. |
| `3` | **Nothing accepted** — valid, but nothing met the confidence bar. Nothing applied. |
| `1` | Anything else: bad usage, unreachable database, missing file. |

```bash
adminium apply-llm-response --run "$RUN" --file resp.json
case $? in
  0) echo "applied" ;;
  2) echo "model returned garbage; not retrying" ;;
  3) echo "nothing confident enough" ;;
  *) echo "operational failure" ;;
esac
```

## When validation fails

Models sometimes return prose, invent a field, or trail off. Adminium validates
against the `adminium.llm/v1` schema and prints exactly what went wrong, per
path:

```
Validation failed — nothing was applied.

path                      code            message
tables[2].columns[0].kind  invalid_enum    expected one of: label, enum, relation
tables[4]                  unrecognized    unknown table "public.orderz"
```

Exit code `2`, nothing written. Paste the errors back into your model and ask it
to fix them — that usually works on the first try.

## Options

```bash
# Only ask for labels and enums
adminium generate-prompt --connection <id> --sections labels,enums

# Multi-locale output (en_US is always included)
adminium generate-prompt --connection <id> --locales en_US,de_DE

# Include capped sample values — opt-in, off by default
adminium generate-prompt --connection <id> --sampling

# Accept more (or less) aggressively
adminium apply-llm-response --run <id> --file resp.json --yes-above 0.6
```

:::caution[`--sampling` sends rows into the prompt]
Without it, the prompt carries schema metadata and aggregates only — never your
data. With it, a capped number of example values per column are included, which
is often the only way a model can tell that a `varchar` is really an enum.

On the BYO path the prompt still goes nowhere by itself — but *you* are about to
paste it into a model. Know what is in the file. It is plain text; read it.
:::

## Large schemas: chunked runs

Past a size, the prompt is split into chunks:

```bash
adminium generate-prompt --connection big-db --out ./prompt.md
```

```
Wrote /work/prompt.1.md
Wrote /work/prompt.2.md
Wrote /work/prompt.3.md

runId:          run_01HQ8F2K3M
token estimate: ~48200
chunks:         3
```

Paste each chunk separately and feed each reply back with `--chunk`:

```bash
adminium apply-llm-response --run run_01HQ8F2K3M --file ./resp.1.json --chunk 1
# Chunk 1/3 accepted — paste the remaining chunk(s) before applying.  (exit 3)

adminium apply-llm-response --run run_01HQ8F2K3M --file ./resp.2.json --chunk 2
adminium apply-llm-response --run run_01HQ8F2K3M --file ./resp.3.json --chunk 3
# Applied 31 suggestion(s): 28 override(s), 3 page(s).                  (exit 0)
```

Chunks accumulate against the run. Exit `3` on an incomplete run is correct, not
an error: the chunk landed, and there is nothing to apply yet.

## Doing this in the Studio instead

Settings → AI → BYO shows the same prompt with a copy button and a textarea to
paste the reply into, then the same diff with checkboxes and a confidence
slider. Same run, same validation, same transaction. Use whichever fits your
hands.

## See also

- [LLM assist overview](/guides/llm-assist/) — what gets suggested, and the
  `user > llm > heuristic` precedence rule
- [CLI reference](/reference/cli/#generate-prompt)
