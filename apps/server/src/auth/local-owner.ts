// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The owner `adminium design` made, given an address and a password.
 *
 * That owner has no password: the link `design` prints signs them in, on this
 * machine only. This is the one way they get one, and it is the same whether
 * it is asked for in the terminal (`adminium owner set`) or on the dashboard
 * (`POST /api/v1/designer/owner-password`). It works once: an owner who has a
 * password changes it under their account, which asks for the one they have.
 */
import { rolesRepo, settingsRepo, usersRepo, type MetaDb, type User } from '@adminium/meta';

import { hashPassword } from './passwords.js';

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type LocalOwnerRefusal = 'not-local' | 'has-password' | 'email' | 'email-taken' | 'password-short';

export class LocalOwnerError extends Error {
  override readonly name = 'LocalOwnerError';
  constructor(
    readonly reason: LocalOwnerRefusal,
    message: string,
  ) {
    super(message);
  }
}

/** The owner `design` made, while they are still that: null once they have a password, or were never made by it. */
export async function localOwner(meta: MetaDb): Promise<User | null> {
  const ownerId = await settingsRepo(meta).get('designer.localOwnerId');
  return ownerId === null ? null : await usersRepo(meta).findById(ownerId);
}

/**
 * The owner a host on the person's own computer signs in: the one `design`
 * made, with or without a password since. `null` for a project that never had
 * one (its owner was made at `/setup`, with a password, and signs in with it).
 */
export async function ownerOnThisComputer(meta: MetaDb): Promise<User | null> {
  const settings = settingsRepo(meta);
  const ownerId = (await settings.get('designer.localOwnerId')) ?? (await settings.get('designer.ownerId'));
  return ownerId === null ? null : await usersRepo(meta).findById(ownerId);
}

/** Whether `userId` is the owner `design` made and still has no password. */
export async function needsPassword(meta: MetaDb, userId: string | null | undefined): Promise<boolean> {
  if (userId === null || userId === undefined) return false;
  const owner = await localOwner(meta);
  return owner !== null && owner.id === userId && owner.passwordHash === null;
}

/**
 * Give the local owner their address and password. Refuses, changing
 * nothing, when there is no such owner, when they already have a password,
 * when the address is not one or is somebody else's here, or when the
 * password is shorter than the install allows.
 */
export async function setLocalOwnerCredentials(meta: MetaDb, input: { email: string; password: string }): Promise<User> {
  const settings = settingsRepo(meta);
  const users = usersRepo(meta);
  const owner = await localOwner(meta);
  if (owner === null) throw new LocalOwnerError('not-local', 'This project’s owner was not made by `adminium design`.');
  if (owner.passwordHash !== null) throw new LocalOwnerError('has-password', 'The owner already has a password.');
  const email = input.email.trim();
  if (!EMAIL.test(email) || email.length > 254) throw new LocalOwnerError('email', 'That is not an email address.');
  const taken = await users.findByEmail(email);
  if (taken !== null && taken.id !== owner.id) throw new LocalOwnerError('email-taken', `${email} is already somebody else’s address here.`);
  const minLength = await settings.get('auth.passwordMinLength');
  if (input.password.length < minLength) throw new LocalOwnerError('password-short', `A password has at least ${String(minLength)} characters.`);
  if (input.password.length > 1024) throw new LocalOwnerError('password-short', 'A password is at most 1024 characters.');

  await users.updateProfile(owner.id, { email });
  await users.updatePassword(owner.id, await hashPassword(input.password));
  // From here the project is opened by its owner's sign-in, not by the link `design` prints. Who it was made for
  // is kept: the desktop app, on this person's own computer, still opens it without asking for the password.
  await settings.set('designer.ownerId', owner.id, { updatedBy: owner.id });
  await settings.set('designer.localOwnerId', null, { updatedBy: owner.id });
  return (await users.findById(owner.id)) ?? owner;
}

/** The names of the roles an app brings: whom its preview is seen as. */
export async function appRoleNames(meta: MetaDb, appKey: string): Promise<string[]> {
  return (await rolesRepo(meta).list()).filter((role) => role.appKey === appKey).map((role) => role.name);
}
