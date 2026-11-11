---
'@adminium/server': patch
'@adminium/meta': patch
---

Whether a server asks for the setup token is now decided when it starts, never by what the meta store holds. Before, `adminium dev` on this computer removed the token's record from a store, and an `adminium start` server on the same store then let anyone create the first account without a token; now `dev`, `design`, `try` and the desktop app leave the record alone, and a server that asks refuses every setup call when the record is missing instead of letting it through. After the wizard moves or adopts a meta store, the restarted server puts a token in the new store and prints it, where before a store with data but no account yet asked for nothing until the next restart.
