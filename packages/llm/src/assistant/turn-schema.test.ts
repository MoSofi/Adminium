// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import {
  ASSISTANT_ACTION_KINDS,
  ASSISTANT_DRAFT_WITH_PROPOSAL_MESSAGE,
  ASSISTANT_MAX_ACTIONS_PER_PROPOSAL,
  ASSISTANT_MAX_ARTEFACT_ERRORS,
  ASSISTANT_NO_PROPOSE_MESSAGE,
  ASSISTANT_PROPOSAL_NEEDS_DRAFT_MESSAGE,
  ASSISTANT_SCHEMA_VERSION,
  ASSISTANT_STEP_ICON_FALLBACK,
  assistantArtefactErrorsMessage,
  assistantMoveOf,
  assistantOpenDocumentMessage,
  assistantPicksMessage,
  assistantStepEventMessage,
  assistantProposableKinds,
  assistantToolResultsMessage,
  assistantTurnSchemaFor,
  assistantTurnV1,
  parseAssistantTurn,
  readAssistantStepEvent,
  type AssistantStepEvent,
} from './turn-schema.js';

const V = ASSISTANT_SCHEMA_VERSION;

const step = { icon: 'database', label: 'Read the invoices table', detail: 'Last month, unpaid' };

/** One example reply per move, written against the replacements the copy deck uses. */
const CALLS = {
  schema_version: V,
  say: 'Let me look at the templates first.',
  calls: [
    { id: 'c1', tool: 'list_documents', args: { kind: 'template' }, step },
    { id: 'c2', tool: 'describe_schema', args: { connectionId: 'conn_1', tables: ['invoices'] }, step },
  ],
};

const ASK = {
  schema_version: V,
  say: 'Which template should I use, and where do the lines come from?',
  ask: {
    groups: [
      {
        key: 'tpl',
        title: 'Template',
        options: [
          { key: 't1', label: 'Standard', detail: 'Your default layout' },
          { key: 't2', label: 'EU reverse charge', detail: 'VAT 0 % with the legal note' },
        ],
      },
      {
        key: 'src',
        title: 'Pull line items from',
        options: [
          { key: 's1', label: 'time_entries', detail: '38 rows in range' },
          { key: 's2', label: 'order_lines', detail: '12 rows in range' },
        ],
      },
    ],
    readyLabel: 'Ready — 38 entries in range',
    goLabel: 'Draft the invoice',
  },
};

const RESULT = {
  schema_version: V,
  say: 'Here is a reminder for an unpaid invoice.',
  result: {
    title: 'Unpaid invoice reminder',
    meta: 'New template · based on Reminder',
    workTitle: 'Drafted a new email template',
    basedOn: 'tpl_01J0000000000000000000000A',
    artefact: { kind: 'template', name: 'Unpaid invoice reminder', locale: 'en_US', document: { subject: 'Hi', blocks: [] } },
    warning: 'The due date is empty on a few rows; I fell back to "soon".',
    details: [{ label: 'Tone', value: 'Friendly, one call to action' }],
    checks: ['Every variable exists on the base template'],
    followups: ['Make it shorter', 'Add a German variation'],
  },
};

const ANSWER = { schema_version: V, say: 'You have 12 templates, 3 of them drafts.' };

