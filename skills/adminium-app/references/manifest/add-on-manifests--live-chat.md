<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Add-on manifests — Live chat; do not edit -->

# Manifest spec: Add-on manifests — Live chat

### Live chat

`addOn.chat` names the add-on's own tables that hold a live chat on the owner's website. Adminium
keeps every conversation for the visitor: it draws the window, takes and writes each message, runs
the automatic answers and records what the answerer chose. No code of the add-on runs for a
visitor. The add-on brings the tables and the staff screens. A manifest that declares it sets
`compatibility.minAdminiumVersion` to `0.3.64` or later, files the add-on under the `marketing`
category, and declares no `forms` beside it.

```json
"addOn": {
  "settingsTable": "chat_settings",
  "chat": { "conversations": "conversations", "messages": "messages", "answers": "answers", "choices": "choices" }
}
```

All four are required, each a table of its own. Each has a numbered key: an `int` or `bigint`
column with `"role": "pk"`, which Adminium numbers. A message's key is the point a visitor's window
asks for messages after. Adminium alone writes the conversations, the messages and the choices. No
role may create, update or import them, an app's grant only reads them, and no step writes them;
staff read and delete them. One grant is the exception: `update` on the conversations, for a role or
an app's grant, says who may answer them (take, reply, close, reopen, make an enquiry) through
Adminium's own chat routes. Even then nobody changes a row of the three tables by any other door.
Staff write the answers and the settings row. No public entry of the
add-on opens any of the four tables. A further column of a table Adminium alone writes is nullable
or has a default.

Each table has these columns, by these names, as Adminium reads and writes them. A table may add
its own. A `text` column given here a length takes at least that many characters, or has no
`maxLength`. A column marked "empty" is `nullable`; every other one is not.

**`conversations`**, one row per conversation:

| Column | Type | What it holds |
|---|---|---|
| `started_at` | `timestamptz` | When the visitor opened it. |
| `last_message_at` | `timestamptz` | When its newest message was sent. |
| `state` | `enum` `bot`, `waiting`, `open`, `closed` | With the automatic answerer, waiting for a person, with a person, or over. |
| `language` | `text` 10 | The language the window was drawn in. |
| `name`, `email` | `text` 200, `text` 320, empty | What the visitor typed. Never confirmed. |
| `came_from` | `text` 2048 (so no `maxLength`), empty | The page the window was opened on, without its query. |
| `outside_hours` | `bool` | Started while nobody was in. |
| `taken_by`, `taken_at` | `text` 64, `timestamptz`, empty | The staff member who took it, and when. |
| `last_visitor_at`, `last_staff_at` | `timestamptz`, empty | When the visitor's window, and a staff member, were last seen. The visitor's is their presence. |
| `closed_at` | `timestamptz`, empty | When it closed. |
| `became_table`, `became_key` | `text` 64, `text` 200, empty | The row of an app it became (`<app>:<table>` and its key). |
| `automatic_count` | `int` | How many automatic answers it has had. |

**`messages`**, one row per line of a conversation:

| Column | Type | What it holds |
|---|---|---|
| `conversation_id` | `fk` to the conversations | The conversation. |
| `kind` | `enum` `visitor`, `staff`, `automatic`, `system` | Who wrote it. A `system` line says what happened. |
| `body` | `text` 2000 (so no `maxLength`) | The words. |
| `event` | `text` 30, empty | A system line's word: `taken`, `handed-over`, `closed`, `reopened` or `left`. |
| `answer_ref` | `text` 64, empty | The answer an automatic message gave. |
| `author_id` | `text` 64, empty | The staff member who wrote it. |
| `drafted` | `bool` | A person sent a reply the assistant drafted. |
| `sent_at` | `timestamptz` | When it was sent. |
| `mailed_at` | `timestamptz`, empty | When it went to the visitor by e-mail, after they left. |

**`answers`**, the answers staff write for automatic replies:

| Column | Type | What it holds |
|---|---|---|
| `ref` | `text` 64, `unique` | The answer's name, which a message and a choice keep. |
| `versions` | `json` | `{ "<language>": { "title", "text", "examples": [...] } }`, the default language required. |
| `active` | `bool` | Offered to the answerer. |
| `position` | `int` | Its place in the list. |

**`choices`**, one row per visitor message the answerer was asked about:

| Column | Type | What it holds |
|---|---|---|
| `conversation_id` | `fk` to the conversations | The conversation. |
| `message_id` | `int` | The visitor's message. |
| `answer_ref` | `text` 64, empty | The answer chosen. Empty when it was handed to a person. |
| `outcome` | `enum` `answered`, `hand-over`, `error`, `budget`, `cap`, `off` | What happened. |
| `model` | `text` 100, empty | The model asked. |
| `tokens_in`, `tokens_out` | `int` | What it cost. |
| `at` | `timestamptz` | When. |

**The settings row.** A chat add-on names its one-row settings table in `addOn.settingsTable`, and
that table has these columns. The row is made from the columns' defaults at install, and a `json`
or `date` column takes no default, so those are empty until staff set them:

| Column | Type | What it holds |
|---|---|---|
| `hours` | `json`, empty | The weekly hours: `{ "mon": [["09:00", "17:30"]], … }`. |
| `time_zone` | `text` 64, empty | The time zone the hours are in. |
| `closed_until` | `date`, empty | Closed until this day, as on a holiday. |
| `welcome`, `outside_words` | `json`, empty | The window's first words, and what it says outside hours, per language. |
| `automatic` | `bool` | Automatic answers are on. |
| `daily_tokens` | `int` | What automatic answers may spend a day. `0` is none. |
| `milo_drafts` | `bool` | The assistant drafts replies for staff on these conversations. |
| `tell` | `json`, empty | Who is told of a waiting conversation: `[{ "kind": "role" or "person", "id" }]`. |
| `transcripts_months` | `int`, empty | How many months conversations are kept; empty keeps them until removed. The add-on ships 12. |
| `theme` | `enum` `light`, `dark`, `visitor` | How the window is drawn: light, dark, or as the visitor's device is set. |

A package that declares chat serves it only when Adminium can vouch for its bytes, as forms are: a
package this build bundles, one downloaded from the catalogue, or a developer's own outside
production. One uploaded by hand installs, and its chat answers "not available".

#### A table opened to a chat

An app opens a table to a question a visitor leaves outside hours through a `publicAccess` entry
under the reserved key `chat`. A visitor who leaves an e-mail and a question then adds a row of the
table:

```json
{ "table": "enquiries", "methods": ["POST"], "key": "chat",
  "writable": ["name", "email", "message"],
  "defaults": { "state": "new", "source": "chat" },
  "anonymous": { "perValue": { "columns": ["email"], "n": 5 }, "perKeyHour": 100, "plainText": ["name"] } }
```
