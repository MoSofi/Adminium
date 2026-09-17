---
title: Project code is trusted
description: Hooks, actions, custom pages and widgets in a project folder run as host code with no sandbox — because they are the operator's own code, committed to the operator's own repository.
---

## The situation

A [project](/projects/) is a folder the developer owns: page files, plus
`hooks/`, `actions/`, `widgets/` and hand-written pages. That code has to run
somewhere, and the same question comes up as for
[add-ons](/anatomy/decisions/add-on-trust/) — sandbox it, or trust it?

For an add-on the question is real: it arrives from somewhere else. For project
code it is not. The code is in the operator's repository, written by the
operator, reviewed by the operator, and deployed by the operator in the same
commit as the server that runs it. A sandbox would be protecting them from
themselves, at the cost of making every useful thing awkward.

## The decision

**Project code is the operator's own code.** It runs in the server process,
with no sandbox and no publisher check. This is the same shape custom code takes
in comparable frameworks, and it means a hook can simply `await` a query
instead of negotiating through a message channel.

Trusted does not mean unbounded. The limits that exist are about *containment of
mistakes*, not defence against the author:

- **A build step, not a runtime import.** `adminium build` bundles
  `hooks/*.ts` and `actions/*.ts` with esbuild and lists them in a build
  manifest. The server imports what the manifest lists.
- **One broken file costs itself.** A file that fails to import, or exports the
  wrong thing, is recorded and skipped; the rest load. A broken file never
  stops a boot.
- **Hooks have a time limit.** A before-save hook gets 5 seconds and an
  after-save hook 30. A before hook that throws or runs past its limit fails the
  write, with a message naming the file rather than leaking the error.
- **A hook cannot loop forever.** A write a hook makes through the `db` helper
  carries `origin: 'hook'` and one more hop on the same counter automations use.
  Past the ceiling the write is refused, which stops a hook that triggers
  itself.
- **An after hook never undoes a write.** Its failure is logged and shown in
  Studio; the record stays saved.
- **Actions run as the person who pressed the button.** The user's permissions
  apply, and the run is audited.

**Two runtimes never load it at all.** `adminium try` has no project, and the
desktop app sets `ADMINIUM_RUNTIME=desktop`, which turns the project code
runtime off even when a folder is present. Both are one condition in
`compose.ts`, and a test asserts that a desktop-mode server reports no hooks,
no actions, and still writes records normally.

## What it means for a contributor

- **Do not add a sandbox** or a capability-proxy layer to this path. If a
  feature seems to need one, it is probably an add-on feature rather than a
  project feature.
- **Do keep the desktop and `try` exclusion true.** Anything that reaches
  project code from a new call site needs the same condition, and the test above
  is the thing that will tell you.
- **Errors from project code are the author's errors.** Report the file, the
  hook name and the action id. Do not swallow them, and do not present them as
  Adminium failures.

[Hooks and actions](/projects/hooks-and-actions/) is the developer-facing guide.
