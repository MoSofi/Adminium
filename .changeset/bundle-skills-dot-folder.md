---
'@adminium/server': patch
---

Packing the server from a checkout inside a dot folder (such as `.claude/worktrees/…`) now copies the Designer's skills into the package. Before, the copy step dropped every file because the checkout's own path held a dot folder, yet it still reported success, so such a package shipped with no `skills/`. The step now also fails if the copy holds no `adminium/SKILL.md`.
