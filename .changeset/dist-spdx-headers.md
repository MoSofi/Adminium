---
'@adminium/server': patch
'@adminium/add-on-contracts': patch
'@adminium/i18n': patch
'@adminium/manifest': patch
'@adminium/ui': patch
---

Every built JavaScript file in the npm packages and the Docker image now starts with its `SPDX-License-Identifier: AGPL-3.0-only` line. The TypeScript compiler dropped the line from a file whose first statement it erases, such as an `import type`, so nearly 400 shipped files (223 of the CLI's own) had none. Each package's build now writes it back after the compiler, and CI and the image build check every built file.
