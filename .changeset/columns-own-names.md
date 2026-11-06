---
'@adminium/manifest': patch
'@adminium/server': patch
'@adminium/docs': patch
---

An app saved from your own database keeps its columns' own names, such as `orderDate`, `Order Total` or `driver-name`. The new server creates them under the same names, and pages, views, roles' column limits, rules, public access and rows all name them the same way. A name the file cannot hold, such as one with a dot, is a question in Check. Apps from adminium.dev and add-ons keep snake_case names. Installing such a file needs Adminium 0.3.49 or newer.
