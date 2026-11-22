---
"@adminium/add-on-contracts": patch
---

`shipping-carrier@1` can now describe a real carrier, with every new member optional: contact details, customs with EU codes, documents, handover, test bookings, refund states, a credential check and a look-up after an unanswered purchase. A carrier may leave out an arrival date, a collection window or a scan's place rather than invent one. `classifyBookFailure` treats a failed purchase as unknown unless the carrier clearly refused it, and the conformance suite accepts a carrier whose every purchase is new.
