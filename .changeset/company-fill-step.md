---
'@adminium/server': patch
'@adminium/meta': patch
'@adminium/dashboard': patch
---

Automation rules gain a step "Fill in the company", offered on a companies table while an add-on that finds companies is installed. It fills in only the empty details of the company the rule runs on, from the free registers you tick, by its company number or else its name and town. It never reads a website, never asks a paid service or a people search, and has its own daily budget of 50 look-ups on each register, so a form posted all night cannot spend your accounts. When it finds nothing, the run log says so.
