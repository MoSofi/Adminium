// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Structural edits over a block list (39-email-templates-and-campaigns.md
 * §3.6 `model/ops.ts`; the comp's `applyOp`, 1317-1323): insert, delete,
 * move. The SAME op is applied locally and, when the operator says so, queued
 * for the sibling variations to ride the next save (D1) — the server's
 * `applyMirrorOps` is this function with `cloneIds: true`.
 *
 * Indexes are clamped, never rejected: a sibling with fewer blocks still gets
 * the insert at its end, which is what "apply to the other languages" means.
 */
import type { EmailBlockRecord, EmailMirrorOp } from '../api.js';

/** A block id the dashboard mints for a new or cloned block (the server keeps ids it is given). */
export function newBlockId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return `b_${out}`;
}

function clamp(index: number, max: number): number {
  return Math.max(0, Math.min(index, max));
}

export function cloneBlock(block: EmailBlockRecord): EmailBlockRecord {
  return { ...structuredClone(block), id: newBlockId() };
}

/** Applies one op to a copy of `blocks`; `cloneIds` mints fresh ids for inserted blocks. */
export function applyBlockOp(blocks: readonly EmailBlockRecord[], op: EmailMirrorOp, cloneIds = false): EmailBlockRecord[] {
  const next = [...blocks];
  switch (op.kind) {
    case 'insert': {
      const raw = op.block as Partial<EmailBlockRecord>;
      const block: EmailBlockRecord = {
        id: cloneIds || typeof raw.id !== 'string' || raw.id === '' ? newBlockId() : raw.id,
        block: typeof raw.block === 'string' ? raw.block : '',
        data: typeof raw.data === 'object' && raw.data !== null ? structuredClone(raw.data) : {},
        style: typeof raw.style === 'object' && raw.style !== null ? structuredClone(raw.style) : {},
      };
      next.splice(clamp(op.index, next.length), 0, block);
      return next;
    }
    case 'delete': {
      if (op.index >= 0 && op.index < next.length) next.splice(op.index, 1);
      return next;
    }
    case 'move': {
      if (op.from < 0 || op.from >= next.length) return next;
      const [moved] = next.splice(op.from, 1);
      if (moved === undefined) return next;
      next.splice(clamp(op.to, next.length), 0, moved);
      return next;
    }
  }
}
