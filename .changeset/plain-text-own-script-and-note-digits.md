---
'@adminium/server': patch
'@adminium/manifest': patch
---

Plain text a guest types now takes the punctuation a sentence is written with in their own script: `! ? : ; "`, `¿ ¡ « » „ “ ”`, the CJK `，。、！？：；「」『』・` and the Arabic `، ؛ ؟`. A diner's note like "少放辣，切六块" or "بدون بصل، من فضلك" was refused before. A column in a `plainText` list may now be given as `{ "column": "note", "digits": 4, "max": 140 }`: up to 4 digits in the whole value ("2 without onions", "table 12", never a phone number) and up to 200 characters instead of 80. A name keeps no digits. The link check reads the ideographic full stop as a dot (`evil。com`) and digits as part of an address (`shop1.com`), and `www.` is found in fullwidth letters too. The manifest validator now warns when a plain-text column's `maxLength` is longer than its plain text takes, since a guest who types to the end of the field is refused.
