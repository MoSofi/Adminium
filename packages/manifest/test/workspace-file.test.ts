// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The workspace file's own document: strict, one entry per app key, a floor
 * no lower than the first Adminium that reads it, and a newer format refused
 * as "needs Adminium X" rather than as broken.
 */
import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_FILE_FLOOR,
  readWorkspaceFile,
  validateManifest,
  workspaceFileFloor,
  workspaceFileKey,
  workspaceFileName,
  workspaceFileSchema,
  workspaceStubManifest,
} from '../src/index.js';

const FINGERPRINT = `sha512-${'A'.repeat(86)}==`;

function document(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    name: 'Fernhill Coffee',
    savedAt: '2026-11-04T10:00:00.000Z',
    label: 'Fernhill main',
    adminiumVersion: '0.3.49',
    minAdminiumVersion: '0.3.49',
    apps: [
      { file: 'apps/fernhill-ops-1.1.0.tgz', key: 'fernhill-ops', version: '1.1.0', integrity: FINGERPRINT, database: { name: 'fernhill', engine: 'postgres' } },
      { file: 'apps/suppliers-1.0.0.tgz', key: 'suppliers', version: '1.0.0', integrity: FINGERPRINT, database: { name: 'suppliers', engine: 'sqlite' } },
    ],
    ...over,
  };
}

describe('workspace.json', () => {
  it('reads a well-formed document', () => {
    const read = readWorkspaceFile(document(), '0.3.49');
    expect(read.ok).toBe(true);
  });

  it('is strict: an unknown field is refused, at the top and in an app', () => {
    expect(workspaceFileSchema.safeParse(document({ extra: 1 })).success).toBe(false);
    const apps = [{ ...(document()['apps'] as object[])[0], instance: true }];
    expect(workspaceFileSchema.safeParse(document({ apps })).success).toBe(false);
  });

  it('holds each key once, names each member by key and version, and at most eight apps', () => {
    const one = (document()['apps'] as Record<string, unknown>[])[0]!;
    expect(workspaceFileSchema.safeParse(document({ apps: [one, one] })).success).toBe(false);
    expect(workspaceFileSchema.safeParse(document({ apps: [{ ...one, file: 'apps/other-1.1.0.tgz' }] })).success).toBe(false);
    expect(workspaceFileSchema.safeParse(document({ apps: [{ ...one, file: '../x.tgz' }] })).success).toBe(false);
    const nine = Array.from({ length: 9 }, (_, i) => ({ ...one, key: `app-${String(i)}`, file: `apps/app-${String(i)}-1.1.0.tgz` }));
    expect(workspaceFileSchema.safeParse(document({ apps: nine })).success).toBe(false);
    expect(workspaceFileSchema.safeParse(document({ apps: nine.slice(0, 8) })).success).toBe(true);
    expect(workspaceFileSchema.safeParse(document({ apps: [] })).success).toBe(false);
  });

  it('takes a fingerprint only as sha512- and base64', () => {
    const one = (document()['apps'] as Record<string, unknown>[])[0]!;
    expect(workspaceFileSchema.safeParse(document({ apps: [{ ...one, integrity: 'a'.repeat(64) }] })).success).toBe(false);
  });

  it('never asks for less than the first Adminium that reads workspace files', () => {
    expect(workspaceFileSchema.safeParse(document({ minAdminiumVersion: '0.3.40' })).success).toBe(false);
  });

  it('refuses a floor above this server as "needs Adminium X"', () => {
    expect(readWorkspaceFile(document({ minAdminiumVersion: '0.9.0' }), '0.3.49')).toEqual({ ok: false, reason: 'REQUIRES_NEWER_ADMINIUM', minAdminiumVersion: '0.9.0' });
  });

  it('refuses another format the same way, by the floor it gives, even when the rest is unreadable', () => {
    expect(readWorkspaceFile({ v: 2, minAdminiumVersion: '0.5.0', whatever: true }, '0.3.49')).toEqual({ ok: false, reason: 'REQUIRES_NEWER_ADMINIUM', minAdminiumVersion: '0.5.0' });
    expect(readWorkspaceFile({ v: 2 }, '0.3.49')).toMatchObject({ ok: false, reason: 'REQUIRES_NEWER_ADMINIUM' });
  });

  it('calls a broken document of this format invalid, with its issues', () => {
    const read = readWorkspaceFile(document({ name: '' }), '0.3.49');
    expect(read).toMatchObject({ ok: false, reason: 'WORKSPACE_FILE_INVALID' });
  });

  it('reads the floor leniently', () => {
    expect(workspaceFileFloor({ minAdminiumVersion: '1.2.3' })).toBe('1.2.3');
    expect(workspaceFileFloor({ minAdminiumVersion: 3 })).toBeNull();
    expect(workspaceFileFloor(null)).toBeNull();
  });
});

describe('the file name and the stub manifest', () => {
  it('makes a key of the workspace name, or a dated one', () => {
    expect(workspaceFileKey('Fernhill Coffee', '2026-11-04T10:00:00.000Z')).toBe('fernhill-coffee');
    expect(workspaceFileKey('Café Ñandú', '2026-11-04T10:00:00.000Z')).toBe('cafe-nandu');
    expect(workspaceFileKey('咖啡', '2026-11-04T10:00:00.000Z')).toBe('workspace-2026-11-04');
    expect(workspaceFileKey('7 Seas', '2026-11-04T10:00:00.000Z')).toBe('seas');
    expect(workspaceFileName('Fernhill Coffee', '2026-11-04T10:00:00.000Z')).toBe('fernhill-coffee.workspace.tgz');
  });

  it('is no app manifest: an older Adminium fails to validate it and reads only its floor', () => {
    const stub = workspaceStubManifest('fernhill-coffee', WORKSPACE_FILE_FLOOR);
    expect(validateManifest(stub).ok).toBe(false);
    expect(stub.compatibility.minAdminiumVersion).toBe(WORKSPACE_FILE_FLOOR);
  });
});