describe('assistantTurnV1 — the four moves', () => {
  it.each([
    ['calls', CALLS],
    ['ask', ASK],
    ['result', RESULT],
    ['answer', ANSWER],
  ] as const)('accepts a %s reply and names its move', (move, reply) => {
    const parsed = parseAssistantTurn(JSON.stringify(reply));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(assistantMoveOf(parsed.turn)).toBe(move);
  });

  it('refuses a reply that makes two moves at once', () => {
    const parsed = parseAssistantTurn(JSON.stringify({ ...CALLS, result: RESULT.result }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors.map((e) => e.code)).toEqual(['LLM_SCHEMA_INVALID']);
      expect(parsed.errors[0]?.message).toMatch(/at most one of calls, ask and result/);
    }
  });

  it('refuses an over-long say, with the path of the field', () => {
    const parsed = parseAssistantTurn(JSON.stringify({ ...ANSWER, say: 'x'.repeat(2001) }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors[0]).toMatchObject({ code: 'LLM_SCHEMA_INVALID', path: 'say', severity: 'fatal' });
  });

  it('reports a nested failure with a JSON path the model can act on', () => {
    const broken = structuredClone(ASK);
    (broken.ask.groups[1] as { options: unknown[] }).options = [broken.ask.groups[1]?.options[0]];
    const parsed = parseAssistantTurn(JSON.stringify(broken));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors[0]?.path).toBe('ask.groups[1].options');
  });

  it('bounds the lists: nine calls, four groups, four follow-ups are each refused', () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({ ...CALLS.calls[0], id: `c${i}` }));
    expect(assistantTurnV1.safeParse({ ...CALLS, calls: nine }).success).toBe(false);
    const fourGroups = { ...ASK, ask: { groups: [...ASK.ask.groups, ...ASK.ask.groups] } };
    expect(assistantTurnV1.safeParse(fourGroups).success).toBe(false);
    const fourFollowups = { ...RESULT, result: { ...RESULT.result, followups: ['a', 'b', 'c', 'd'] } };
    expect(assistantTurnV1.safeParse(fourFollowups).success).toBe(false);
  });

  it('an empty calls list is not a move — it is refused rather than read as an answer', () => {
    expect(assistantTurnV1.safeParse({ ...ANSWER, calls: [] }).success).toBe(false);
  });

  it('an unknown step icon falls back instead of costing a repair round', () => {
    const reply = { ...CALLS, calls: [{ ...CALLS.calls[0], step: { ...step, icon: 'rocket' } }] };
    const parsed = parseAssistantTurn(JSON.stringify(reply));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.turn.calls?.[0]?.step.icon).toBe(ASSISTANT_STEP_ICON_FALLBACK);
  });

  it('keeps the artefact open: the page, not this schema, owns the document format', () => {
    const odd = { ...RESULT, result: { ...RESULT.result, artefact: { anything: [1, { nested: true }] } } };
    expect(assistantTurnV1.safeParse(odd).success).toBe(true);
  });
});

describe('parseAssistantTurn — the stages before the schema', () => {
  it('recovers the object from fences and surrounding prose', () => {
    const parsed = parseAssistantTurn(`Sure!\n\`\`\`json\n${JSON.stringify(ANSWER)}\n\`\`\`\nHope that helps.`);
    expect(parsed.ok).toBe(true);
  });

  it('tells a truncated reply apart from an unparseable one', () => {
    const cut = JSON.stringify(RESULT).slice(0, 80);
    const truncated = parseAssistantTurn(cut);
    expect(truncated.ok).toBe(false);
    if (!truncated.ok) expect(truncated.errors[0]?.code).toBe('LLM_TRUNCATED');

    const prose = parseAssistantTurn('I cannot answer in JSON today.');
    expect(prose.ok).toBe(false);
    if (!prose.ok) expect(prose.errors[0]?.code).toBe('LLM_JSON_PARSE');
  });

  it('reports a balanced object that is still not JSON', () => {
    const parsed = parseAssistantTurn('{ schema_version: nope }');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors[0]).toMatchObject({ code: 'LLM_JSON_PARSE', path: '' });
  });

  it('refuses a missing or foreign version, with the hint that fixes it', () => {
    for (const reply of [{ say: 'hi' }, { schema_version: 'adminium.llm/v1', say: 'hi' }, { schema_version: 7, say: 'hi' }]) {
      const parsed = parseAssistantTurn(JSON.stringify(reply));
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.errors[0]).toMatchObject({ code: 'LLM_VERSION_MISMATCH', path: 'schema_version' });
        expect(parsed.errors[0]?.hint).toContain(V);
      }
    }
  });

  it('accepts a second version when the caller says it is supported', () => {
    const parsed = parseAssistantTurn(JSON.stringify({ schema_version: 'adminium.assistant/v2', say: 'hi' }), [
      V,
      'adminium.assistant/v2',
    ]);
    // The version gate passes; the v1 schema then refuses the literal — which is
    // the point: supporting a version means shipping its schema too.
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors[0]?.code).toBe('LLM_SCHEMA_INVALID');
  });

  it('shows a refusal as a refusal, even when the model dropped the rest of the contract', () => {
    const parsed = parseAssistantTurn(JSON.stringify({ error: 'I cannot help with that request.' }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors[0]).toMatchObject({ code: 'LLM_MODEL_DECLINED', path: 'error' });
      expect(parsed.errors[0]?.message).toBe('I cannot help with that request.');
    }
  });

  it('bounds a refusal sentence, which goes to the screen', () => {
    const parsed = parseAssistantTurn(JSON.stringify({ error: 'n'.repeat(900) }));
    if (!parsed.ok) expect(parsed.errors[0]?.message).toHaveLength(300);
  });

  it('reads a JSON array as an object with no version, not as a crash', () => {
    const parsed = parseAssistantTurn('{"schema_version": null}');
    expect(parsed.ok).toBe(false);
  });
});

