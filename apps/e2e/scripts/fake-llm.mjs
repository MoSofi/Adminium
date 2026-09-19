// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A fake OpenAI-compatible endpoint for the assistant's e2e legs.
 *
 * WHAT IT IS FOR. A turn is a conversation: the model asks for tools, reads
 * what comes back, and eventually produces a draft. Driving that from a real
 * provider would make the specs non-deterministic and cost money on every CI
 * run, so this speaks the same wire format and answers from a scripted table.
 *
 * WHAT IT DOES NOT PROVE, and it matters. A scripted provider shows that we
 * build the request we MEANT to and handle the reply we EXPECTED — never that
 * a real API accepts either. That is how a rejected `temperature` parameter
 * once reached users. The one real turn per context in the acceptance walk is
 * the contract test; this is the regression net under it.
 *
 * ─── How a scenario is chosen ────────────────────────────────────────────
 *
 * STATELESS, from the conversation itself. The fake scans the messages for
 * the first USER message matching a scenario's `match`, then counts the
 * ASSISTANT messages after it: that count is the index of the next scripted
 * reply. Nothing is remembered between requests, so a spec that re-runs a
 * turn gets the same script, and a REPAIR round advances the index by one on
 * its own — which is exactly what the repair scenario needs.
 *
 * A reply may be a function of the conversation rather than a constant. The
 * report scenario needs that: it cannot know a connection's id until
 * `list_connections` has answered, so its second reply reads the id out of
 * the tool results and writes it into an `aggregate` descriptor. That
 * descriptor is also what the report's *Run full preview* re-executes later,
 * so it has to be a real one.
 *
 * Run `node apps/e2e/scripts/fake-llm.mjs --self-test` to replay every
 * scenario end to end and check each reply against the real turn contract.
 */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const SCHEMA = 'adminium.assistant/v1';

// ─── helpers the scripts are written with ────────────────────────────────────

const step = (icon, label, detail = '') => ({ icon, label, detail });

/** A `calls` move: one or more tools, each with the step row the modal shows. */
const calls = (say, list) => ({ schema_version: SCHEMA, say, calls: list });

/** A `result` move: the drafted artefact in the host page's own format. */
const result = (say, body) => ({ schema_version: SCHEMA, say, result: body });

/** An `ask` move: pick groups the operator answers before work continues. */
const ask = (say, body) => ({ schema_version: SCHEMA, say, ask: body });

/** The text of the last user message, or `''`. */
function lastUser(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') return String(messages[i]?.content ?? '');
  }
  return '';
}

/** Every `tool_results` payload in the conversation, oldest first. */
function toolResults(messages) {
  const out = [];
  for (const message of messages) {
    if (message.role !== 'user') continue;
    let parsed;
    try {
      parsed = JSON.parse(String(message.content ?? ''));
    } catch {
      continue;
    }
    if (Array.isArray(parsed?.tool_results)) out.push(...parsed.tool_results);
  }
  return out;
}

/** The first connection id any `list_connections` call came back with. */
function firstConnectionId(messages) {
  for (const entry of toolResults(messages)) {
    if (entry.tool !== 'list_connections' || entry.ok !== true) continue;
    const list = Array.isArray(entry.result?.connections) ? entry.result.connections : [];
    const found = list.find((connection) => typeof connection?.id === 'string');
    if (found !== undefined) return found.id;
  }
  return null;
}

/**
 * A table a `describe_schema` call named, and a column of it worth grouping by.
 *
 * READ, NOT GUESSED. A scripted descriptor that named a column the seeded
 * database does not have would make the aggregate refuse on every run — the
 * spec would still pass, while proving nothing about the path it exists to
 * cover. The first non-personal column is enough: the shape of the answer is
 * what the scenario is about, not which column it grouped on.
 */
function firstGroupable(messages) {
  for (const entry of toolResults(messages)) {
    if (entry.tool !== 'describe_schema' || entry.ok !== true) continue;
    const tables = Array.isArray(entry.result?.tables) ? entry.result.tables : [];
    for (const table of tables) {
      if (typeof table?.id !== 'string') continue;
      const columns = Array.isArray(table.columns) ? table.columns : [];
      const column = columns.find((entry) => typeof entry?.name === 'string' && entry.personalData !== true);
      if (column === undefined) continue;
      const [schema = 'main', name = ''] = table.id.split('.');
      return { schema, name, column: column.name };
    }
  }
  return null;
}

