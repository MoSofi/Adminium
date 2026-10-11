---
'@adminium/llm': patch
'@adminium/dashboard': patch
---

OpenAI's current models work again. The Designer's requests with tools were refused by every OpenAI model that reasons (`gpt-6-luna` and its family); it now asks with the model's reasoning off, which is how OpenAI's Chat Completions address takes tools from such a model. The assistant and schema enrichment were refused too (`max_tokens`, then temperature 0): they now send `max_completion_tokens`, and keep temperature 0 by switching the reasoning off where a model asks for that. OpenAI-compatible servers are sent what they were sent before.

The model lists shown before a provider answers are the current ones (Claude Sonnet 5.5, Haiku 5.5, Opus 5.5, Fable 5.1; GPT-6.1 Sol, GPT-6 Luna, GPT-6 Astra), and OpenAI's list no longer offers its models that do not chat (speech, live audio, pictures, search). Both were tried through the Designer on real requests: see "Models tried" in the Designer's guide.
