---
'@adminium/dashboard': patch
'@adminium/widgets': patch
'@adminium/server': patch
'@adminium/manifest': patch
---

An edit form shows a link by its name ("BR-2291"), as a new row's does, instead of its number, and a list's or a record's link chip names the row the way the form's picker does, following the key field its table declares today. A record whose title is a choice shows the choice's word ("The lettering"). A field an app's form marks required is asked for on a new row before anything is sent, with "This field is required." under it. A form's picker can be narrowed by another field of the same form (`reference.scope`, from 0.3.53: an order line among the chosen order's lines).
