---
'@adminium/server': patch
'@adminium/i18n': patch
---

**Settings → Translations keeps every accessible name it can find.** The server
refuses to save an empty translation for a string that is a control's accessible
name, such as an icon-only button's label, a field's label or a tooltip. The
list of those strings had fallen behind the screens. It held 1,294 keys and
missed, among others, the app install wizard's labels and the onboarding
wizard's show-password toggle, so those could be blanked, leaving a control with
no name.

The list is now built by parsing the source instead of matching two patterns, so
it also finds a key that reaches a name through a condition, a `??` fallback, a
translator imported under another name, or a field descriptor. It holds 2,402
keys. Those strings can still be translated. They just cannot be left empty.
