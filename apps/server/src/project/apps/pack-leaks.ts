// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A DOWNLOADED APP FILE MUST NOT CARRY.
 *
 * The screens' Download carries the app's folder as `source/`, its sample
 * rows and its built screens: files a person wrote by hand, where a key
 * copied from the project's `.env` or an id of this server can sit. Before
 * the file is handed out, every file in it is read line by line, the way Save
 * as app reads what it writes:
 *  - the secret scan: every secret this server keeps (sealed values, webhook
 *    addresses, the project's `.env` values named as secrets, the server's
 *    own secret), found whole, in pieces, encoded or decoded
 *    (`apps/save/gates/secrets.ts`); a value known but not secret (a host, a
 *    sender address, a public site's address) refuses nothing here;
 *  - the id gate: a meta row id, a generated page id, a database's id, or a
 *    `connectionId` key in a JSON file (`apps/save/gates/ids.ts`).
 * A hit names its kind, its file and its line, never the value.
 */
import { decodeFile, bytesAsText } from '../../apps/save/gates/content.js';
import { indexSecrets, secretIn, type KnownSecret } from '../../apps/save/gates/secrets.js';
import { GENERATED_PAGE_ID_SOURCE, ROW_ID_SOURCE } from '../instance-ids.js';

export interface PackLeak {
  /** `secret`: a secret this server keeps; `id`: an id of this server. */
  kind: 'secret' | 'id';
  /** The file's path in the package (`source/src/api.ts`). */
  file: string;
  /** 1-based. */
  line: number;
}

/** The most hits one refusal lists: enough to find them, never a flood. */
export const PACK_LEAKS_MAX = 50;

const LEFTOVER = new RegExp(`${ROW_ID_SOURCE}|${GENERATED_PAGE_ID_SOURCE}`);
const CONNECTION_ID_KEY = /"connectionId"\s*:/;

export interface PackLeakScan {
  /** What `collectKnownSecrets` found on this server. */
  secrets: readonly KnownSecret[];
  /** Every database id of this server: none may be named in the file. */
  connectionIds: readonly string[];
}

/** Each line of each file that holds a secret or an id of this server, in file order; at most {@link PACK_LEAKS_MAX}. */
export function packLeaks(files: Iterable<readonly [string, Uint8Array]>, scan: PackLeakScan): PackLeak[] {
  // A hard refusal rests on real secrets only: a host or a public address named in the code is no leak.
  const index = indexSecrets(scan.secrets.filter((secret) => secret.soft !== true));
  const ids = scan.connectionIds.filter((id) => id.length >= 8);
  const out: PackLeak[] = [];
  for (const [file, bytes] of files) {
    const json = /\.json$/i.test(file) && decodeFile(file, bytes).kind === 'json';
    const lines = bytesAsText(bytes).split('\n');
    for (const [at, line] of lines.entries()) {
      if (index.byStart.size > 0 && secretIn(line, index) !== null) out.push({ kind: 'secret', file, line: at + 1 });
      else if (LEFTOVER.test(line) || ids.some((id) => line.includes(id)) || (json && CONNECTION_ID_KEY.test(line))) out.push({ kind: 'id', file, line: at + 1 });
      if (out.length >= PACK_LEAKS_MAX) return out;
    }
  }
  return out;
}
