---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
'@adminium/desktop': patch
---

The Designer's picture dialog can search Pixabay too, beside Openverse, Pexels and Unsplash, when the project's `.env` (or the desktop app) has a `PIXABAY_API_KEY`. A Pixabay picture has its own badge, "Pixabay licence" (the Pixabay Content License): no credit is needed, and it is copied into the app like a Pexels or Openverse picture. As Pixabay's rules ask, the same search on Pixabay within a day shows the results kept from the first time and does not count against the key's 100 searches a minute, and the dialog now says which site the pictures come from ("Pictures from Pixabay") under every search's results.
