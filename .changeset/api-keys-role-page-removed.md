---
'@adminium/dashboard': patch
'@adminium/i18n': patch
'@adminium/docs': patch
---

**The old API keys page at `/api-keys` is gone.** Role-bound keys (`adm_sk_…`) still work and can
still be created and revoked through `/api/v1/api-keys`. There is no page for them now.
_Guides → Public API → Endpoints and keys_ shows how to create one with `curl`. The sidebar no
longer has an "API keys" row. Keys for your own pages are under Workspace settings → API keys.
