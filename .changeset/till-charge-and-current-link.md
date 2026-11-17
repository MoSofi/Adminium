---
'@adminium/server': patch
---

A reader charge as the till reads it now says the card's brand once it is paid (`brand`), and tells `processing` apart from `on_reader`. `POST /payments/links/current` answers a record's open test link whether or not a pay address is chosen (a test link opens on the host the person is on), and a live one on the server's own address when none is chosen, instead of nothing — so asking again no longer makes a new link each time.
