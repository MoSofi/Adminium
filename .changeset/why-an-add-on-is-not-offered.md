---
'@adminium/server': patch
---

An app's install check now says why an add-on it names cannot be had: the add-on catalogue is switched off, it could not be read, or it was read and does not list the add-on. Before, all three read "the add-on catalogue is off or has nothing for it … or switch the catalogue on", which sent an owner whose catalogue was on to a switch that changed nothing. An add-on no catalogue names is said by its key in quotes.