// ─── the scenarios ───────────────────────────────────────────────────────────

/**
 * Each entry is `{ key, match, replies }`. A reply is either an object or a
 * function of the conversation. `match` is tried against every user message,
 * so a turn opened by picks still finds the scenario that asked the question.
 */
const SCENARIOS = [
  {
    key: 'email',
    match: /reminder for an unpaid invoice|draft a reminder/i,
    replies: [
      (messages) =>
        calls('Let me look at what this page already has.', [
          {
            id: 'c1',
            tool: 'list_documents',
            args: {},
            step: step('file-search', 'Read the templates', 'in this workspace'),
          },
        ]),
      () =>
        result('Here is a payment reminder, drafted in your template format.', {
          title: 'Payment reminder',
          meta: 'template · en_US',
          workTitle: 'Drafted a new email template',
          basedOn: null,
          checks: ['Every variable used is one this workspace defines'],
          followups: ['Add a late-fee line'],
          artefact: {
            kind: 'template',
            name: 'Payment reminder',
            locale: 'en_US',
            document: {
              subject: 'A reminder about invoice {{number}}',
              preheader: 'Still outstanding',
              blocks: [
                { block: 'email.heading', data: { text: 'A quick reminder' } },
                {
                  block: 'email.text',
                  data: { paras: ['Our records show invoice {{number}} is still outstanding.'] },
                },
              ],
              footer: 'Thank you.',
            },
          },
        }),
    ],
  },
  {
    key: 'invoice',
    match: /create an invoice for a customer for last month/i,
    replies: [
      () =>
        ask('Which template should I build it from?', {
          groups: [
            {
              key: 'tpl',
              title: 'Template',
              options: [
                { key: 'standard', label: 'Standard invoice', detail: 'the usual layout' },
                { key: 'hourly', label: 'Hourly / time', detail: 'billed by the hour' },
              ],
            },
          ],
          readyLabel: 'Ready',
          goLabel: 'Continue',
        }),
      () =>
        calls('Reading that template.', [
          {
            id: 'c1',
            tool: 'list_documents',
            args: {},
            step: step('layout-template', 'Read the templates', 'to find the one you picked'),
          },
        ]),
      (messages) => {
        const documents = toolResults(messages).find((entry) => entry.tool === 'list_documents' && entry.ok === true);
        const list = Array.isArray(documents?.result?.documents) ? documents.result.documents : [];
        const template = list.find((row) => row?.kind === 'template') ?? list[0];
        return result('A draft invoice, built from that template.', {
          title: 'Draft invoice',
          meta: 'draft',
          workTitle: 'Drafted an invoice',
          basedOn: typeof template?.id === 'string' ? template.id : 'unknown',
          artefact: {
            basedOn: typeof template?.id === 'string' ? template.id : 'unknown',
            name: 'Contoso Ltd — March',
            body: {
              customerName: 'Contoso Ltd',
              issued: '2026-03-01',
              due: '2026-03-31',
              items: [{ id: 'i1', desc: 'Consulting', qty: '4', rate: '150' }],
              taxRate: '10',
            },
          },
        });
      },
    ],
  },
  {
    key: 'report',
    match: /which customers take the most support time|build a retention report/i,
    replies: [
      () =>
        calls('First, what I am allowed to read.', [
          {
            id: 'c1',
            tool: 'list_connections',
            args: {},
            step: step('database', 'Read the connections', 'and the tables you can read'),
          },
        ]),
      (messages) => {
        const connectionId = firstConnectionId(messages);
        return calls('Now the schema of that connection.', [
          {
            id: 'c2',
            tool: 'describe_schema',
            args: { connectionId },
            step: step('shapes', 'Read the schema', String(connectionId ?? '')),
          },
        ]);
      },
      (messages) => {
        const target = firstGroupable(messages) ?? { schema: 'main', name: 'orders', column: 'id' };
        return calls('Counting them.', [
          {
            id: 'c3',
            tool: 'aggregate',
            args: {
              connectionId: firstConnectionId(messages),
              descriptor: {
                shape: 'categorical',
                source: { schema: target.schema, name: target.name },
                groupBy: [target.column],
                aggregations: [{ fn: 'count', alias: 'n' }],
                limit: 5,
              },
            },
            step: step('calculator', 'Count the rows', `${target.schema}.${target.name}`),
          },
        ]);
      },
      (messages) => {
        const target = firstGroupable(messages) ?? { schema: 'main', name: 'orders', column: 'id' };
        const counted = toolResults(messages).find((entry) => entry.tool === 'aggregate' && entry.ok === true);
        const items = Array.isArray(counted?.result?.data?.items) ? counted.result.data.items : [];
        return result('A report over what I could read.', {
          title: 'Rows by group',
          meta: 'report',
          workTitle: 'Built the report',
          basedOn: null,
          checks: ['Every figure came from the database, not from me'],
          artefact: {
            name: 'Rows by group',
            body: {
              kicker: 'Operations',
              reportTitle: 'Rows by group',
              subtitle: 'Counted from the connected database',
              blocks: [
                {
                  id: 'b1',
                  // `kind`, not `block` — the report page's own field name.
                  kind: 'bar',
                  title: 'By group',
                  w: 'full',
                  show: true,
                  series: items.slice(0, 5).map((item) => ({
                    label: String(item?.label ?? ''),
                    value: String(item?.value ?? 0),
                  })),
                },
              ],
            },
            // The descriptor behind the figures, so *Run full preview* can
            // execute it again and show what it says today. A scripted
            // descriptor that named no real table would make that button a
            // no-op the spec could not tell from a pass.
            sources: [
              {
                blockId: 'b1',
                descriptor: {
                  connectionId: firstConnectionId(messages),
                  shape: 'categorical',
                  source: { schema: target.schema, name: target.name },
                  groupBy: [target.column],
                  aggregations: [{ fn: 'count', alias: 'n' }],
                  limit: 5,
                },
                reason: 'counts the rows in each group',
              },
            ],
          },
        });
      },
    ],
  },
  {
    key: 'repair',
    match: /repair round/i,
    replies: [
      // Deliberately invalid: two moves in one reply. The runner answers with
      // a repair message, which counts as an assistant turn — so the index
      // lands on the valid reply below without the fake tracking anything.
      () => ({
        schema_version: SCHEMA,
        say: 'Here it is.',
        ask: { groups: [{ key: 'a', title: 'A', options: [{ key: 'x', label: 'X', detail: '' }, { key: 'y', label: 'Y', detail: '' }] }] },
        result: { title: 'Both at once', meta: '', artefact: {} },
      }),
      () =>
        result('Corrected.', {
          title: 'Repaired template',
          meta: 'template · en_US',
          artefact: {
            kind: 'template',
            name: 'Repaired template',
            locale: 'en_US',
            document: { subject: 'Repaired', blocks: [{ block: 'email.heading', data: { text: 'Repaired' } }] },
          },
        }),
    ],
  },
  {
    key: 'refused',
    match: /a table I cannot read/i,
    replies: [
      () =>
        calls('Trying to read that table.', [
          {
            id: 'c1',
            tool: 'read_rows',
            args: { connectionId: 'conn_does_not_exist', table: 'main.secrets' },
            step: step('database', 'Read the rows', 'main.secrets'),
          },
        ]),
      () =>
        result('I could not read that table, so the draft leaves those figures out.', {
          title: 'Partial template',
          meta: 'template · en_US',
          warning: 'One source was refused: the draft does not include it.',
          artefact: {
            kind: 'template',
            name: 'Partial template',
            locale: 'en_US',
            document: { subject: 'Partial', blocks: [{ block: 'email.heading', data: { text: 'Partial' } }] },
          },
        }),
    ],
  },
];

