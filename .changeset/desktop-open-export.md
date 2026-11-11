---
'@adminium/desktop': patch
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

The desktop app opens an "Export everything" file: File → Open a project… picks the file, and Start makes a NEW project from it (an open project is closed first; nothing goes into it). The engine reads and checks the file first (`adminium import-zip --dry-run --json`), the person names the project and its folder, picks the Super Admin who signs in first and types their new password twice; the import runs through the same `import-zip` with the export's rules, the password on standard input. A whole-server archive is refused with the command that restores one (`adminium archive restore`), and a changed or unsafe file is refused with nothing made. A connection that came without its connection string now shows as Draft in Studio, as a new one without a string does. `adminium import-zip --json` prints the outcome or the refusal as one line of JSON. Studio's Export everything page says "Choose Open a project and pick the file." for the desktop app again.
