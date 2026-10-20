---
'@adminium/llm': patch
---

The input limit assumed for an Ollama model is now 23,500 tokens (it was 20,000), so a Designer request on Ollama that asks for screens and names an add-on, with every tool definition, still leaves room to talk.
