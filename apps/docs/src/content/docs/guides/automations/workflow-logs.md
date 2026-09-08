---
title: Workflow logs
description: Every execution of every rule — the seven-day window, what each status means, and how to read a trace.
---

**Workflow logs** is the history of your automations: one row per execution,
with the step-by-step trace of what happened.

Open it from the sidebar, or from a rule you are looking at.

## The window

The list covers the **last seven days**, newest first, and so do the counts on
the filter pills. "Load older" pages back through that window.

The four numbers at the top are about **today**, in your own timezone: how many
runs, what fraction succeeded, how many failed, and the average duration of the
ones that finished.

## What a status means

The three filters cover seven states.

| Filter | Status | What it means |
|---|---|---|
| Success | **Success** | Every step ran and none failed. |
| Failed | **Failed** | At least one step failed. The run may still have finished — see "Continue on error" below. |
| Running | **Starts in …** | Queued, waiting out the 60-second undo window on a dashboard write. |
| Running | **Running** | Walking its steps right now. |
| Running | **Waiting · resumes …** | Suspended at a *Wait* step. |
| All | **Skipped** | Nothing to act on: the record was deleted, or the write that triggered it was undone. |
| All | **Cancelled** | The rule was switched off while this run was waiting. |

The list refreshes itself every five seconds while anything on it is
unfinished, and stops when nothing is. **Refresh** re-reads everything on
demand.

## Reading a trace

Each step shows its name, how long it took, and one line of what it did:

```
Trigger          0ms    record = 4821 · trial, 2026-09-08
Send welcome…    142ms  250 2.0.0 Ok · delivered to jordan@acme.io
Wait 2 days      —      resumes 2026-09-10T09:14:22.000Z
Send the offer…  138ms  250 2.0.0 Ok · delivered to jordan@acme.io
Did they claim…  0ms    took "Otherwise"
Send reminder    121ms  250 2.0.0 Ok · delivered to jordan@acme.io
```

- **A green check** is a step that ran.
- **A red cross** is one that failed; the reason is in the line beneath it.
- **A grey dash** is a step that was skipped — the branch not taken, or
  everything after a filter that did not match.
- **A timer** is a wait, with the instant it resumes.

The duration on the run itself is the sum of the steps' own time. A run that
slept for two days does not report two days: the question the number answers
is "how long does this automation take to do its work".

### Failures and "Continue on error"

A run with a failed step is **Failed**, always. What "Continue on error"
changes is whether the steps *after* it run: with it off they show as skipped,
with it on they run anyway — and the run is still red, with the trace showing
which step went wrong.

### What is in a trace, and what is not

The trace is stored, and admins read it, so the values in it are masked the
same way they are everywhere else: a masked column shows as hidden. The run
itself reads the real values — it has to, to address the email — but what is
written down is redacted.

## How long a run is kept

Finished runs are deleted after `retention.automationRunsDays` (90 days by
default). **Failed runs are kept twice as long**, because the run somebody
comes back to read is the one that went wrong. Runs that have not happened yet
— pending and waiting — are never swept, however old the row is.

Deleting a rule deletes its runs with it. The confirm dialog says so.

See also: [Automations](/guides/automations/).
