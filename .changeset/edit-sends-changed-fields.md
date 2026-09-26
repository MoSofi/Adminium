---
'@adminium/widgets': patch
---

Saving a record's edit form sends only the fields that changed. It used to send every field the form showed, so saving one field wrote the whole row back as it stood when the form opened — a status another person changed meanwhile, a total a trigger updated, a column a job fills, all silently put back. A field left as it was is now neither sent nor checked, so a record kept from before a column became required can be saved without filling it; a field that a change on the form makes required (a person, once the event is marked away) is still checked. Values are compared as they would be sent, so a price the database returns as `12.50` is unchanged when it still reads `12.5`, and a date left alone can no longer shift by a day. Saving with nothing changed sends nothing. A new record still sends every field.