/**
 * The page each context's primary scenario belongs to, by the English page
 * label the system prompt opens with.
 *
 * THE FALLBACK EXISTS FOR ARABIC. A scenario is normally chosen by matching
 * what the person typed — and the a11y spec runs the same flows with the UI in
 * `ar_EG`, where a suggestion chip's text is Arabic and no English regex can
 * match it. The page label in the prompt is English by design (the model is
 * told the page in English and answers in the operator's language), so it is
 * the one locale-independent handle a scripted provider has.
 */
const PAGE_SCENARIOS = [
  [/"Email templates"/, 'email'],
  [/"Invoice builder"|"Invoices"/, 'invoice'],
  [/"Report builder"/, 'report'],
];

/** The scenario whose `match` any user message satisfies, and where it started. */
function findScenario(messages) {
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (message?.role !== 'user') continue;
    const text = String(message.content ?? '');
    const scenario = SCENARIOS.find((candidate) => candidate.match.test(text));
    if (scenario !== undefined) return { scenario, at: i };
  }
  // Nothing matched what was typed: fall back to the page it was typed on.
  const system = messages.find((message) => message?.role === 'system');
  const label = String(system?.content ?? '');
  const key = PAGE_SCENARIOS.find(([pattern]) => pattern.test(label))?.[1];
  const scenario = SCENARIOS.find((candidate) => candidate.key === key);
  if (scenario === undefined) return null;
  // The conversation starts at its first message, whatever language it is in.
  return { scenario, at: -1 };
}

