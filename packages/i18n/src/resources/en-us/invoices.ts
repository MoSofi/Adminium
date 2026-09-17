// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/en-US/invoices.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "add": {
    "allOn": "Every standard block is already on this invoice.",
    "custom": "Build your own",
    "standard": "Standard blocks",
    "subtitle": "Build your own, or switch on one of the standard blocks.",
    "title": "Add a section"
  },
  "canvas": {
    "addSection": "Add section",
    "approval": {
      "approved": "Approved",
      "pending": "Pending",
      "rejected": "Rejected",
      "title": "Approval"
    },
    "attachments": "Attachments",
    "blocks": {
      "parties": "From & Invoice to",
      "paynotes": "Payment & notes"
    },
    "brandName": "Brand name",
    "brandingHint": "Branding · click to edit",
    "contact": "Questions? Contact us",
    "custom": {
      "addRow": "Add row",
      "body": "Section body",
      "caption": "Caption",
      "clearImage": "Remove image",
      "clearSlot": "Remove",
      "clearSlotOf": "Remove image {n}",
      "remove": "Remove section",
      "removeOf": "Remove section: {title}",
      "removeRow": "Remove row",
      "removeRowOf": "Remove row {n}",
      "rowLabel": "Label of row {n}",
      "rowValue": "Value of row {n}",
      "titleLabel": "Section title",
      "upload": "Click to upload an image",
      "uploadSlot": "Upload image {n}"
    },
    "customerName": "Customer name",
    "dateSigned": "Date signed",
    "delivery": {
      "title": "Delivery timeline"
    },
    "discount": {
      "title": "Discount codes"
    },
    "due": "Due",
    "from": "From",
    "insertAbove": "Add a section above {label}",
    "insertHere": "Add a section here",
    "invoiceTo": "Invoice to",
    "issued": "Issued",
    "items": {
      "add": "Add line item",
      "amount": "Amount",
      "description": "Description",
      "descriptionOf": "Description of line {n}",
      "qty": "Qty",
      "qtyOf": "Quantity of line {n}",
      "rate": "Rate",
      "rateOf": "Rate of line {n}",
      "remove": "Remove line item: {name}",
      "reorder": "Drag to reorder",
      "reorderOf": "Drag to reorder: {name}",
      "row": "Line item {n}"
    },
    "latefees": {
      "sentence": "A late fee of {rate}% per month applies to balances unpaid more than {days} days past the due date.",
      "title": "Late payment fee"
    },
    "legal": "Legal",
    "lines": {
      "customer": "Customer line {n}",
      "from": "From line {n}",
      "payment": "Payment line {n}",
      "ship": "Shipping line {n}"
    },
    "loyalty": {
      "balance": "{balance} pts · {level}",
      "title": "Loyalty balance"
    },
    "multicurrency": {
      "note": "Converted from {total} at indicative rates.",
      "title": "Also payable in"
    },
    "notes": "Notes",
    "payhistory": {
      "title": "Payment history"
    },
    "payment": "Payment",
    "poNumber": "PO number",
    "poTerms": "Purchase order terms",
    "qr": {
      "due": "Amount due · {total}",
      "title": "Pay by QR"
    },
    "recurring": {
      "next": "Next on {next} · {count}",
      "title": "Recurring — {freq}"
    },
    "refund": "Refund policy",
    "reorderSection": "Drag to reorder section",
    "reorderSectionOf": "Drag to reorder section: {label}",
    "select": "Edit {label}",
    "shipName": "Shipping name",
    "shipTo": "Ship to",
    "sigName": "Signer name",
    "sigTitle": "Signer title",
    "signature": "Signature",
    "taxbreak": {
      "title": "Tax breakdown"
    },
    "terms": "Terms",
    "termsAccepted": "Terms accepted",
    "termsLabel": "Terms label",
    "totals": {
      "discount": "Discount ({rate})",
      "subtotal": "Subtotal",
      "tax": "Tax ({rate})",
      "total": "Total"
    }
  },
  "card": {
    "delete": "Delete",
    "duplicate": "Duplicate",
    "edit": "Edit",
    "rename": "Rename",
    "renameLabel": "New name",
    "total": "TOTAL"
  },
  "custom": {
    "gallery": {
      "hint": "Two or three images side by side",
      "label": "Image row"
    },
    "image": {
      "hint": "Upload a photo, drawing or certificate",
      "label": "Image block"
    },
    "kv": {
      "hint": "Label / value pairs",
      "label": "Detail rows"
    },
    "text": {
      "hint": "Your own copy — notes, scope, conditions",
      "label": "Text section"
    }
  },
  "delete": {
    "body": {
      "invoice": "This can’t be undone. The invoice will be permanently removed.",
      "template": "This can’t be undone. The template will be permanently removed."
    },
    "confirm": "Delete",
    "title": "Delete {name}?"
  },
  "editor": {
    "delete": "Delete",
    "discard": {
      "body": "Your edits to {name} will be lost.",
      "confirm": "Discard",
      "keep": "Keep editing",
      "title": "Discard unsaved changes?"
    },
    "duplicate": "Duplicate",
    "images": "Images",
    "kind": {
      "invoice": "Invoice",
      "template": "Template"
    },
    "loadFailed": "Couldn’t load this document",
    "nameLabel": "Name",
    "redo": "Redo",
    "saveFailed": "Could not save",
    "saveInvoice": "Save invoice",
    "saveState": {
      "dirty": "Unsaved changes",
      "error": "Couldn’t save",
      "saved": "All changes saved",
      "saving": "Saving…"
    },
    "saveTemplate": "Save template",
    "sendInvoice": "Send invoice",
    "shortcutSave": "Save the document",
    "undo": "Undo"
  },
  "empty": {
    "invoices": {
      "body": "Build your first invoice from a template or a blank canvas.",
      "title": "No invoices yet"
    },
    "noMatch": {
      "body": "Try a different search term.",
      "invoices": "No invoices match",
      "templates": "No templates match"
    },
    "templates": {
      "body": "Create a reusable invoice template your team can build from.",
      "title": "No templates yet"
    }
  },
  "inspector": {
    "addLine": "Add line",
    "approval": {
      "name": "Approver name",
      "status": {
        "approved": "Approved",
        "pending": "Pending",
        "rejected": "Rejected"
      },
      "statusLabel": "Status",
      "title": "Role / title"
    },
    "attachments": {
      "add": "Add file",
      "files": "Files",
      "name": "File {n} name",
      "removeRow": "Remove file {n}",
      "seedName": "New file.pdf",
      "size": "File {n} size"
    },
    "branding": {
      "accentHintAfter": "section.",
      "accentHintBefore": "Change the accent colour under the",
      "accentHintBold": "title",
      "brandName": "Brand name",
      "logoImage": "Logo image",
      "logoMark": "Logo mark",
      "logoNoteAfter": "in the toolbar.",
      "logoNoteBefore": "An uploaded logo replaces the mark above. All fixed images live under",
      "logoNoteBold": "Images",
      "removeLogo": "Remove",
      "uploadLogo": "Upload logo"
    },
    "contact": {
      "email": "Email",
      "name": "Contact name",
      "phone": "Phone"
    },
    "custom": {
      "addRow": "Add row",
      "body": "Body copy",
      "caption": "Caption",
      "galleryHint": "Click each slot on the invoice to upload an image.",
      "height": "Height",
      "image": "Image",
      "remove": "Remove section",
      "title": "Section title",
      "upload": "Upload / replace"
    },
    "customer": {
      "addressContact": "Address & contact",
      "clientName": "Client name"
    },
    "delivery": {
      "add": "Add step",
      "cycle": "Step {n} status: {status}",
      "label": "Step {n}",
      "note": "Tap the status to cycle Pending → In progress → Done.",
      "removeRow": "Remove step {n}",
      "seedLabel": "New step",
      "status": {
        "current": "In progress",
        "done": "Done",
        "todo": "Pending"
      },
      "steps": "Steps"
    },
    "discount": {
      "add": "Add code",
      "amount": "Code {n} amount",
      "code": "Code {n}",
      "codePlaceholder": "CODE",
      "codes": "Discount codes",
      "label": "Code {n} description",
      "labelPlaceholder": "Description",
      "removeRow": "Remove code {n}",
      "seedLabel": "New discount"
    },
    "fallback": {
      "title": "Edit"
    },
    "from": {
      "companyDetails": "Company details"
    },
    "images": {
      "addSection": "Add an image section",
      "background": "Background",
      "backgroundHint": "Watermark behind the invoice",
      "intro": "Fixed images that travel with the invoice. Upload once and every document built from this template keeps them.",
      "logo": "Logo",
      "logoHint": "Replaces the logo mark",
      "qr": "QR code",
      "qrHint": "Shown in the payment QR block",
      "remove": "Remove",
      "replace": "Replace",
      "signature": "Signature",
      "signatureHint": "Scanned signature image",
      "stamp": "Stamp / seal",
      "stampHint": "Paid or approval stamp",
      "upload": "Upload",
      "uploadSlot": "Upload {label}"
    },
    "items": {
      "add": "Add line item",
      "count": "Line items",
      "hint": "Edit any cell directly on the invoice, or drag the handle to reorder.",
      "subtotal": "Subtotal"
    },
    "latefees": {
      "grace": "Grace period",
      "graceUnit": "days",
      "rate": "Late fee rate",
      "rateUnit": "% per month"
    },
    "legal": {
      "footer": "Legal footer"
    },
    "line": "{label} {n}",
    "loyalty": {
      "balance": "Points balance",
      "earned": "Points earned",
      "level": "Level"
    },
    "meta": {
      "due": "Due date",
      "issued": "Issue date",
      "number": "Invoice number",
      "poNumber": "PO number",
      "terms": "Payment terms"
    },
    "multicurrency": {
      "add": "Add currency",
      "code": "Currency {n} code",
      "note": "Rate is multiplied by the invoice total. Code, symbol, then rate.",
      "rate": "Currency {n} rate",
      "rates": "Currencies & rates",
      "removeRow": "Remove currency {n}",
      "symbol": "Currency {n} symbol"
    },
    "notes": {
      "footerNotes": "Footer notes",
      "hint": "Shown at the bottom of the invoice — terms, thank-you note, or legal text."
    },
    "payhistory": {
      "add": "Add payment",
      "amount": "Payment {n} amount",
      "amountPlaceholder": "Amount",
      "date": "Payment {n} date",
      "datePlaceholder": "Date",
      "method": "Payment {n} method",
      "methodPlaceholder": "Method",
      "payments": "Payments",
      "removeRow": "Remove payment {n}"
    },
    "payment": {
      "instructions": "Payment instructions"
    },
    "poterms": {
      "terms": "Purchase order terms"
    },
    "qr": {
      "caption": "Caption",
      "hint": "Encodes Amount due · {total}. The code shown is the image you upload under Images."
    },
    "recurring": {
      "annually": "Annually",
      "frequency": "Frequency",
      "monthly": "Monthly",
      "next": "Next issue date",
      "note": "Schedule note",
      "quarterly": "Quarterly",
      "weekly": "Weekly"
    },
    "refund": {
      "policy": "Refund policy"
    },
    "removeLine": "Remove {label} {n}",
    "removeSection": "Remove section",
    "shipto": {
      "addressLines": "Address lines",
      "name": "Ship-to name"
    },
    "signature": {
      "hint": "A signature line and date field appear on the invoice for hand-signing.",
      "name": "Signatory name",
      "title": "Title / role"
    },
    "tax": {
      "discount": "Discount",
      "discountRow": "Discount",
      "subtotal": "Subtotal",
      "tax": "Tax",
      "taxRate": "Tax rate",
      "total": "Total"
    },
    "taxbreak": {
      "add": "Add tax line",
      "components": "Tax components",
      "label": "Tax line {n} label",
      "note": "Each rate is applied to the subtotal after any discount.",
      "rate": "Tax line {n} rate",
      "removeRow": "Remove tax line {n}",
      "seedLabel": "New tax"
    },
    "terms": {
      "checkboxLabel": "Checkbox label",
      "preChecked": "Pre-checked",
      "preCheckedHint": "Show the box already ticked"
    },
    "theme": {
      "accentColour": "Accent colour",
      "backgroundHint": "Adds a full-bleed background behind the whole invoice — great for letterhead or a watermark.",
      "backgroundImage": "Background image",
      "currency": "Currency",
      "documentTitle": "Document title",
      "language": "Language",
      "languageNote": "Use the language button in the toolbar to create a linked variation instead of re-tagging this one.",
      "overlay": "Overlay {pct}%",
      "overlayLabel": "Overlay",
      "removeBackground": "Remove",
      "replaceBackground": "Replace",
      "showDecimals": "Show decimals",
      "showDecimalsHint": "e.g. $290.00 vs $290",
      "status": {
        "draft": "Draft",
        "live": "Live",
        "overdue": "Overdue",
        "paid": "Paid",
        "sent": "Sent"
      },
      "statusLabel": "Status",
      "topic": {
        "logistics": "Shipping & logistics",
        "other": "Uncategorised",
        "receipts": "Receipts & refunds",
        "recurring": "Recurring",
        "sales": "Sales & quotes",
        "services": "Professional services"
      },
      "topicLabel": "Topic",
      "uploadBackground": "Upload background"
    }
  },
  "languages": {
    "de": "German",
    "en": "English",
    "es": "Spanish",
    "footnote": "Creating a language makes a linked copy, grouped under the same topic.",
    "fr": "French",
    "ja": "Japanese",
    "pt": "Portuguese",
    "state": {
      "create": "Create",
      "editing": "Editing",
      "open": "Open"
    },
    "title": "Language variations"
  },
  "list": {
    "actions": "Actions",
    "name": "Name",
    "status": "Status",
    "updated": "Updated"
  },
  "manager": {
    "group": {
      "documents": "{count, plural, one {# document} other {# documents}}",
      "label": "Group",
      "language": "Language",
      "languages": "{count, plural, one {# language} other {# languages}}",
      "none": "None",
      "topic": "Topic"
    },
    "layout": {
      "gallery": "Gallery",
      "label": "Layout",
      "list": "List"
    },
    "loadFailed": "Couldn’t load invoices",
    "search": {
      "clear": "Clear search",
      "invoices": "Search invoices…",
      "templates": "Search templates…"
    },
    "subtitle": "Reusable templates & the invoices you build from them.",
    "tabs": {
      "invoices": "Invoices",
      "label": "Kind",
      "templates": "Templates"
    },
    "title": "Invoices",
    "untitled": "Untitled"
  },
  "new": {
    "blank": "Blank invoice",
    "blankHint": "Build from scratch",
    "category": {
      "adjustments": "Adjustments",
      "business": "Business",
      "nonprofit": "Nonprofit",
      "payments": "Payments",
      "projects": "Projects",
      "recurring": "Recurring",
      "sales": "Sales",
      "services": "Services",
      "shipping": "Shipping"
    },
    "failed": "Could not create it",
    "invoice": "New invoice",
    "startersFailed": "The starters could not be loaded. Start blank, or try again.",
    "subtitle": "Start from a blank canvas or a ready-made template.",
    "template": "New template",
    "yourTemplates": "Your templates"
  },
  "optional": {
    "approvalShow": "Approval",
    "attachShow": "Attachments",
    "conShow": "Contact",
    "delShow": "Delivery timeline",
    "discShow": "Discount codes",
    "lateShow": "Late fees",
    "legalShow": "Legal footer",
    "loyShow": "Loyalty points",
    "mcShow": "Multi-currency",
    "payhShow": "Payment history",
    "poShow": "PO terms",
    "qrShow": "Payment QR",
    "recurShow": "Recurring",
    "refShow": "Refund policy",
    "shipShow": "Ship to",
    "sigShow": "Signature",
    "taxbShow": "Tax breakdown",
    "termsShow": "Terms acceptance"
  },
  "section": {
    "approval": {
      "hint": "Sign-off status",
      "title": "Approval"
    },
    "attachments": {
      "hint": "Attached files",
      "title": "Attachments"
    },
    "branding": {
      "hint": "Logo & brand name",
      "title": "Branding"
    },
    "contact": {
      "hint": "Support details",
      "title": "Contact"
    },
    "custom": {
      "hint": "Your own section",
      "title": "Custom section"
    },
    "customer": {
      "hint": "Client details",
      "title": "Invoice to"
    },
    "delivery": {
      "hint": "Fulfilment status",
      "title": "Delivery timeline"
    },
    "discount": {
      "hint": "Applied promo codes",
      "title": "Discount codes"
    },
    "from": {
      "hint": "Your company details",
      "title": "From"
    },
    "images": {
      "hint": "Logo, background, QR & photos",
      "title": "Images"
    },
    "items": {
      "hint": "Products & services",
      "title": "Line items"
    },
    "latefees": {
      "hint": "Overdue penalty",
      "title": "Late fees"
    },
    "legal": {
      "hint": "Fine print",
      "title": "Legal footer"
    },
    "loyalty": {
      "hint": "Rewards balance",
      "title": "Loyalty points"
    },
    "meta": {
      "hint": "Number, dates, PO & terms",
      "title": "Invoice details"
    },
    "multicurrency": {
      "hint": "Totals in other currencies",
      "title": "Multi-currency"
    },
    "notes": {
      "hint": "Footer text",
      "title": "Notes"
    },
    "payhistory": {
      "hint": "Past payments",
      "title": "Payment history"
    },
    "payment": {
      "hint": "How to pay",
      "title": "Payment"
    },
    "poterms": {
      "hint": "Purchase order terms",
      "title": "PO terms"
    },
    "qr": {
      "hint": "Scan-to-pay code",
      "title": "Payment QR"
    },
    "recurring": {
      "hint": "Charge schedule",
      "title": "Recurring"
    },
    "refund": {
      "hint": "Returns & refunds",
      "title": "Refund policy"
    },
    "shipto": {
      "hint": "Delivery address",
      "title": "Ship to"
    },
    "signature": {
      "hint": "Authorised sign-off",
      "title": "Signature"
    },
    "tax": {
      "hint": "Rates & discounts",
      "title": "Tax & totals"
    },
    "taxbreak": {
      "hint": "Tax components",
      "title": "Tax breakdown"
    },
    "terms": {
      "hint": "Acceptance checkbox",
      "title": "Terms"
    },
    "theme": {
      "hint": "Colour, currency, status",
      "title": "Title & theme"
    }
  },
  "seed": {
    "gallery": {
      "title": "Images"
    },
    "image": {
      "caption": "Add a caption",
      "title": "Image"
    },
    "item": "New item",
    "kv": {
      "label": "Label",
      "row1k": "Cost centre",
      "row2k": "Contract",
      "title": "Reference details",
      "value": "Value"
    },
    "text": {
      "body": "Add your own copy here — scope, delivery notes, conditions or a message to the client.",
      "title": "Additional notes"
    }
  },
  "status": {
    "draft": "Draft",
    "live": "Live",
    "overdue": "Overdue",
    "paid": "Paid",
    "sent": "Sent"
  },
  "toast": {
    "deleteFailed": "Could not delete it",
    "duplicateFailed": "Could not duplicate it",
    "duplicated": {
      "invoice": "Invoice duplicated",
      "template": "Template duplicated"
    },
    "imageTooLarge": "Image too large (max {max})",
    "imageUnreadable": "Could not read that file",
    "languageFailed": "Could not add that language",
    "notAnImage": "That file is not an image",
    "renameFailed": "Could not rename it"
  },
  "topic": {
    "logistics": "Shipping & logistics",
    "other": "Uncategorised",
    "receipts": "Receipts & refunds",
    "recurring": "Recurring",
    "sales": "Sales & quotes",
    "services": "Professional services"
  }
} as const;