describe('the messages the runner writes back', () => {
  it('tool results carry successes and failures side by side', () => {
    const message = assistantToolResultsMessage([
      { id: 'c1', tool: 'read_rows', ok: true, result: { rows: [{ id: 1 }], total: 1 } },
      { id: 'c2', tool: 'describe_schema', ok: false, error: { code: 'TABLE_FORBIDDEN', message: 'Your role cannot read payroll.' } },
    ]);
    expect(JSON.parse(message)).toEqual({
      tool_results: [
        { id: 'c1', tool: 'read_rows', ok: true, result: { rows: [{ id: 1 }], total: 1 } },
        { id: 'c2', tool: 'describe_schema', ok: false, error: { code: 'TABLE_FORBIDDEN', message: 'Your role cannot read payroll.' } },
      ],
    });
  });

  it('picks carry the keys and the labels the operator saw', () => {
    expect(JSON.parse(assistantPicksMessage({ tpl: 't2' }, { tpl: 'EU reverse charge' }))).toEqual({
      picks: { tpl: 't2' },
      labels: { tpl: 'EU reverse charge' },
    });
  });

  it('the open document says it is unsaved', () => {
    const message = JSON.parse(assistantOpenDocumentMessage({ subject: 'Hi' })) as { open_document: unknown; note: string };
    expect(message.open_document).toEqual({ subject: 'Hi' });
    expect(message.note).toMatch(/unsaved/);
  });

  it('artefact errors are capped, and the cut is counted', () => {
    const errors = Array.from({ length: ASSISTANT_MAX_ARTEFACT_ERRORS + 5 }, (_, i) => ({
      path: `blocks[${i}].block`,
      code: 'UNKNOWN_BLOCK_KIND',
      message: 'email.hero is not a block kind.',
    }));
    const message = JSON.parse(assistantArtefactErrorsMessage(errors)) as {
      artefact_errors: unknown[];
      omitted?: number;
      instruction: string;
    };
    expect(message.artefact_errors).toHaveLength(ASSISTANT_MAX_ARTEFACT_ERRORS);
    expect(message.omitted).toBe(5);
    expect(message.instruction).toMatch(/COMPLETE turn/);

    const few = JSON.parse(assistantArtefactErrorsMessage(errors.slice(0, 2))) as { omitted?: number };
    expect(few.omitted).toBeUndefined();
  });
});

describe('step events', () => {
  const event: AssistantStepEvent = {
    kind: 'step',
    id: 'c1',
    state: 'done',
    icon: 'database',
    label: 'Read the invoices table',
    detail: '38 rows',
    tables: ['main.invoices'],
    note: { kind: 'warnings', count: 1 },
  };

  it('round-trips through a progress message', () => {
    expect(readAssistantStepEvent(assistantStepEventMessage(event))).toEqual(event);
    expect(readAssistantStepEvent(assistantStepEventMessage({ ...event, note: { kind: 'ready' } }))?.note).toEqual({ kind: 'ready' });
    expect(readAssistantStepEvent(assistantStepEventMessage({ ...event, note: null }))?.note).toBeNull();
  });

  it('answers null for anything that is not a step event', () => {
    expect(readAssistantStepEvent(undefined)).toBeNull();
    expect(readAssistantStepEvent('')).toBeNull();
    expect(readAssistantStepEvent('Reading chunk 2 of 5')).toBeNull();
    expect(readAssistantStepEvent(JSON.stringify({ kind: 'step', id: 'c1' }))).toBeNull();
    expect(readAssistantStepEvent(JSON.stringify({ ...event, state: 'paused' }))).toBeNull();
  });
});

