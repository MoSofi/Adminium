---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/llm': patch
'@adminium/i18n': patch
---

Attach a picture or a CSV file to a Designer message: by the clip, a paste or a drop, up to four a message.

- A picture (PNG, JPEG, WebP, GIF; 5 MB) is sent to the model when the model reads pictures. Whether it does is asked of the model, once; when it does not, the box says so before the message is sent.
- A CSV (10 MB, 20,000 rows) is shown to the model as its columns and first rows. Once the app is applied, a card asks before its rows are loaded into one of the app's tables; the load is the dashboard's own import, so the table's checks hold and Imports keeps the report.
- What a file is, is read from its bytes; anything else is refused. Files are kept in the session's folder and served back only to the Designer's own page, with headers under which nothing in them can run.
- The Designer now tells a model when its staff role reads a table and not its personal columns (an email, a phone number): a board on such a table was refused for that role in the preview.
