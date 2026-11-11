---
'@adminium/server': patch
---

Every secret the server takes out of its environment can now be given as a file: set `ADMINIUM_SECRET_FILE=/run/secrets/adminium_secret` instead of `ADMINIUM_SECRET`, and the same `_FILE` ending for `ADMINIUM_SETUP_TOKEN`, `ADMINIUM_ARCHIVE_KEY`, `ADMINIUM_OPERATOR_TOKEN`, `ADMINIUM_TRIAL_SMTP_URL`, every `ADMINIUM_AI_*` variable, `ADMINIUM_FIGMA_TOKEN` and the picture sites' keys. This is how Docker and Kubernetes secrets are handed over. The server reads the file at start and uses it exactly as if the value had been set in the variable, so the value is never in the environment the server was started with, which the operating system shows to code running as the same user. Adminium refuses to start, naming the variable, when both the variable and its `_FILE` are set, or the file is missing, unreadable, empty or larger than 64 KiB. Plain variables keep working as before.
