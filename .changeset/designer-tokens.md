---
'@adminium/server': patch
'@adminium/llm': patch
'@adminium/manifest': patch
---

The Designer sends less at each step. What a turn no longer needs is cut to a line before each call to the model: a file read before it was changed, the earlier writes of a file written again, a check a later check replaced, reference pages read many steps ago. On the turns measured this takes 20 to 46 % off the conversation sent in a long turn. With Anthropic, the unchanged part of each request is read from its prompt cache, and what the cache read is counted in the tokens shown. A sample check that models misread is reworded to say what to write.