/** The scripted reply for this conversation, as the JSON text a provider would return. */
export function replyFor(messages) {
  const found = findScenario(messages);
  if (found === null) {
    return JSON.stringify({
      schema_version: SCHEMA,
      say: 'I do not have a scripted answer for that.',
    });
  }
  const after = messages.slice(found.at + 1).filter((message) => message.role === 'assistant').length;
  const script = found.scenario.replies[Math.min(after, found.scenario.replies.length - 1)];
  const reply = typeof script === 'function' ? script(messages) : script;
  return JSON.stringify(reply);
}

// ─── the server ──────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createFakeLlmServer() {
  return createServer((req, res) => {
    const url = String(req.url ?? '');
    if (req.method === 'GET' && url.startsWith('/v1/models')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'fake' }] }));
      return;
    }
    if (req.method === 'POST' && url.startsWith('/v1/chat/completions')) {
      void readBody(req).then((raw) => {
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: { message: 'not json' } }));
          return;
        }
        const messages = Array.isArray(body?.messages) ? body.messages : [];
        // The system message travels: it is the only English thing in an
        // Arabic conversation, and `findScenario` falls back to the page label
        // in it. Scenario matching still prefers what the person typed.
        const content = replyFor(messages);
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            choices: [{ message: { content } }],
            // Plausible, not measured: the modal shows a token count and a
            // zero there would look like a bug rather than a fake.
            usage: { prompt_tokens: 400 + messages.length * 50, completion_tokens: content.length },
          }),
        );
      });
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { message: `no route: ${req.method ?? ''} ${url}` } }));
  });
}

// ─── the self-test ───────────────────────────────────────────────────────────

/**
 * Replay every scenario against the real turn contract.
 *
 * It walks each script the way the runner would — an assistant message per
 * reply, a scripted tool result after a `calls` move — and parses every reply
 * with `parseAssistantTurn`. The repair scenario is expected to fail ONCE and
 * then succeed; anything else failing is a broken script, and a script that
 * breaks silently is a spec that passes for the wrong reason.
 */
