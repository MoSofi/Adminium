---
'@adminium/manifest': patch
---

An add-on's found people table (`addOn.leads.foundPeople`) now has an `email` column (text, at least 320 wide, nullable): the address a person was found with, where the mail that tells them goes. Adminium writes it with the row and erases it with the row.
