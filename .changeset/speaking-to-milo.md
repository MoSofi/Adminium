---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/llm': patch
'@adminium/meta': patch
'@adminium/i18n': patch
'@adminium/desktop': patch
---

You can speak to the assistant. With Settings → AI → Voice → "Speak to the assistant" switched on (off on a new workspace), the panel's field has a microphone: press, speak, press again or Escape, and the words are written into the field for you to check and send. Nothing is sent by voice alone. A recording stops by itself at two minutes.

With OpenAI, or a compatible server that has a transcription route, the provider writes the words down: the recording goes through your server to it and is kept nowhere, and the audit log says who dictated and for how long, never what. With a provider that does not transcribe, the browser's own speech service does it where the browser has one, and the server never hears it. Where neither works there is no microphone. The first press says where your voice goes.

A workspace sets how many minutes a person may dictate in a day (30 by default), counted from what the server received.

The desktop app allows the microphone, for audio only and only while the switch is on; every other browser permission stays denied.