describe('pointing at an add-on', () => {
  const reply = (suggest: unknown) => JSON.stringify({ schema_version: ASSISTANT_SCHEMA_VERSION, say: 'Not here yet.', suggest });

  it('is not a move: it rides beside an answer, on a page with a document or without one', () => {
    for (const variant of [{ document: true }, { document: false }]) {
      const parsed = parseAssistantTurn(reply(['offers']), undefined, variant);
      expect(parsed).toMatchObject({ ok: true, turn: { say: 'Not here yet.', suggest: ['offers'] } });
      if (parsed.ok) expect(assistantMoveOf(parsed.turn)).toBe('answer');
    }
  });

  it('carries keys only, three at most', () => {
    expect(parseAssistantTurn(reply(['a', 'b', 'c'])).ok).toBe(true);
    expect(parseAssistantTurn(reply(['a', 'b', 'c', 'd'])).ok).toBe(false);
    expect(parseAssistantTurn(reply([{ key: 'offers', name: 'Free money' }])).ok).toBe(false);
    expect(parseAssistantTurn(reply(['x'.repeat(81)])).ok).toBe(false);
    expect(parseAssistantTurn(reply([''])).ok).toBe(false);
  });
});

describe('a proposal', () => {
  const reply = (extra: Record<string, unknown>): string => JSON.stringify({ schema_version: 'adminium.assistant/v1', say: 'Here.', ...extra });
  const create = { do: 'row.create', connectionId: 'c1', table: 'main.customers', values: { name: 'Ada' } };
  const change = { do: 'row.change', connectionId: 'c1', table: 'main.customers', id: '7', values: { city: 'Ulm' } };
  const remove = { do: 'row.delete', connectionId: 'c1', table: 'main.customers', id: '7' };
  const draft = { title: 'Welcome', meta: '', artefact: { blocks: [] } };
  const rows = { document: false, propose: ['row.create', 'row.change'] } as const;

  it('is not a move where nothing is offered, and is refused by name', () => {
    for (const variant of [{ document: true }, { document: false }, { document: false, propose: [] }]) {
      const parsed = parseAssistantTurn(reply({ propose: { title: 'Add Ada', actions: [create] } }), undefined, variant);
      expect(parsed).toMatchObject({ ok: false, errors: [{ code: 'LLM_SCHEMA_INVALID', path: 'propose', message: ASSISTANT_NO_PROPOSE_MESSAGE }] });
    }
  });

  it('is read where it is offered, and is its own move', () => {
    const parsed = parseAssistantTurn(reply({ propose: { title: 'Add Ada', actions: [create, change] } }), undefined, rows);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(assistantMoveOf(parsed.turn)).toBe('propose');
    expect(parsed.turn.propose?.actions).toEqual([create, change]);
  });

  it('refuses a kind this page does not offer, naming what it does', () => {
    const parsed = parseAssistantTurn(reply({ propose: { title: 'Tidy', actions: [create, remove] } }), undefined, rows);
    expect(parsed).toMatchObject({ ok: false, errors: [{ path: 'propose.actions[1].do' }] });
    if (parsed.ok) return;
    expect(parsed.errors[0]?.message).toBe('"row.delete" cannot be proposed here. What can: row.create, row.change.');
  });

  it('refuses a kind that does not exist, an empty list, and one too many', () => {
    const variant = { document: false, propose: ASSISTANT_ACTION_KINDS };
    expect(parseAssistantTurn(reply({ propose: { title: 'x', actions: [{ do: 'row.truncate', table: 't' }] } }), undefined, variant).ok).toBe(false);
    expect(parseAssistantTurn(reply({ propose: { title: 'x', actions: [] } }), undefined, variant).ok).toBe(false);
    const many = Array.from({ length: ASSISTANT_MAX_ACTIONS_PER_PROPOSAL + 1 }, () => create);
    expect(parseAssistantTurn(reply({ propose: { title: 'x', actions: many } }), undefined, variant).ok).toBe(false);
    expect(parseAssistantTurn(reply({ propose: { title: 'x', actions: many.slice(1) } }), undefined, variant).ok).toBe(true);
  });

  it('refuses a row with no values, and drops what the contract does not name', () => {
    expect(parseAssistantTurn(reply({ propose: { title: 'x', actions: [{ ...create, values: {} }] } }), undefined, rows).ok).toBe(false);
    const parsed = parseAssistantTurn(reply({ propose: { title: 'x', actions: [{ ...change, seen: { city: 'Bonn' }, route: '/api/v1/roles' }] } }), undefined, rows);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.turn.propose?.actions[0]).toEqual(change);
  });

  it('is one move: not beside calls or ask', () => {
    const call = { id: 'a', tool: 'read_rows', args: {}, step: { icon: 'search', label: 'Read', detail: '' } };
    const parsed = parseAssistantTurn(reply({ calls: [call], propose: { title: 'x', actions: [create] } }), undefined, rows);
    expect(parsed).toMatchObject({ ok: false, errors: [{ message: 'Use at most one of calls, ask and propose in a single reply.' }] });
  });

  it('may travel with a draft only as the one action that saves it', () => {
    const variant = { document: true, propose: ['doc.save', 'doc.change', 'row.create'] } as const;
    const both = parseAssistantTurn(reply({ result: draft, propose: { title: 'Save it', actions: [{ do: 'doc.save' }] } }), undefined, variant);
    expect(both.ok).toBe(true);
    if (both.ok) expect(assistantMoveOf(both.turn)).toBe('result');

    const mixed = parseAssistantTurn(reply({ result: draft, propose: { title: 'x', actions: [create] } }), undefined, variant);
    expect(mixed).toMatchObject({ ok: false, errors: [{ path: 'propose.actions', message: ASSISTANT_DRAFT_WITH_PROPOSAL_MESSAGE }] });
    const twice = parseAssistantTurn(reply({ result: draft, propose: { title: 'x', actions: [{ do: 'doc.save' }, { do: 'doc.change' }] } }), undefined, variant);
    expect(twice.ok).toBe(false);

    const alone = parseAssistantTurn(reply({ propose: { title: 'x', actions: [{ do: 'doc.save' }] } }), undefined, variant);
    expect(alone).toMatchObject({ ok: false, errors: [{ path: 'propose.actions', message: ASSISTANT_PROPOSAL_NEEDS_DRAFT_MESSAGE }] });
  });

  it('offers no draft action on a page without a document, whatever was asked for', () => {
    expect(assistantProposableKinds({ document: false, propose: ['doc.save', 'doc.change', 'row.delete'] })).toEqual(['row.delete']);
    expect(assistantProposableKinds({ document: true, propose: ['send.template', 'row.create'] })).toEqual(['row.create', 'send.template']);
    expect(assistantProposableKinds({ document: true })).toEqual([]);
  });

  it('a change names no id of a document: the open one is the server\'s to know', () => {
    const variant = { document: true, propose: ['doc.change'] } as const;
    const parsed = parseAssistantTurn(reply({ result: draft, propose: { title: 'x', actions: [{ do: 'doc.change', id: 'someone-elses' }] } }), undefined, variant);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.turn.propose?.actions[0]).toEqual({ do: 'doc.change' });
  });

  it('keeps the same schema object for the same offer', () => {
    expect(assistantTurnSchemaFor({ document: false, propose: ['row.change', 'row.create'] })).toBe(assistantTurnSchemaFor(rows));
    expect(assistantTurnSchemaFor({ document: true })).toBe(assistantTurnV1);
  });
});

