---
'@adminium/server': patch
'@adminium/widgets': patch
---

A desk asks for the limits of a page of shows at once: `capacity-counts?under=event_id&values=12,13,14` counts up to 50 values in one ask, each row naming the value it is under, instead of one request a show. A staff save may carry up to 1,000 rows below one record (was 200), so a message to a show's buyers goes out with an email each in one write; the public API's creates keep their 200.
