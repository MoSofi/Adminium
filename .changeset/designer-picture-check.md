---
'@adminium/llm': patch
'@adminium/server': patch
---

The Designer no longer says a model through OpenRouter cannot read pictures when it can. When a server's model list says which models take pictures (OpenRouter does), the Designer goes by that list. Otherwise it asks the model, and an answer that names both colours now counts in either order: Claude Sonnet 5.5 answered "Blue Yellow" every time. A server that refuses the picture is believed for five minutes, then asked again, so a passing error no longer marks a model as unable to read pictures until the server restarts.
