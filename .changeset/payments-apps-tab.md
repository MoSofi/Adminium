---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

Payments has a new Apps tab: each installed app that can ask customers to pay, with one "Can take payments" switch per app. An app's payments arrive switched off; switching them on asks first and says what customers will be asked, and switching them off needs no confirm. Someone who manages payments may switch an app on whatever rights they hold on the app's own tables (the install already checked the app's set-up). Until a payment service is connected, the switch waits and the row says to connect one first; someone who may only view sees the state and no switch. In "What can be paid" an app's payable table reads "From {app}", with no switch and no Stop: it changes with the app's update and goes with its uninstall, and the server refuses a change or removal of it by hand. The install review and the app's page list "Switch on payments for this app in Payments" until it is done. `GET /api/v1/payments/apps` and `POST /api/v1/payments/apps/switch` are new, and Payments opens on any tab from `?tab=`.
