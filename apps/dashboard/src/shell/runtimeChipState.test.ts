/**
 * §8.1's four chip states and the precedence between them
 * (`shell/runtimeChipState.ts`).
 */
import { describe, expect, it } from 'vitest';

import { runtimeChipState, unreachableRemotes, type ConnectionHealth } from './runtimeChipState.js';

const local: ConnectionHealth = { name: 'notes.sqlite', engine: 'sqlite', sourceKind: 'dsn', status: 'connected' };
const remote: ConnectionHealth = { name: 'prod-db', engine: 'postgres', sourceKind: 'dsn', status: 'connected' };
const remoteDown: ConnectionHealth = { ...remote, status: 'error' };
const schemaFile: ConnectionHealth = { name: 'schema.prisma', engine: 'postgres', sourceKind: 'schema-file', status: 'unconfigured' };

describe('runtimeChipState — the desktop-only rule', () => {
  it('shows no chip on self-host, whatever the connections say', () => {
    expect(runtimeChipState({ runtime: 'self-host', connections: [remoteDown], lanShare: true })).toBeNull();
  });

  it('shows a chip on desktop even with no connections at all (first run)', () => {
    expect(runtimeChipState({ runtime: 'desktop', connections: [], lanShare: false })).toBe('local');
  });
});

/**
 * REGRESSION. `GET /api/v1/connections` needs the Admin-only
 * `system:connections:manage`, and the topbar renders for every signed-in user —
 * so for an Editor, a Viewer, or any §8.3 LAN user the poll is a permanent 403
 * and `connections` is null forever. An earlier cut defaulted that to `[]` and
 * printed a confident `Local` over an unreachable remote Postgres.
 */
describe('runtimeChipState — unknown health is not empty health', () => {
  it('draws no chip when the health answer is unknown', () => {
    expect(runtimeChipState({ runtime: 'desktop', connections: null, lanShare: false })).toBeNull();
  });

  it('does not let LAN share manufacture a chip without health', () => {
    expect(runtimeChipState({ runtime: 'desktop', connections: null, lanShare: true })).toBeNull();
  });

  it('still says Local for an empty list — that is a real answer, not a missing one', () => {
    expect(runtimeChipState({ runtime: 'desktop', connections: [], lanShare: false })).toBe('local');
  });
});

describe('runtimeChipState — §8.1 rows', () => {
  it('local: SQLite only, no sharing', () => {
    expect(runtimeChipState({ runtime: 'desktop', connections: [local], lanShare: false })).toBe('local');
  });

  it('lan-share: the toggle is on', () => {
    expect(runtimeChipState({ runtime: 'desktop', connections: [local], lanShare: true })).toBe('lan-share');
  });

  it('remote-db: a reachable Postgres/MySQL source', () => {
    expect(runtimeChipState({ runtime: 'desktop', connections: [local, remote], lanShare: false })).toBe('remote-db');
  });

  it('remote-db-offline: that source failed its last test', () => {
    expect(runtimeChipState({ runtime: 'desktop', connections: [local, remoteDown], lanShare: false })).toBe(
      'remote-db-offline',
    );
  });
});

describe('runtimeChipState — what counts as remote', () => {
  /**
   * §2.1: local SQLite files under `<dataDir>`. A SQLite source can be many
   * things, but never a machine that went away.
   */
  it('never calls SQLite remote, whatever its status', () => {
    expect(runtimeChipState({ runtime: 'desktop', connections: [{ ...local, status: 'error' }], lanShare: false })).toBe(
      'local',
    );
  });

  /**
   * A schema-file import has no live database to be offline — flagging one as
   * an unreachable remote DB would put a warn chip in the topbar of an app that
   * is working perfectly.
   */
  it('never calls a schema-file import remote', () => {
    expect(runtimeChipState({ runtime: 'desktop', connections: [schemaFile], lanShare: false })).toBe('local');
    expect(
      runtimeChipState({ runtime: 'desktop', connections: [{ ...schemaFile, status: 'error' }], lanShare: false }),
    ).toBe('local');
  });

  it('treats an unconfigured remote as present but not down', () => {
    expect(
      runtimeChipState({ runtime: 'desktop', connections: [{ ...remote, status: 'unconfigured' }], lanShare: false }),
    ).toBe('remote-db');
  });
});

describe('runtimeChipState — precedence', () => {
  it('reports the problem ahead of LAN sharing', () => {
    expect(runtimeChipState({ runtime: 'desktop', connections: [remoteDown], lanShare: true })).toBe(
      'remote-db-offline',
    );
  });

  it('reports the problem ahead of a healthy sibling remote', () => {
    expect(runtimeChipState({ runtime: 'desktop', connections: [remote, remoteDown], lanShare: false })).toBe(
      'remote-db-offline',
    );
  });

  it('reports LAN sharing ahead of a healthy remote', () => {
    expect(runtimeChipState({ runtime: 'desktop', connections: [remote], lanShare: true })).toBe('lan-share');
  });
});

describe('unreachableRemotes', () => {
  it('names the down remotes so the chip can say which', () => {
    expect(unreachableRemotes([local, remote, remoteDown, schemaFile]).map((c) => c.name)).toEqual(['prod-db']);
  });

  it('is empty when everything is fine', () => {
    expect(unreachableRemotes([local, remote])).toEqual([]);
  });
});
