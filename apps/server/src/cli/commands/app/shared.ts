// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What every `adminium app …` command shares: finding the project, and
 * printing a check's findings the way `adminium check` prints its own.
 */

import type { AppCheck, AppFinding } from '../../../project/apps/check-app.js';
import { findProject, type ProjectLocation } from '../../../project/locate.js';
import type { CommandContext } from '../../command.js';
import { CliError } from '../../exit.js';

export function requireProject(ctx: Pick<CommandContext, 'deps'>, command: string): ProjectLocation {
  const project = findProject(ctx.deps.cwd, ctx.deps.env);
  if (project === null) {
    throw new CliError(`adminium app ${command} runs inside a project, and this folder is not in one.`, {
      hint: 'Create one with  adminium new <name>',
    });
  }
  return project;
}

const MARK = { error: '✗', warn: '!', note: '·' } as const;

export function findingLine(finding: AppFinding): string {
  const where = finding.path === '' ? finding.file : `${finding.file}: ${finding.path}`;
  return `${MARK[finding.level]} ${where} — ${finding.message}`;
}

export const hasErrors = (check: AppCheck): boolean => check.findings.some((finding) => finding.level === 'error');

/** Print a check: problems to stderr, the rest to stdout, then what the customer side may reach. */
export function printCheck(io: CommandContext['io'], check: AppCheck): void {
  for (const finding of check.findings) {
    if (finding.level === 'note') io.out(findingLine(finding));
    else io.err(findingLine(finding));
  }
  if (hasErrors(check) || check.manifest === null) return;
  const manifest = check.manifest;
  const tables = manifest.requiredSchema.tables.length;
  io.out(
    `✓ ${manifest.name} ${manifest.version} (${check.key}): ${String(tables)} table(s), ${String(manifest.pages.length)} page(s), ` +
      (check.sides.length === 0 ? 'no screens of its own' : `${check.sides.join(' and ')} side`),
  );
  if (check.access.length === 0) {
    io.out('✓ the customer side reaches nothing: the manifest grants no public access');
  } else {
    io.out('✓ the customer side may reach only this:');
    for (const line of check.access) io.out(`    ${line}`);
  }
}
