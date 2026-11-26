---
'@adminium/server': patch
---

The Designer no longer names the provider of the AI an installation includes. When a model call failed on the connection the operator set, the note read "The model stopped answering (openai-compatible, 429)", and on a server that reaches Ollama or OpenAI directly it named them. It now reads "The included AI stopped answering (429)", and the server leaves the provider's name out of the event it sends, not just out of the sentence. The provider's own words still follow, as before. A person's own connection is named as it was.
