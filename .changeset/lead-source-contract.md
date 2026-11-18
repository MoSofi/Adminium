---
'@adminium/add-on-contracts': patch
---

A new contract, `lead-source@1`, for add-ons that find companies and the people at them: check the owner's key, find companies by activity and place, fill in one company by its number or its name and town, pick facts from a page Adminium read, and find the people at a company's domain. Every answer is checked against a fixed shape (every text bounded, every link https, at most 50 companies or people), and anything else is read as the source being unavailable. The add-on block gains `sources`, the places such an add-on reaches (each with its own hosts, inside `network.allow`, and its own secret key), and `leads`, the add-on's two tables for what was found. A demo source with made-up companies and a conformance suite that every adapter runs are at `@adminium/add-on-contracts/testing`.
