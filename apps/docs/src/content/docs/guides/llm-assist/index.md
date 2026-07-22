---
title: LLM assist
description: Optional AI enrichment of the generated app. Two paths, one contract — and the BYO path performs zero network I/O.
---

Adminium's schema classification is **heuristic and deterministic**. It reads
your types, keys, and names, and it decides. No model is involved, and none is
required. Point Adminium at a database with no AI configured at all and you get
a complete app.

LLM assist is a layer on top of that: it can propose better labels, spot enums
your schema did not declare, suggest relations, and write descriptions. Every
suggestion arrives as a **reviewable diff against the heuristic baseline**, never
as a silent overwrite.

## Two paths, one contract

| | Direct API | BYO round-trip |
|---|---|---|
| How | Adminium calls the provider with your key | You copy a prompt, paste the response back |
| Network | Adminium → provider | **None. Zero.** |
| Providers | Anthropic, OpenAI, Ollama | Anything you can paste into |
| Available offline | No | Yes |

Both paths produce the **same run**, validated by the same schema, reviewed
through the same diff, applied by the same transaction. The BYO path is not a
degraded mode — it is the same contract with you as the transport.

- [BYO round-trip](/guides/llm-assist/byo-prompt/) — copy the prompt, paste the
  response.

## What is sent

Whichever path you take, the prompt carries **schema metadata and aggregates
only**:

- Table and column names, types, nullability
- Keys, constraints, indexes
- Counts and cardinalities

**Not your rows.** The single exception is opt-in and explicit: `--sampling`
includes a capped number of example values per column, because sometimes the only
way to know `status` holds `'A' | 'B' | 'C'` is to look. It is off by default and
you have to ask for it by name.

## What can be suggested

| Section | What it improves |
|---|---|
| `labels` | Human names for tables and columns — `cust_ref_no` → "Customer reference" |
| `enums` | Values a `varchar` actually holds, so it becomes a select |
| `relations` | Relationships your schema implies but does not declare |
| `descriptions` | Field help text |
| `pages` | Layout and grouping proposals |

Request a subset with `--sections labels,enums`.

## Precedence, and why nothing is ever clobbered

```
user > llm > heuristic
```

Your own edits always win. An LLM suggestion overrides the heuristic default,
never a value you set yourself. Applying the same run twice writes no
duplicates. Every applied suggestion records its provenance, so you can always
answer "why does this field say that?" — and undo it.

## Confidence

Every suggestion carries a confidence score. The review screen defaults to
accepting everything at **≥ 0.8**; the CLI's `--yes-above` is the same control
with the same default.

Below the bar is not "wrong", it is "look at this one". Lower the threshold and
review more.

## None of this is required

There is no degraded experience without it. The heuristic classifier is the
product; LLM assist makes a good app slightly better at naming things. If your
policy forbids sending schema anywhere, use the
[BYO path](/guides/llm-assist/byo-prompt/) — or nothing at all.
