---
'@adminium/public-client': patch
'@adminium/server': patch
---

A QR code can carry a page's address: `qrMatrix` and `qrSvg` in `@adminium/public-client/qr` (and the server's QR functions) take `{ page: true }`, which allows up to 256 bytes (`QR_PAGE_MAX_BYTES`) for a form's or a page's link. A ticket's code stays held to 64 bytes without it. Both sides are held to one shared fixture of page addresses.