async function selfTest() {
  const { parseAssistantTurn, assistantToolResultsMessage } = await import('@adminium/llm');
  /** The results the scripts read back — enough shape for the report scenario. */
  const FAKE_RESULTS = {
    list_connections: { connections: [{ id: 'conn_1', name: 'northwind', tables: ['main.orders'] }] },
    describe_schema: { tables: [{ id: 'main.orders', columns: [{ name: 'status', type: 'text', personalData: false }] }] },
    list_documents: { documents: [{ id: 'doc_1', kind: 'template', name: 'Standard invoice' }] },
    aggregate: { table: 'main.orders', shape: 'categorical', data: { items: [{ label: 'a', value: 3 }], total: 3 } },
    read_rows: null,
  };

  let failures = 0;
  for (const scenario of SCENARIOS) {
    const messages = [{ role: 'user', content: scenarioOpener(scenario) }];
    let repairs = 0;
    for (let round = 0; round < scenario.replies.length + 2; round += 1) {
      const text = replyFor(messages);
      const parsed = parseAssistantTurn(text);
      messages.push({ role: 'assistant', content: text });
      if (!parsed.ok) {
        if (scenario.key === 'repair' && repairs === 0) {
          repairs += 1;
          messages.push({ role: 'user', content: JSON.stringify({ repair: parsed.errors.map((e) => e.message) }) });
          continue;
        }
        failures += 1;
        console.error(`✗ ${scenario.key}: reply ${String(round)} is not a valid turn — ${parsed.errors.map((e) => e.message).join('; ')}`);
        break;
      }
      const turn = parsed.turn;
      if (turn.result !== undefined) {
        console.log(`✓ ${scenario.key}: ${String(round + 1)} replies, ends in a result (${turn.result.title})`);
        break;
      }
      if (turn.ask !== undefined) {
        messages.push({ role: 'user', content: JSON.stringify({ picks: { tpl: 'standard' }, labels: { tpl: 'Standard invoice' } }) });
        continue;
      }
      if (turn.calls !== undefined) {
        messages.push({
          role: 'user',
          content: assistantToolResultsMessage(
            turn.calls.map((call) => {
              const scripted = FAKE_RESULTS[call.tool];
              return scripted === null || scripted === undefined
                ? { id: call.id, tool: call.tool, ok: false, error: { code: 'TABLE_FORBIDDEN', message: 'no' } }
                : { id: call.id, tool: call.tool, ok: true, result: scripted };
            }),
          ),
        });
        continue;
      }
      failures += 1;
      console.error(`✗ ${scenario.key}: reply ${String(round)} made no move and is not a result`);
      break;
    }
  }

  // The report scenario's whole point: a descriptor a re-run can execute.
  const report = SCENARIOS.find((entry) => entry.key === 'report');
  const replayed = await replayReport(report, FAKE_RESULTS);
  if (replayed === null) {
    failures += 1;
    console.error('✗ report: the result carries no `sources` descriptor to re-run');
  } else {
    console.log(
      `✓ report: sources[0] names ${String(replayed.connectionId)}, ${String(replayed.table)} grouped by ${String(replayed.groupBy)} — read from the schema, not guessed`,
    );
  }

  if (failures > 0) {
    console.error(`fake-llm --self-test: ${String(failures)} failure(s)`);
    process.exitCode = 1;
    return;
  }
  console.log(`fake-llm --self-test: ${String(SCENARIOS.length)} scenarios replayed, every reply a valid turn`);
}

/** The text a scenario's `match` was written for — its own regex, made literal. */
function scenarioOpener(scenario) {
  switch (scenario.key) {
    case 'email':
      return 'Draft a reminder for an unpaid invoice';
    case 'invoice':
      return 'Create an invoice for a customer for last month';
    case 'report':
      return 'Which customers take the most support time? You pick the sources';
    case 'repair':
      return 'Do a repair round, please';
    case 'refused':
      return 'Use a table I cannot read';
    default:
      return '';
  }
}

/** Walk the report script to its result and pull the re-runnable descriptor out. */
async function replayReport(scenario, results) {
  const { parseAssistantTurn, assistantToolResultsMessage } = await import('@adminium/llm');
  const messages = [{ role: 'user', content: scenarioOpener(scenario) }];
  for (let round = 0; round < 8; round += 1) {
    const text = replyFor(messages);
    const parsed = parseAssistantTurn(text);
    if (!parsed.ok) return null;
    messages.push({ role: 'assistant', content: text });
    const turn = parsed.turn;
    if (turn.result !== undefined) {
      const source = Array.isArray(turn.result.artefact.sources) ? turn.result.artefact.sources[0] : undefined;
      const descriptor = source?.descriptor;
      if (descriptor === undefined) return null;
      return {
        connectionId: descriptor.connectionId,
        table: `${descriptor.source.schema}.${descriptor.source.name}`,
        groupBy: descriptor.groupBy?.[0],
      };
    }
    if (turn.calls === undefined) return null;
    messages.push({
      role: 'user',
      content: assistantToolResultsMessage(
        turn.calls.map((call) => ({ id: call.id, tool: call.tool, ok: true, result: results[call.tool] })),
      ),
    });
  }
  return null;
}

// ─── entry point ─────────────────────────────────────────────────────────────

// Only when RUN, never when imported: `e2e-server.mjs` pulls
// `createFakeLlmServer` out of here and starts it on its own port.
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain && process.argv.includes('--self-test')) {
  await selfTest();
} else if (isMain) {
  const port = Number(process.env.FAKE_LLM_PORT ?? 4712);
  createFakeLlmServer().listen(port, '127.0.0.1', () => {
    console.log(`[fake-llm] listening on http://127.0.0.1:${String(port)}/v1`);
  });
}
