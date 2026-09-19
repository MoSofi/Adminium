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
    "tryAgain": "Try again"
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
    "enable": "Enable actions",
    "lockedTitle": "Enable actions to let {name} do this",
    "noWrite": "Your role can look, draft and preview here, but not save.",
    "noWriteTitle": "Your role cannot do this here",
    "note": "{name} is read-only right now — it can look, draft and preview, but not save, send or create."
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
  }
} as const;
