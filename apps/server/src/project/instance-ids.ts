// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Finding values in a project file that only mean something on one install.
 *
 * Every `adminium_*` row id is `<prefix>_<ULID>`, and generated page ids are
 * `page_<8 hex>_<slug>`, where the hex comes from the connection id. Either
 * one in a file breaks it on every other install, because the row it names
 * does not exist there. Files name databases by their key instead
 * (`database: "main"`), so a `connectionId` key is refused as well.
 */

import { ID_PREFIXES } from '@adminium/meta';

const ULID = '[0-9A-HJKMNP-TV-Z]{26}';
const ROW_ID = new RegExp(`^(?:${Object.keys(ID_PREFIXES).join('|')})_${ULID}$`);
const GENERATED_PAGE_ID = /^page_[0-9a-f]{8}_[a-z0-9-]+$/;

export interface InstanceIdFinding {
  /** Where it is, as `config.layout.items[0].config.binding`. */
  path: string;
  message: string;
}

function describePath(parts: readonly (string | number)[]): string {
  let out = '';
  for (const part of parts) {
    if (typeof part === 'number') out += `[${String(part)}]`;
    else out += out === '' ? part : `.${part}`;
  }
  return out === '' ? '(the file)' : out;
}

/** Every value in `value` that only exists on one install. */
export function findInstanceIds(value: unknown): InstanceIdFinding[] {
  const findings: InstanceIdFinding[] = [];
  const walk = (node: unknown, parts: (string | number)[]): void => {
    if (typeof node === 'string') {
      if (ROW_ID.test(node) || GENERATED_PAGE_ID.test(node)) {
        findings.push({
          path: describePath(parts),
          message: `"${node}" is an id from one install; files name things by key or name instead`,
        });
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        walk(item, [...parts, index]);
      });
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        if (key === 'connectionId') {
          findings.push({
            path: describePath([...parts, key]),
            message: 'name the database with "database" and its key from adminium.config.ts',
          });
          continue;
        }
        walk(child, [...parts, key]);
      }
    }
  };
  walk(value, []);
  return findings;
}
