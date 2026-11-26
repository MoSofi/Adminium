---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

The Designer, from a walk on real models:

- The look at the page now tells the model which colours the picture shows. With the Designer in dark mode it saw the page's dark look and "fixed" it, once taking a site's dark mode away.
- A page out of sight (its tab in the background) sends no picture of itself, and the model is told it could not look. A picture drawn as one flat colour is dropped. Before, the model took an empty picture for a blank page and rewrote a working screen.
- The check for unstyled classes no longer reads a compared value, a row's key or a method's argument inside `className` as classes.
- The model can take away picture spots the pages no longer need (`remove_spots`). A spot the person filled, or one a screen still draws, is kept.
- The note at the end of a turn counts pictures to fill as the Pictures button does.
- An app's name sent with HTML entities ("Crumb &amp; Crust") is read as written ("Crumb & Crust").
- Each new reply of a turn starts a new paragraph in the chat.
- A reply whose tool call the provider lost (it ends to call a tool and brings no call: about 3 in 10 replies to one request on claude-sonnet-5-5) is asked again up to three times. It no longer ends a first turn as "empty", or a later turn as if the work were finished.
