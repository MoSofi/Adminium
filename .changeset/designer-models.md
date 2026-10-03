---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/llm': patch
'@adminium/i18n': patch
---

Adminium Designer's model picker and "Add a model" dialog. The picker lists every model by connection, finds one as you type, marks a model that cannot build apps, and says when a connection could not be reached. The dialog adds Anthropic, OpenAI, an OpenAI-compatible service or Ollama: test the key or address, see whether the chosen model can build, and save it to the project's `.env` (the key never comes back to the browser). A model that could not be asked — a refused key, no answer — now fails the test and the start of a session with that reason, instead of being reported as unable to build. The design link opened in a tab already showing the Designer is now taken out of the address and spent.
