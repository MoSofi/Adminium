---
'@adminium/add-on-contracts': patch
---

`describeShippingCarrier` names the inbound direction (31 O4): quote is
direction-symmetric — the same route reversed still quotes — and the refusal is
end-symmetric, so a carrier that would refuse an address as a recipient refuses
it as a sender. No interface member changes shape; a return is the same
contract with the route reversed, and the suite now says so executably.
