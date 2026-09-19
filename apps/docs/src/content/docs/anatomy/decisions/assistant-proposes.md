---
title: The assistant proposes, a person saves
description: The page assistant's last move is a draft. Creating the row is a separate, confirmed, audited action a person takes — there is no code path from a model reply to a write.
---

## The situation

The page assistant knows a lot about the page it was opened from: its
documents, the format they are written in, the schema behind them, and — when
an operator allows it — rows from the connected database. It is a short step
from there to "and then it saves the template for you", and every product with
an assistant in it feels the pull.

That step is the whole problem. A model that can write produces changes nobody
asked for, at a rate nobody reviews, in a system whose whole point is that its
configuration is inspectable. The person who notices is the operator, later,
looking at a document they did not make.

The same reasoning already governs schema enrichment —
[the LLM never writes on its own](/anatomy/decisions/llm-never-writes/) — but
enrichment is a batch a person reviews as a diff. A conversation is different:
it is fast, it is interactive, and the temptation to close the loop is
stronger.

## The decision

**The model's terminal move is a draft.** Saving is a separate action a person
takes, and it is gated three times over.

The contract the model answers on has exactly three moves: run read tools, ask
the operator a question, or produce a draft. There is deliberately **no write
move** — not a restricted one, not one behind a flag. A reply that asked for a
write would not parse.

Everything after the draft is somebody's decision:

1. **Actions are locked when the window opens**, and the lock is per open: a
   decision made a minute ago does not carry into the next conversation.
2. **A write needs the page's own permission.** Not the assistant's — the same
   one the page's Save button needs. A role that may open the assistant and
   may not save is the ordinary case, and its buttons stay locked with a
   sentence saying why.
3. **A write asks once more**, naming what it will create and where, before it
   runs.
4. **What it creates is a draft** — an email template disabled, a report with
   status `draft`. Nothing the assistant does publishes, sends to
   a customer, or changes an existing row.
5. **Every write is audited**, with the session and turn that proposed it.

Two further invariants hold because they cannot be enforced by asking nicely:

- **The draft is validated by the page's own acceptor** — the same function the
  page's Save runs. A draft that validates is a draft the editor can open; one
  that does not is sent back to the model with the page's own complaint, not
  shown to a person.
- **Reads are checked per table, per person.** The assistant reads with the
  grants of whoever opened it, not with the server's. A table you cannot read
  is a table it cannot read, and masked columns stay masked on the way out.

**Putting a draft on the screen is not a write.** In an editor, *Open in
editor* replaces the unsaved document you are looking at and marks it unsaved.
Nothing reaches the database, `Ctrl`/`⌘`+`S` still decides, and one undo takes
the whole thing back.

## What it means for a contributor

- **Do not add a write move to the turn contract**, and do not add an action
  that skips the confirm because it "obviously" should. The confirm is the
  decision, not a speed bump.
- **A new action needs three things**: a permission check that matches the
  page's own, an audit row, and a state the page treats as a draft. Two of
  three is a bug.
- **A new context validates with the page's acceptor**, never with a second
  copy of its rules. Two validators disagree the first time either changes.
- **Never widen a read.** Tools take the acting person's grants; a tool that
  read with more would make the assistant a way around the permission system
  rather than a client of it.

[The page assistant](/guides/llm-assist/milo/) is the user-facing guide.
