---
'@adminium/server': patch
---

A host already mapped to an app's side or the add-on pages is never the address in email links now. The address is no longer learnt from a settings admin's request on such a host, and "Address in email links" refuses a new address there, naming the mapping that holds it. A mapping of the public address's host saved before this release is kept: saving the domain map (or an app's own domains) refuses only a new mapping of that host, or one pointed elsewhere, and the refusal now says the way out ("Map another host, or change Address in email links first").
