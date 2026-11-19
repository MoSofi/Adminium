---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/add-on-contracts': patch
'@adminium/i18n': patch
---

Live landing pages are now served to strangers at `/x/pages/<slug>`, with their data and pictures under `/x/pages/api/`. The server writes each page's title, description, language and preview picture into the HTML itself, so a link shared in a chat shows the page, and a page may be indexed by search engines only on its main address. A host mapped for pages can show a live page as its home. A page's form blocks draw the real form, and its pictures are served from files the page owns.

Staff get the routes a pages editor needs under `/api/v1/landing/`: a first draft of a page written by Milo from a short description (marked for review, from the person's own allowance), the live forms and live pages a page can link to, the rule a funnel leads to, picture uploads, and where a page answers. A role held to some rows of the pages table cannot use them.
