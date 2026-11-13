---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

Trial mode and the hosted profile now switch off what lets a stranger reach the operator's servers. A source database must be on `ADMINIUM_DATABASE_HOSTS`, never a SQLite file, and on the operator's own database hosts only the login of `ADMINIUM_SOURCE_URL` works; database connection tests share one budget of 10 a minute for the whole installation. Moving or adopting the meta store answers 403 (the setup token does not open it), and storage stays on the local disk. In a trial the webhook step, every add-on's network calls, payment services, the Designer's picture search and Figma, and AI addresses of one's own (and the OpenAI-compatible and Ollama providers) are off too; one's own key to Anthropic, OpenAI or Google stays. Each refusal is a 403 `OFF_BY_OPERATOR` naming what is off, and the dashboard shows those choices disabled with the operator's reason, never hidden, including the SQLite choice in the three connect wizards.
