// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A webhook step's header value is a secret: sealed when a rule is saved,
 * never sent back, opened only when the request goes out (`actions/webhook.ts`).
 *
 * It was stored as typed, in a field named `headerValueEncrypted`, and every
 * read of the rule — the list, the editor, an export — carried it back in plain
 * text. Now:
 *
 * - the editor sends a NEW value as `headerValue` (write-only). A step that
 *   sends none keeps the value stored for the same step id while its URL names
 *   the same origin; a step pointed at another host, or whose header name is
 *   cleared, keeps none;
 * - `headerValueEncrypted` is only ever written here, sealed with the webhook
 *   key; a client's copy of it is ignored, except plain text from an API client
 *   written before `headerValue` existed, which is sealed like a new value;
 * - every reply carries `headerValueSet` instead, and `headerValueEncrypted:
 *   null`;
 * - values stored in plain text before this are sealed once, at boot
 *   ({@link sealStoredWebhookSecrets}) — the meta migrations hold no key.
 */
import { automationsRepo, type AutomationGraph, type AutomationNode, type MetaDb } from '@adminium/meta';

import { encryptSecret, isEncryptedSecret } from '../config/secrets.js';
import { literalOrigin, webhookSecretKey } from './actions/webhook.js';

type ActionNode = Extract<AutomationNode, { kind: 'action' }>;
type WebhookAction = Extract<ActionNode['action'], { kind: 'webhook' }>;

/** Every node of a graph with each webhook step passed through `step`. */
function mapWebhooks(graph: AutomationGraph, step: (action: WebhookAction, nodeId: string) => WebhookAction): AutomationGraph {
  const visit = <N extends AutomationNode>(node: N): N => {
    if (node.kind === 'action' && node.action.kind === 'webhook') {
      return { ...node, action: step(node.action, node.id) };
    }
    if (node.kind === 'branch') {
      return {
        ...node,
        branches: node.branches.map((branch) => ({ ...branch, nodes: branch.nodes.map((child) => visit(child)) })) as typeof node.branches,
      };
    }
    return node;
  };
  return { ...graph, nodes: graph.nodes.map((node) => visit(node)) };
}

/** The sealed value and the origin it was saved for, of each webhook step, by step id. */
function storedValues(graph: AutomationGraph | null): Map<string, { sealed: string | null; origin: string | null }> {
  const out = new Map<string, { sealed: string | null; origin: string | null }>();
  if (graph !== null) {
    mapWebhooks(graph, (action, nodeId) => {
      out.set(nodeId, { sealed: action.headerValueEncrypted, origin: literalOrigin(action.url) });
      return action;
    });
  }
  return out;
}

/**
 * The graph to store: every webhook step's value sealed, kept, or dropped, and
 * the wire-only fields gone.
 */
export function sealWebhookSecrets(graph: AutomationGraph, stored: AutomationGraph | null, masterSecret: string): AutomationGraph {
  const kept = storedValues(stored);
  let key: Buffer | undefined;
  const seal = (value: string): string => encryptSecret(value, (key ??= webhookSecretKey(masterSecret)));
  return mapWebhooks(graph, (action, nodeId) => {
    const { headerValue, headerValueSet: _set, ...rest } = action;
    let sealed: string | null;
    if (rest.headerName === null || rest.headerName.trim() === '') sealed = null;
    else if (headerValue !== undefined) sealed = headerValue === '' ? null : seal(headerValue);
    else if (rest.headerValueEncrypted !== null && !isEncryptedSecret(rest.headerValueEncrypted)) sealed = seal(rest.headerValueEncrypted);
    else {
      // Kept only for the host it was given for: a step pointed somewhere else
      // must be given its value again, or anyone who may edit the rule could
      // send the stored token to a host of their choosing.
      const stored = kept.get(nodeId);
      const origin = literalOrigin(rest.url);
      sealed = stored !== undefined && origin !== null && stored.origin === origin ? stored.sealed : null;
    }
    return { ...rest, headerValueEncrypted: sealed };
  });
}

/** The graph as a reply carries it: whether each step has a value, never the value. */
export function redactWebhookSecrets(graph: AutomationGraph): AutomationGraph {
  return mapWebhooks(graph, (action) => {
    const { headerValue: _value, ...rest } = action;
    return { ...rest, headerValueEncrypted: null, headerValueSet: action.headerValueEncrypted !== null };
  });
}

/**
 * Seal every value stored in plain text. Idempotent: a rule holding only sealed
 * values (or none) is not written, and its `updatedAt` is kept.
 */
export async function sealStoredWebhookSecrets(meta: MetaDb, masterSecret: string): Promise<number> {
  const rules = automationsRepo(meta);
  let sealed = 0;
  const failed: { id: string; error: unknown }[] = [];
  for (const rule of await rules.list()) {
    let plain = false;
    mapWebhooks(rule.graph, (action) => {
      if (action.headerValueEncrypted !== null && !isEncryptedSecret(action.headerValueEncrypted)) plain = true;
      return action;
    });
    if (!plain) continue;
    try {
      await rules.update(rule.id, { graph: sealWebhookSecrets(rule.graph, rule.graph, masterSecret) }, rule.updatedAt);
      sealed += 1;
    } catch (error) {
      // One rule that cannot be sealed must not leave the rest in the clear.
      failed.push({ id: rule.id, error });
    }
  }
  if (failed.length > 0) {
    throw new AggregateError(
      failed.map((entry) => entry.error),
      `sealed ${String(sealed)} rule(s); could not seal ${failed.map((entry) => entry.id).join(', ')}`,
    );
  }
  return sealed;
}
