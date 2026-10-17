---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/llm': patch
---

"Add a model" loads the models by itself once a key is pasted (Ollama's at once), and has a "Load models" button beside the Model field, which is now a searchable list. Ollama starts on a model that runs on this machine; a `:cloud` model the account has no plan or credit for says so instead of reading as a failed connection, and a model the server refuses tools for reads as one that cannot build.
