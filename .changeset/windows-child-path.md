---
'@adminium/server': patch
---

On Windows, the programs the server starts (an app's tests and build, package installs, git, the browser) get the program search path again, which Windows spells `Path` and they had lost, along with Windows' own settings they need to run (`SystemDrive`, `windir`, `ProgramFiles`, `ProgramData`, the processor count and kind, and the user's home drive and path).
