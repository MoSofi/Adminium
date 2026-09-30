---
'@adminium/server': patch
---

Two screens changing one row no longer overwrite each other unseen. A `PATCH` may send `seen`: up to 8 plain columns as the form loaded them, and the change is made only while each still holds that value, or refused `409` `ROW_CHANGED` naming the column (two door phones ticking one party's arrivals both wrote `arrived: 2`). A bulk update may send `from`, the state every row was seen in: a row that moved on is refused by id and nothing is written, so a box office cancels a show's live orders in a few writes, one per state, instead of one request per order against the per-person rate limit.
