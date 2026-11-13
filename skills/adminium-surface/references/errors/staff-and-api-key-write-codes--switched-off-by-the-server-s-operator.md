<!-- produced from apps/docs/src/content/docs/reference/errors.md § Staff and API-key write codes — Switched off by the server's operator; do not edit -->

# Error codes: Staff and API-key write codes — Switched off by the server's operator

### Switched off by the server's operator

An instance run in [trial mode or the hosted profile](https://docs.adminium.dev/self-hosting/for-other-people/#what-it-switches-off-and-why)
refuses what its operator switched off, on any route. The two `…_BY_OPERATOR` codes can also come
from an operator's variable on any server (`ADMINIUM_LOCAL_DATABASES=off`, `ADMINIUM_AI_OPERATOR_ONLY=on`):

| Code | Status | When | details |
|---|---|---|---|
| `OFF_BY_OPERATOR` | 403 | An action the profile switches off: a database host not on the operator's list, a storage destination, a webhook step, uploading an add-on or an app, the Designer's uploads and code of one's own, **Start with an app**, a pay page or payment webhook, a domain the operator did not list, a write after a trial's end, an insert into a database past its size cap… | `question` (what is off, such as `webhooks`, `packageUploads`, `payPages`, `mappedDomains` or `dataOverCap`), `reason` (`trial-mode`, `hosted-mode`, `trial-ended`, `size-cap`, `operator-ai-only`, `operator-ai-scope`, or `not-allowed` for an operator's variable outside the profiles); a refused domain list also names the `hosts` or `origins` it refused |
| `SET_BY_OPERATOR` | 409 | A change to a setting the operator decides: the address in email links, the mail server in a trial, telemetry, the update check, an AI address, **Allow databases on this server**. Sending the value it is held to is no change and passes. | `setting`, `reason` (as above, or `not-allowed` for an operator's variable outside the profiles) |

Every refusal an operator's switch causes is this one `OFF_BY_OPERATOR`: there is no other code
for it. The `question` names what was refused:

| `question` | What it refuses | `reason` |
|---|---|---|
| `sqliteSources` | A SQLite file as a source, and making one | `trial-mode`, `hosted-mode` |
| `unlistedDatabaseHosts` | A database host not on `ADMINIUM_DATABASE_HOSTS` | `trial-mode`, `hosted-mode` |
| `anyDatabaseLogin` | On one of the operator's hosts, a login other than `ADMINIUM_SOURCE_URL`'s user and database | `trial-mode`, `hosted-mode` |
| `extraSourceConnections` | A trial's fourth source connection | `size-cap` |
| `metaStoreRoutes` | Moving or adopting the meta store (`/meta/relocate`, `/setup/probe`, `/setup/adopt`) | `trial-mode`, `hosted-mode` |
| `storageDestinations` | Adding, testing or picking a storage destination other than local | `trial-mode`, `hosted-mode` |
| `storageOverCap` | Uploads, the Designer's writes and exports (never Export everything) past a trial's data folder limit | `size-cap` |
| `dataOverCap` | Inserts, updates and schema changes that add, on a database past a trial's size limit, or before it was first measured | `size-cap` |
| `writes` | Any write after a trial's end date | `trial-ended` |
| `webhooks` | Saving or running an automation's webhook step (and a Slack message, which is one) | `trial-mode` |
| `paymentProviders` | Connecting a payment service | `trial-mode` |
| `marketingCampaigns` | Sending a marketing campaign | `trial-mode` |
| `liftMailHold` | Taking today's bounce or spam report off the do-not-email list | `trial-mode` |
| `aiBaseUrl` | An AI address of the person's own, typed, tested or saved | `trial-mode`, `operator-ai-only` |
| `customAiProviders` | The OpenAI-compatible and Ollama providers, and Adminium's managed AI | `trial-mode`, `operator-ai-only` |
| `customerScreensOnOperatorAi` | A customer side, Start with an app or pictures on an app with public screens, in a session on the AI that comes with the installation | `operator-ai-scope` |
| `packageUploads` | Uploading an add-on or an app (`/add-ons/upload`, `/apps/upload`, `/apps/upload-workspace`) | `trial-mode`, `hosted-mode` |
| `designerUploads` | A site template zip, a style of one's own, a hand save from the Code tab | `trial-mode`, `hosted-mode` |
| `ownBuilds` | **Start with an app**, an app's own build command, the phone app's build | `trial-mode`, `hosted-mode` |
| `designerCode`, `requestPackage` | The Designer writing server code or tests, or adding an npm package: refused inside its turn with fixed words | `trial-mode`, `hosted-mode` |
| `payPages`, `paymentWebhooks` | A pay page, and a payment service's webhook, however the address is spelt | `trial-mode` |
| `mappedDomains` | A domain the operator did not list, mapped to an app's side or framing a form (`details.hosts` or `details.origins`) | `trial-mode`, `hosted-mode`, `not-allowed` |

The other questions the operator's profile answers are not refused with this code:
`localDatabases`, `updateCheck`, `telemetry`, `ownSmtp` and `publicOriginSetting` are settings
(`409` `SET_BY_OPERATOR`); `unlimitedConnectionTests` is the installation's connection-test
budget (`429` `RATE_LIMITED` with `details.scope: "instance"`, `limit` and `retryAfterSeconds`);
`anyHost` is the `421` a request for another host name gets; `publicPages` is the `404` every
public page answers once a trial has ended; `privateNetwork` is
[`ADMINIUM_NETWORK_POLICY=strict`](https://docs.adminium.dev/self-hosting/env-vars/#adminium_network_policy);
`addOnHttp`, `geoServers`, `designerNetwork`, `userMail`, `searchIndexing` and `projectDotEnv`
switch a feature off without a request to refuse.

The dashboard shows each of these choices disabled with the operator's reason before anybody
tries.
