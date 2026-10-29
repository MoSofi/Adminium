---
'@adminium/dashboard': patch
'@adminium/server': patch
'@adminium/llm': patch
'@adminium/meta': patch
'@adminium/i18n': patch
---

The Designer can make pictures with AI. The picture dialog has a fourth tab, **Make one**. It fills in the words from the spot or the sample row and makes 1 to 4 pictures with OpenAI, Google Gemini, an OpenAI-compatible server or Ollama, whichever service someone who manages AI settings chose. **Make one for each** makes a picture for each sample row, or one for each value of a column that its rows share. The Designer can also make pictures in the chat, with `make_pictures`, when the person asks. Each picture counts against a daily allowance: 20 per person, 100 for everybody and 8 per chat turn, set in Settings → AI, where 0 turns making off. A made picture is credited "Made with AI" with its service and model, and its words are kept in `CREDITS.json` but never shown on a page. `ADMINIUM_AI_GOOGLE_API_KEY` is a new picture-only key. Migration `0071_pictures_made` adds the counts. Every AI provider reply is now read with a size limit of 8 MB by default, so an outsized answer is refused instead of filling the server's memory.
