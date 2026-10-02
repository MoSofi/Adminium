---
'@adminium/server': patch
'@adminium/llm': patch
'@adminium/meta': patch
'@adminium/dashboard': patch
'@adminium/ui': patch
---

The assistant finishes more of the turns it starts, on a local model above all.

- **Ollama.** Every request states its context window (`num_ctx` 32,768) instead of inheriting Ollama's few thousand tokens, which dropped the start of a long prompt, the instructions, without an error; a chat request may take four minutes rather than one.
- **Long turns.** A running job keeps its lock fresh while its handler is in flight, so a turn longer than the stale window is no longer claimed a second time mid-run. A turn whose process died is ended as failed instead of reading "running" for ever.
- **Rounds.** A turn has enough rounds to spend every lookup it is allowed and still answer, and is told when its last round has come, so it writes with what it has.
- **Tools.** The row and aggregate tools show worked filters and descriptors beside their grammar, take `where` as an object, and name a table by its connection's name in the steps and sources a person reads. The invoice contexts show one real starter in the real format.
- **Replies.** A reply that ran to its end with unbalanced JSON is repaired as a parse error rather than retried as if it had run out of tokens.
- **Saving.** A draft saves once: a second save of the same turn answers with the document the first one made, and the button reads "Saved". A result's sheet is drawn flush inside the assistant's card, and the header keeps its chips beside the title.
