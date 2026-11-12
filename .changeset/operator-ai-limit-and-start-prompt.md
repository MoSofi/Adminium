---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/meta': patch
'@adminium/i18n': patch
---

A server's operator can now hold the AI they pay for to a hard limit. `ADMINIUM_AI_OPERATOR_BUDGET_TOKENS` is counted where every call to a model is made, for every feature on the operator's connection (the Designer, the page assistant, speech and pictures made with AI), and kept where no setting, import, export or archive can set it back; past it, a call is refused before it is made. `ADMINIUM_AI_OPERATOR_SCOPE=dashboard` holds a Designer turn on the operator's connection to dashboards where things take effect: nothing is written in a customer side, the phone app or a site template, an app that would reach more of the public than when the turn began is neither built nor applied, and the session is a dashboard one. Either ends the turn with a fixed card in the Designer, never the model's words: "Building customer-facing screens needs your own AI key." or "The AI included with this trial is used up.", with "Add an AI key" and, where the operator set an upgrade address, "Upgrade". The person's own key in Settings → AI is never held. With `ADMINIUM_AI_OPERATOR_ONLY=on`, a saved connection the operator refuses gives way to the operator's. The operator endpoint now reports the tokens spent. A start prompt (`ADMINIUM_DESIGNER_START_PROMPT_B64` or `_FILE`) now runs once, right after the first-run account step, as the first message of a new dashboard session, with every question it asks answered no.
