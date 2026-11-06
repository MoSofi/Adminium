// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where each app of a workspace file stands on the review, and what the
 * footer says: pure, so the rules are tested without a screen.
 */
import type { AppInstallPlan } from '../appsApi.js';
import { unansweredClashes, unusableTables } from '../installReview.js';
import type { InstallAnswers } from '../appsApi.js';
import type { WorkspaceFile, WorkspaceFileApp } from './workspaceFilesApi.js';

/**
 * - `installed` / `updated`: done (on an earlier run, or already at that version on its database);
 * - `refused`: its own checks said no, and it is left out;
 * - `stopped`: the run stopped at it; "Install the rest" runs it again;
 * - `database`: no database chosen ("Needs a choice");
 * - `answer`: its review asks something (a page address, a table here already);
 * - `checking`: its plan is being made;
 * - `update`: ready, as an update of every copy of its key;
 * - `ready`: ready to install.
 */
export type AppStatus = 'installed' | 'updated' | 'refused' | 'stopped' | 'database' | 'answer' | 'checking' | 'update' | 'ready';

export interface AppReviewState {
  plan: AppInstallPlan | null;
  /** The plan was refused (an older file, another lineage…): the refusal's code and details. */
  planError: { code: string; message: string; details: unknown } | null;
  loading: boolean;
  pages: InstallAnswers['pages'];
  /** "Use the existing tables" pressed. */
  useExisting: boolean;
  /** Each taken table answered in the table check, by short name. */
  choices: InstallAnswers['choices'];
}

/** Whether the copy on the target already runs this version, with every other copy: nothing to do. */
export function alreadyThere(app: WorkspaceFileApp, target: string | null): boolean {
  if (target === null) return false;
  const here = app.installs.find((copy) => copy.connectionId === target);
  return here !== undefined && here.version === app.version && app.installs.every((copy) => copy.version === app.version);
}

/** A table here that nobody answered, while "Use the existing tables" is not pressed. */
function takenUnanswered(plan: AppInstallPlan, review: AppReviewState): boolean {
  if (review.useExisting) return false;
  return (plan.tables ?? []).some((table) => table.class === 'taken' && review.choices?.[table.ref] === undefined);
}

export function statusOf(app: WorkspaceFileApp, target: string | null, review: AppReviewState | undefined): AppStatus {
  if (app.state === 'installed' || app.state === 'updated' || app.state === 'refused') return app.state;
  if (target === null) return app.state === 'stopped' ? 'stopped' : 'database';
  if (alreadyThere(app, target)) return 'installed';
  if (review === undefined || review.loading) return 'checking';
  if (review.planError !== null) return 'refused';
  const plan = review.plan;
  if (plan === null) return 'checking';
  if (unusableTables(plan).length > 0 || unansweredClashes(plan, review.pages).length > 0 || takenUnanswered(plan, review)) return 'answer';
  if (!plan.installable) return 'refused';
  if (app.state === 'stopped') return 'stopped';
  return app.route === 'update' ? 'update' : 'ready';
}

/** The apps the Install button takes: ready, an update, or one the run stopped at and is ready again. */
export function goesNow(status: AppStatus): boolean {
  return status === 'ready' || status === 'update' || status === 'stopped';
}

/** How far a run got: installed or updated, of all. */
export function doneCount(file: WorkspaceFile): number {
  return file.apps.filter((app) => app.state === 'installed' || app.state === 'updated').length;
}
