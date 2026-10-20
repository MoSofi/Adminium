---
'@adminium/server': patch
---

Adminium Designer reads Figma. The composer's paperclip is now an Attach menu: files from your computer, or From Figma…. Paste a link to a frame, and the Designer gets two files with your message: a picture of the frame and its design document (sizes, gaps, padding, colours, fonts, corners, components and the pictures' shapes), which it builds the screens from. During a turn it can read one part of the frame in more detail (`read_figma`, at most three Figma reads a turn).

Each person connects their own Figma personal access token (one that can read their user details, file content and file metadata), in the From Figma… dialog. It is checked with Figma before it is kept, kept encrypted on the server under a key of its own, and used only for that person's imports; the Security page shows it and can change or remove it. A token kept under an earlier `ADMINIUM_SECRET` shows as not connected, so it is asked for again. Every read Figma counts is said where you see it, a frame imported again is read from the copy the server kept until the file changes, and after Figma says a seat's monthly reads are used up the Designer stops reading until the date Figma gave. Under `adminium design`, `ADMINIUM_FIGMA_TOKEN` in the process's environment stands in for the project owner's token. Figma is off where network features are off. New migration `0061_user_figma_token`.

The Designer's window budget now counts the tool definitions sent with every request, so a long session on a small window (Ollama) is trimmed to what really fits.
