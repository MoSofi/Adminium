---
'@adminium/server': patch
'@adminium/llm': patch
---

A model can now be given to the server by its environment, with nothing saved in Settings → AI: `ADMINIUM_AI_ANTHROPIC_API_KEY`, `ADMINIUM_AI_OPENAI_API_KEY`, `ADMINIUM_AI_COMPATIBLE_BASE_URL` (with `ADMINIUM_AI_COMPATIBLE_API_KEY`), `ADMINIUM_AI_OLLAMA_BASE_URL`, and `ADMINIUM_AI_MODEL` as `<provider>/<model>`. The page assistant and the AI assist use the saved provider when there is one and the environment's model when there is none. In a project folder the same names go in `.env`, and they are the one part of that file the server does not copy into its environment. Every path that calls a model now checks its address first, and calls only a local model when `ADMINIUM_NETWORK_FEATURES` is off. New: `GET /llm/connections` and `GET /llm/connections/:id/models`.
