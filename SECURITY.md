# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities **privately** to **security@adminium.dev**. Do not open a public issue, discussion, or PR for anything security-sensitive.

Include what you can of:

- A description of the issue and its impact
- Steps to reproduce or a proof of concept
- Affected version(s) and deployment mode (self-host, Docker, Desktop, Cloud)
- Any suggested remediation

You will receive an acknowledgment within **3 business days** and a triage assessment within **10 business days**.

## Coordinated disclosure

We follow a **90-day coordinated disclosure** window: from the date we acknowledge a valid report, we aim to release a fix and publish an advisory within 90 days. If a fix ships sooner, disclosure can happen sooner by mutual agreement; if we need more time for an exceptionally complex issue, we will ask and explain why. We credit reporters in the advisory unless they prefer otherwise. Please do not disclose publicly before the window closes or a fix is released, whichever comes first.

## Supported versions

Adminium is pre-1.0. Until 1.0, only the **latest minor release** receives security fixes:

| Version | Supported |
|---|---|
| Latest 0.x minor (current release) | Yes |
| Older 0.x releases | No — upgrade to the latest release |

After 1.0 this table will be replaced with a concrete maintenance window per release line.

## Scope

**Self-host / Docker / Desktop (this repository):** vulnerabilities in the Adminium server, dashboard, Electron app, published `@adminium/*` packages, and the official Docker image are in scope. Note that Adminium is an admin tool: instance administrators are highly privileged by design, so reports must demonstrate crossing a real trust boundary (e.g. unauthenticated access, RBAC bypass, SQL injection through the query builder, secrets exposure at rest or in logs) — "an admin can do admin things" is not a vulnerability. Issues caused solely by an unsupported deployment configuration (e.g. deliberately exposing the server without TLS) are out of scope.

**Cloud (adminium.app / adminium.dev):** the hosted control plane, provisioning, and billing services live in a private repository, but reports for them are welcome at the same address and follow the same process. Never test against customer instances you do not own; use your own workspace. Denial-of-service, volumetric attacks, and social engineering of staff are out of scope.

There is currently no paid bounty program.
