---
'@adminium/dashboard': patch
'@adminium/i18n': patch
'@adminium/meta': patch
'@adminium/desktop': patch
---

The desktop first-run wizard's words no longer ride in every user's first load. Its 88 messages moved inside `common` from `desktop.setup.*` to the deferred `onboarding.desktopSetup.*` group, which loads with the wizard (the wizard waits for it before it draws, so it never flashes English). The entry chunk drops by about 1.6 KiB gz. Meta migration `0072_desktop_setup_words` re-files any rewording an admin saved under the old keys; the desktop app's cloud-sync warning names the new key.
