---
title: The LLM never writes on its own
description: A model produces a proposal, a person accepts specific suggestions, and one transaction applies them with a before-image for undo — there is no path from a model response to the database.
---

## The situation

Adminium can use a model to improve what it inferred from a schema: better
labels than the column name, a guess at which column is a record's title, an
enum's values written out, a suggestion that a table is a join table. This is
genuinely useful — column names are frequently worse than a model's reading of
them.

It is also a model writing to a database it was told about in a prompt. Left
unguarded, a plausible-sounding hallucination becomes a configuration change
nobody asked for, and the person who notices is the operator, weeks later.

## The decision

**A run produces a proposal. A person applies it.** There is no code path from a
model response to a write.

The shape, in order:

1. **A run is built and persisted as a `draft`** — the prompt is assembled from
   the connection's stored schema snapshot plus collected statistics, and the
   flattened prompt text is saved with its SHA-256 alongside the run. What the
   model was asked is a record, not a reconstruction.
2. **The response is validated against a snapshotted allow-list.** Suggestions
   may only name vocabularies that existed at pack time — widget ids, template
   ids, icon names. A suggestion naming something outside them is rejected
   before a human ever sees it.
3. **A person reviews and accepts individual suggestions.** Acceptance is
   per suggestion, not per run.
4. **One transaction applies exactly what was accepted**, writing
   `adminium_schema_overrides` rows with `origin: 'llm'` and the run's id, plus
   any pages the accepted suggestions imply.

Three invariants hold at the write layer rather than in the UI, because that is
where they cannot be bypassed:

- **A user edit outranks a model.** The apply path only ever reads and writes
  `origin: 'llm'` rows, so an override a person set is never touched or
  superseded. Suggestions whose target is user-locked produce no write
  descriptor at all.
- **Re-applying is idempotent.** Overrides upsert on
  (connection, operation, table, column) and pages upsert on an id derived from
  the suggestion id, so applying the same run twice writes nothing new, and a
  newer run supersedes an older one.
- **Undo is exact.** Every insert and update captures a before-image inside the
  apply transaction, and undo reverts that one apply in one transaction.

**Bring-your-own is a first-class path, not a fallback.** You can copy the exact
prompt out, run it against whatever you like, and paste the response back;
validation is the same pipeline. A BYO run deliberately records no provider and
no model, because it does not know them.

**The planner is pure.** Turning a reviewed run into write descriptors is a
browser-safe function with no database access. Only the executor touches the
database.

## What it means for a contributor

- **Do not add a path that applies a response automatically**, not even behind
  a flag or a "trusted provider" setting. The review step is the decision.
- **A new suggestion kind needs a vocabulary entry**, or validation will reject
  it — which is the correct behaviour, not a bug to work around.
- **A new write in the apply path needs a before-image**, or undo silently
  stops being exact.
- **Keep the planner pure.** If it needs to read the database to decide, the
  read belongs in the service that builds its input.

[LLM assist](/guides/llm-assist/) is the user-facing guide, and
[the BYO round-trip](/guides/llm-assist/byo-prompt/) walks the paste-back path.
