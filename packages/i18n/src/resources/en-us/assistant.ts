// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/en-US/assistant.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "actions": {
    "saved": "Saved"
  },
  "ask": {
    "continue": "Continue",
    "pick": "Pick one option in each group",
    "picked": "Picked: {labels}",
    "ready": "Ready",
    "waiting": "Waiting on you"
  },
  "audit": {
    "note": "Every action is logged to Audit Log"
  },
  "automation": {
    "action1": "Open in builder",
    "action2": "Save rule (switched off)",
    "blurb": "Knows this page: {rules, plural, one {# rule} other {# rules}} · {templates, plural, one {# live email template} other {# live email templates}} · {tables, plural, one {# readable table} other {# readable tables}}",
    "chip1": "Email the customer a thank-you when their order ships",
    "chip2": "Notify admins when a new customer is added",
    "chip3": "Every morning, flag orders that are past their required date",
    "confirm": {
      "body": "{name} will add “{title}” to Automation rules, switched off. Nothing runs until you switch it on.",
      "bodyOpen": "{name} will add “{title}” to Automation rules, switched off, and open it in the builder.",
      "button": "Save switched off",
      "title": "Save this rule?"
    },
    "echo": {
      "editor": "Saved switched off. Opening it in the builder.",
      "saved": "Saved to Automation rules, switched off."
    },
    "greeting": "I can see your automation rules, your live email templates and the tables your role can read.",
    "greetingSub": "Describe what should happen and when, and I will draft the rule. It is saved switched off until you turn it on.",
    "page": "Automation rules",
    "placeholder": "Describe the rule you need…",
    "readPage": "Automation rules · {rules, plural, one {# rule} other {# rules}} · {tables, plural, one {# readable table} other {# readable tables}}",
    "scopePrimary": "automations",
    "workTitle": "Drafted a new rule",
    "addedBy": "Added by {name}",
    "applied": "Applied to this rule. It is not saved yet.",
    "apply": "Apply to this rule",
    "handoff": "Open Email templates to draft one.",
    "handoffSub": "This conversation comes with you.",
    "handoffOpen": "Open Email templates",
    "waiting": "Waiting for a template",
    "savedOff": "Will be saved switched off",
    "notSaved": "Nothing is saved until you save the rule.",
    "workTitleChange": "Changed the open rule"
  },
  "button": "Ask {name}",
  "buttonTitle": "Ask {name} about this page",
  "close": "Close",
  "composer": {
    "send": "Send",
    "working": "Working…"
  },
  "confirm": {
    "cancel": "Cancel"
  },
  "details": {
    "checks": "Checks",
    "figures": "Figures",
    "figuresValue": "{blocks, plural, one {# block with figures} other {# blocks with figures}}",
    "format": "Format",
    "formatEmailValue": "Adminium email · {blocks, plural, one {# block} other {# blocks}}",
    "formatInvoiceValue": "Adminium invoice template · {sections, plural, one {# section on} other {# sections on}}",
    "lines": "Lines",
    "linesValue": "{lines, plural, one {# line} other {# lines}} · {total}",
    "noChecks": "none declared",
    "none": "none",
    "notPublished": "Not published",
    "notPublishedValue": "saved as a draft",
    "notTouched": "Not touched",
    "notTouchedValue": "no customer rows are changed, no email is sent",
    "record": "Record",
    "recordValue": "invoice document · 1 new row · status draft",
    "sources": "Sources read",
    "sourcesChosen": "Sources chosen",
    "taxLines": "Tax lines",
    "taxLinesValue": "{rate}%",
    "tokens": "Tokens",
    "tokensValue": "{in} in · {out} out",
    "variables": "Variables"
  },
  "diff": {
    "adds": "+{n}",
    "against": "Compared with {name}",
    "dels": "−{n}",
    "new": "New {kind} — fields it will write",
    "truncated": "The comparison was cut — open the draft to see the rest."
  },
  "draft": {
    "account": "Account",
    "draft": "draft",
    "due": "Due",
    "issued": "Issued",
    "lineCount": "{n, plural, one {# line} other {# lines}}",
    "lines": "Pulled line items",
    "notTouched": "No customer rows are changed, and no email is sent.",
    "status": "Status",
    "template": "Template",
    "total": "Total"
  },
  "echo": {
    "applied": "Drafted into the editor — review the highlighted blocks."
  },
  "email": {
    "action1": "Send test email",
    "action2": "Open in editor",
    "action3": "Save template",
    "blurb": "Knows this page: {templates, plural, one {# template} other {# templates}} · {campaigns, plural, one {# campaign} other {# campaigns}} · branding",
    "chip1": "Draft a reminder for an unpaid invoice",
    "chip2": "Create an appointment reminder, 3 days out",
    "chip3": "Localise the Welcome template into German",
    "confirm": {
      "body": "{name} will create “{title}” as a draft in Email templates. Nothing is sent to customers until you set it live.",
      "bodyOpen": "{name} will create “{title}” as a draft in Email templates and open it in the editor.",
      "button": "Save as draft",
      "title": "Save as a new template?"
    },
    "echo": {
      "editor": "Saved as a draft template. Opening it in the editor.",
      "sample": "Rendered a sample for {record}.",
      "saved": "Saved as a draft template.",
      "test": "Test sent to {email} with sample data."
    },
    "greeting": "I can see your email templates — the block format, your branding, and the variables each template can use.",
    "greetingSub": "Describe the email you need and I will draft it in Adminium’s template format, then you can test-send it before saving.",
    "language": {
      "saved": "Added the {locale} variation as a draft."
    },
    "page": "Email templates",
    "placeholder": "Describe the template you need…",
    "readPage": "Email templates · {templates, plural, one {# template} other {# templates}} · branding",
    "scopePrimary": "email_templates",
    "workTitle": "Drafted a new email template"
  },
  "error": {
    "generic": "That did not work. Try asking again.",
    "smtp": "Email is not configured yet. Open Email settings to add a relay.",
    "tooLong": "This conversation is too long for the model — start a new session.",
    "tryAgain": "Try again",
    "modelFormat": "This model does not answer in the way {name} needs. Choose another model in Settings → AI.",
    "modelFormatAsk": "This model does not answer in the way {name} needs. Ask an administrator to choose another model.",
    "setup": "This page could not be read just now. Try asking again.",
    "busy": "Your last question is still being worked on. Wait for it, or stop it first.",
    "budget": "This stopped part way: today’s allowance is used up."
  },
  "invoiceTemplate": {
    "action1": "Preview another sample",
    "action2": "Open in editor",
    "action3": "Save template",
    "blurb": "Knows this page: {templates, plural, one {# template} other {# templates}} · numbering {pattern} · {invoices, plural, one {# invoice} other {# invoices}}",
    "chip1": "Create a template for EU clients with reverse-charge VAT",
    "chip2": "Add a late-fee notice section to one of my templates",
    "chip3": "Match one of my templates to our branding colours",
    "confirm": {
      "body": "{name} will add “{title}” to Invoice templates as a draft. Existing invoices are untouched.",
      "bodyOpen": "{name} will add “{title}” to Invoice templates as a draft and open it in the editor.",
      "button": "Save as draft",
      "title": "Save as a new invoice template?"
    },
    "echo": {
      "editor": "Saved as a draft. Opening it in the editor.",
      "noSample": "There is no invoice here to draw a sample from.",
      "sample": "Rendered a sample for {record}.",
      "saved": "Saved as a draft template.",
      "test": "Test sent to {email}."
    },
    "greeting": "I can see your invoice templates, your numbering scheme and the tax lines your templates use.",
    "greetingSub": "Tell me the template you need and I will build it to Adminium’s invoice format, then render a sample with real account data.",
    "language": {
      "saved": "Added the {locale} variation as a draft."
    },
    "page": "Invoice templates",
    "placeholder": "Describe the invoice template you need…",
    "readPage": "Invoice templates · {templates, plural, one {# template} other {# templates}} · numbering {pattern}",
    "scopePrimary": "invoice_templates",
    "workTitle": "Built a new invoice template"
  },
  "invoices": {
    "action1": "Open in editor",
    "action2": "Create draft invoice",
    "blurb": "Knows this page: {invoices, plural, one {# invoice} other {# invoices}} · {templates, plural, one {# template} other {# templates}} · your role can {write, select, true {write} other {read}}",
    "chip1": "Create an invoice for a customer for last month",
    "chip2": "Draft an invoice from last month’s unbilled entries",
    "chip3": "List the invoices that are past their due date",
    "confirm": {
      "body": "{name} will add this invoice to Invoices as a draft. No customer rows are changed until you send it.",
      "bodyOpen": "{name} will add this invoice to Invoices as a draft and open it in the editor.",
      "button": "Create draft",
      "title": "Create this draft invoice?"
    },
    "echo": {
      "editor": "Created as a draft. Opening it in the invoice editor.",
      "sample": "Rendered a sample for {record}.",
      "saved": "Created as a draft. It is at the top of the table.",
      "test": "Test sent to {email}."
    },
    "greeting": "I can see the invoice table, your templates, and the places invoice data can come from.",
    "greetingSub": "Tell me who to bill and I will ask which template to use and where to pull the lines from before drafting anything.",
    "language": {
      "saved": "Added the {locale} variation as a draft."
    },
    "page": "Invoices",
    "placeholder": "e.g. create an invoice for a customer for last month…",
    "readPage": "Invoices · {invoices, plural, one {# record} other {# records}} · your role can {write, select, true {write} other {read}}",
    "scopePrimary": "invoices",
    "workTitle": "Drafted an invoice"
  },
  "readOnly": {
    "noWrite": "Your role can look, draft and preview here, but not save.",
    "noWriteTitle": "Your role cannot do this here",
    "switchedOff": "Saving is switched off for {name} in this workspace.",
    "openSettings": "Open settings",
    "switchedOffTitle": "Saving is switched off for {name} in this workspace"
  },
  "report": {
    "action1": "Run full preview",
    "action2": "Open in builder",
    "action3": "Save report",
    "blurb": "Knows this page: {reports, plural, one {# report} other {# reports}} · {connection} · {tables, plural, one {# readable table} other {# readable tables}}",
    "chip1": "Which customers take the most support time? You pick the sources",
    "chip2": "Build a retention report from customers and orders",
    "chip3": "Create a monthly operational review template",
    "confirm": {
      "body": "{name} will add “{title}” to Reports. It runs on demand — no schedule until you set one.",
      "bodyOpen": "{name} will add “{title}” to Reports and open it in the builder.",
      "button": "Save report",
      "title": "Save this report?"
    },
    "echo": {
      "editor": "Saved to Reports. Opening it in the builder.",
      "resampled": "Re-ran the sources — {n, plural, one {# figure} other {# figures}} updated.",
      "resampledRefused": "Re-ran the sources — {n, plural, one {# figure} other {# figures}} updated; {refused, plural, one {# source} other {# sources}} could not be read.",
      "sample": "Ran the full query for {record}.",
      "saved": "Saved to Reports. Add a schedule from the report header.",
      "test": "Test sent to {email}."
    },
    "greeting": "I can see your report library and the {tables, plural, one {# table} other {# tables}} your role can read in {connection}.",
    "greetingSub": "Name the tables and layout, or just tell me the question and I will choose the sources and show you why.",
    "language": {
      "saved": "Added the {locale} variation as a draft."
    },
    "page": "Report builder",
    "placeholder": "Ask for a report, or name the tables to use…",
    "readPage": "Report builder · {reports, plural, one {# report} other {# reports}} · {tables, plural, one {# readable table} other {# readable tables}}",
    "scopePrimary": "reports",
    "workTitle": "Built the report"
  },
  "scope": {
    "connection": "{connection} · {n, plural, one {# table} other {# tables}}",
    "extra": "+{n}",
    "title": "Data this session can read"
  },
  "steps": {
    "done": "done",
    "failed": "failed",
    "note": {
      "ready": "ready",
      "warning": "{n, plural, one {# warning} other {# warnings}}"
    },
    "readPage": "Read this page",
    "step": "step {n}",
    "working": "Working on it"
  },
  "tabs": {
    "details": "Details",
    "diff": "Diff",
    "preview": "Preview"
  },
  "tokens": {
    "hint": "~{n} tokens",
    "title": "Tokens used this session",
    "value": "{n} tokens"
  },
  "try": "Try",
  "unavailable": {
    "askAdmin": "Ask an administrator to set one up.",
    "forbidden": "You do not have permission to use {name}.",
    "network": "Outbound network features are off on this instance.",
    "noProvider": "No AI provider is configured yet.",
    "settings": "Open Settings → AI"
  },
  "budget": {
    "usedUp": "Today’s allowance is used up. It starts again at {time}."
  },
  "data": {
    "page": "This page",
    "blurb": "Knows this page: {table} · {tables, plural, one {# readable table} other {# readable tables}}",
    "blurbNoTable": "Knows this page · {tables, plural, one {# readable table} other {# readable tables}}",
    "greeting": "I can read what this page shows, and the other tables your role can read.",
    "greetingSub": "Ask about the rows here. I answer in words, with the figures, and say which tables I read.",
    "placeholder": "Ask about this data…",
    "chip1": "How many rows are shown here?",
    "chip2": "Summarise what this page shows",
    "chip3": "What changed most recently?",
    "workTitle": "Read the data",
    "scopePrimary": "this page",
    "readPage": "{page} · {table} · {tables, plural, one {# readable table} other {# readable tables}}",
    "readPageNoTable": "{tables, plural, one {# readable table} other {# readable tables}}",
    "confirm": {
      "title": "Nothing to save here",
      "body": "{name} drafts nothing on this page.",
      "button": "Close"
    }
  },
  "general": {
    "page": "This workspace",
    "blurb": "Knows this workspace · {tables, plural, one {# readable table} other {# readable tables}}",
    "greeting": "I can read the tables your role can read, and tell you where things are done.",
    "greetingSub": "Ask about your data, or where to change something. I answer in words and link to the place.",
    "placeholder": "Ask about this workspace…",
    "chip1": "Where do I invite a colleague?",
    "chip2": "What can I see in this workspace?",
    "chip3": "Which table has the most rows?",
    "workTitle": "Looked it up",
    "scopePrimary": "workspace",
    "readPage": "{tables, plural, one {# readable table} other {# readable tables}}"
  },
  "answer": {
    "from": "From:",
    "part": "Read {returned, number} of {total, number} rows of {table}.",
    "nothingRead": "Nothing was read for this answer.",
    "readAgain": "Read again",
    "readAgainAsk": "{question} Read the data to answer.",
    "forgot": "{name} no longer has the first {count, plural, one {message} other {# messages}} in mind."
  },
  "suggestion": {
    "open": "Open",
    "openLabel": "Open {addOn} in Add-ons",
    "askAdmin": "Ask an administrator to install this."
  },
  "panel": {
    "loading": "Loading conversation…",
    "recordOpen": "{page} · {record} open",
    "rowsShown": "{page} · {rows, plural, one {# row shown} other {# rows shown}}",
    "new": "New conversation",
    "earlier": "{count, plural, one {# earlier message is} other {# earlier messages are}} not shown.",
    "onPage": "on {page}",
    "closedElsewhere": "This conversation was closed in another window.",
    "stillWorking": "{name} is still working on your last question.",
    "stop": "Stop",
    "pageDialog": "Close what is open on the page to use {name}.",
    "aged": "Your earlier conversation was closed because of its age."
  },
  "chip": {
    "selected": "{count, plural, one {# selected} other {# selected}}",
    "record": "The open record",
    "filtered": "{rows, plural, one {# filtered row} other {# filtered rows}}",
    "filteredUnknown": "Filtered rows",
    "remove": "Ask without “{label}”"
  },
  "parked": {
    "madeOn": "Made on {page}.",
    "open": "Open {page} to use this draft",
    "deleted": "This draft’s document was deleted."
  },
  "proposal": {
    "checking": {
      "title": "A change to confirm",
      "line": "Checking what would change…"
    },
    "badge": {
      "replaced": "Replaced",
      "expired": "Expired",
      "cancelled": "Cancelled",
      "parked": "Parked"
    },
    "replaced": "Something else was asked after this. Nothing was changed.",
    "expired": "This proposal is 30 minutes old. Ask again.",
    "overCap": "That is {count} changes; at most {cap} can be confirmed at once. Use the page’s own bulk tools for more.",
    "applying": "Working…",
    "undone": "Undone. Everything is as it was.",
    "undonePart": "{count, plural, one {# change was} other {# changes were}} taken back.",
    "undoneRest": "The rest stay as changed.",
    "interrupted": "This stopped part way.",
    "group": {
      "done": "Done",
      "check": "Check this one",
      "checkLine": "The save was cut off. It may or may not have changed.",
      "notTried": "Not attempted",
      "shared": "{field} {arrow} {value} on {count, plural, one {# row} other {# rows}}"
    },
    "openHome": "Open {page}",
    "notTried": "Not attempted: too many requests at once. Ask again in a minute.",
    "again": "Propose the rest again",
    "againAsk": "Propose again the changes that were not made:\n{rows}",
    "undo": "Undo",
    "undoSome": "Undo {count} of {total}",
    "undoPassed": "The time to undo has passed.",
    "noUndo": "This cannot be undone from here.",
    "noUndoSome": "{count, plural, one {# change} other {# changes}} cannot be undone from here.",
    "notChanged": "{count, plural, one {This one was} other {These # were}} not changed:",
    "cancelled": "Nothing was changed.",
    "parked": "Open {page} to use this.",
    "someRefused": "{refused} of {count, plural, one {# change} other {# changes}} cannot be made.",
    "changedSince": "This changed since you were shown it. Look again before confirming.",
    "fix": "Ask {name} to fix this",
    "fixAsk": "Some of that cannot be done. Propose it again without these:\n{reasons}",
    "send": {
      "template": "Template",
      "subject": "Subject",
      "to": "To",
      "roles": "everyone with the role {roles} ({count, plural, one {# person} other {# people}})",
      "open": "Open template",
      "skipped": "{count, plural, one {# person has opted out and gets nothing.} other {# people have opted out and get nothing.}}"
    },
    "more": "{count} more. Open large to see them all.",
    "irreversible": "This cannot be undone.",
    "chosen": "{picked} of {count} chosen",
    "large": "Open large",
    "doc": {
      "email": "email template",
      "report": "report",
      "rule": "rule",
      "invoice": "invoice",
      "invoiceTemplate": "invoice template"
    },
    "ask": {
      "change": "Change {count, plural, one {# row} other {# rows}}",
      "add": "Add {count, plural, one {# row} other {# rows}}",
      "delete": "Delete {count, plural, one {# row} other {# rows}}",
      "save": "Save as a new {what}",
      "saveOver": "Save over “{name}”",
      "deleteDoc": "Delete “{name}”",
      "deleteDocs": "Delete {count, plural, one {# document} other {# documents}}",
      "send": "Send to {count, plural, one {# person} other {# people}}",
      "mixed": "Make {count, plural, one {# change} other {# changes}}"
    },
    "done": {
      "changePart": "Changed {done} of {count, plural, one {# row} other {# rows}}.",
      "part": "{done} of {count, plural, one {# change} other {# changes}} made.",
      "change": "Changed {count, plural, one {# row} other {# rows}}.",
      "add": "Added {count, plural, one {# row} other {# rows}}.",
      "delete": "Deleted {count, plural, one {# row} other {# rows}}.",
      "save": "Saved.",
      "deleteDoc": "Deleted {count, plural, one {# document} other {# documents}}.",
      "send": "Sending to {count, plural, one {# person} other {# people}}.",
      "mixed": "{count, plural, one {# change} other {# changes}} made."
    },
    "refused": {
      "generic": "The server refused this.",
      "switchedOff": "This is switched off for {name} in this workspace.",
      "notThisTable": "Only the table of the page this was asked on can be changed from here.",
      "notData": "That is not a table of your data.",
      "noChange": "The row already holds these values.",
      "unsafeKey": "That id cannot be used.",
      "notFound": "This is no longer there.",
      "notOffered": "That cannot be done from here.",
      "builtIn": "A built-in mail is changed on its own screen.",
      "notCampaign": "Only a campaign can be sent to people.",
      "noRecipients": "Nobody would get this mail.",
      "notLive": "A draft is switched on by a person before it can be sent."
    },
    "row": {
      "untitled": "Untitled",
      "new": "New row",
      "switchesOff": "Saved switched off: switch it on again when you have looked at it."
    },
    "delete": {
      "reference": "{count} in {table}",
      "references": "Other rows refer to this: {list}. They go or change with it, as on the page’s own delete."
    },
    "noneAble": "None of this can be done",
    "checkAgain": "Check again",
    "undoFailed": "{count, plural, one {# change} other {# changes}} could not be taken back. Try again.",
    "parkedNoHome": "Go back to {page}, where this was asked, to use it."
  },
  "leftOut": {
    "title": "What I left out, and why",
    "nothing": "Nothing."
  }
} as const;
