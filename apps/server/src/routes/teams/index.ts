// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Teams, and the people a writer may name.
 *
 * - `GET /teams`, `POST /teams`, `PATCH /teams/:id`, `DELETE /teams/:id`
 * - `PUT /teams/:id/members/:userId` (`{ lead }`), `DELETE` the same
 * - `GET /people` — id and name only, for an owner picker, a hand-over, a
 *   mention
 *
 * A team is what "their team's rows" is read from: whoever LEADS a team
 * reaches the rows of everybody in it. So putting a person in a team, or
 * making somebody its lead, is giving that lead rows to read: every team
 * route asks for `system:users:manage`, reading included (a team's list says
 * who works with whom). Every change writes an `rbac` audit entry.
 *
 * `/people` is for anybody signed in: a rep picks a colleague to hand a deal
 * to. It answers a name and an id and nothing else — no address, no role, no
 * team — and leaves out people who cannot be named (suspended, or invited
 * and not yet here).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { LEAD_REACH_MAX, teamsRepo, usersRepo, type Team, type User } from '@adminium/meta';

import { ConflictError, NotFoundError, UnauthorizedError } from '../../errors.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { peopleQuery, peopleReply, teamBody, teamDto, teamIdParams, teamListReply, teamMemberBody, teamMemberParams, teamOkReply, type TeamDto } from './schema.js';

export const teamsRoutes: FastifyPluginAsyncZod = async (app) => {
  const { meta } = app.rbac;
  const teams = teamsRepo(meta);
  const users = usersRepo(meta);
  const guarded = { preHandler: app.rbac.require(PERMISSIONS.usersManage) };

  async function mustFindTeam(id: string): Promise<Team> {
    const team = await teams.findById(id);
    if (team === null) throw new NotFoundError('Team not found.', { teamId: id });
    return team;
  }

  async function mustFindUser(id: string): Promise<User> {
    const user = await users.findById(id);
    if (user === null) throw new NotFoundError('User not found.', { userId: id });
    return user;
  }

  async function dtoFor(team: Team, known?: Map<string, User | null>): Promise<TeamDto> {
    const members = [];
    for (const member of await teams.members(team.id)) {
      const user = known?.has(member.userId) === true ? known.get(member.userId)! : await users.findById(member.userId);
      known?.set(member.userId, user);
      if (user === null) continue;
      members.push({ userId: user.id, name: user.name, email: user.email, status: user.status, lead: member.lead });
    }
    // Leads first, then by name: the order a team is read in.
    members.sort((a, b) => Number(b.lead) - Number(a.lead) || a.name.localeCompare(b.name));
    return { id: team.id, name: team.name, members, createdAt: team.createdAt, updatedAt: team.updatedAt };
  }

  /** A second team of the same name would be told apart by nothing a person sees. */
  async function refuseTakenName(name: string, own?: string): Promise<void> {
    const held = await teams.findByName(name);
    if (held !== null && held.id !== own) throw new ConflictError('A team already has that name.', 'UNIQUE_VIOLATION', { name });
  }

  app.get('/teams', { ...guarded, schema: { response: { 200: teamListReply } } }, async () => {
    const known = new Map<string, User | null>();
    const out: TeamDto[] = [];
    for (const team of await teams.list()) out.push(await dtoFor(team, known));
    // Who leads more people than one reach holds: their lists are cut, and the page must say so.
    const over = [];
    for (const lead of new Set(out.flatMap((team) => team.members.filter((member) => member.lead).map((member) => member.userId)))) {
      if ((await teams.leadReach(lead)).capped) over.push({ userId: lead, name: known.get(lead)?.name ?? lead });
    }
    return { teams: out, reachMax: LEAD_REACH_MAX, over };
  });

  app.post('/teams', { ...guarded, schema: { body: teamBody, response: { 201: teamDto } } }, async (request, reply) => {
    await refuseTakenName(request.body.name);
    const team = await teams.create(request.body.name);
    await app.rbac.audit(request, { category: 'rbac', action: 'team.create', changes: { after: { teamId: team.id, name: team.name } } });
    return reply.status(201).send(await dtoFor(team));
  });

  app.patch('/teams/:id', { ...guarded, schema: { params: teamIdParams, body: teamBody, response: { 200: teamDto } } }, async (request) => {
    const team = await mustFindTeam(request.params.id);
    await refuseTakenName(request.body.name, team.id);
    await teams.rename(team.id, request.body.name);
    await app.rbac.audit(request, { category: 'rbac', action: 'team.rename', changes: { before: { teamId: team.id, name: team.name }, after: { name: request.body.name } } });
    return dtoFor(await mustFindTeam(team.id));
  });

  app.delete('/teams/:id', { ...guarded, schema: { params: teamIdParams, response: { 200: teamOkReply } } }, async (request) => {
    const team = await mustFindTeam(request.params.id);
    const members = (await teams.members(team.id)).map((member) => ({ userId: member.userId, lead: member.lead }));
    await teams.delete(team.id);
    await app.rbac.audit(request, { category: 'rbac', action: 'team.delete', changes: { before: { teamId: team.id, name: team.name, members } } });
    return { ok: true as const };
  });

  app.put(
    '/teams/:id/members/:userId',
    { ...guarded, schema: { params: teamMemberParams, body: teamMemberBody, response: { 200: teamDto } } },
    async (request) => {
      const team = await mustFindTeam(request.params.id);
      const user = await mustFindUser(request.params.userId);
      const before = (await teams.members(team.id)).find((member) => member.userId === user.id);
      await teams.setMember(team.id, user.id, request.body.lead);
      await app.rbac.audit(request, {
        category: 'rbac',
        action: before === undefined ? 'team.member.add' : 'team.member.change',
        changes: { ...(before === undefined ? {} : { before: { lead: before.lead } }), after: { teamId: team.id, userId: user.id, lead: request.body.lead } },
      });
      return dtoFor(team);
    },
  );

  app.delete('/teams/:id/members/:userId', { ...guarded, schema: { params: teamMemberParams, response: { 200: teamDto } } }, async (request) => {
    const team = await mustFindTeam(request.params.id);
    const removed = await teams.removeMember(team.id, request.params.userId);
    if (!removed) throw new NotFoundError('That person is not in the team.', { teamId: team.id, userId: request.params.userId });
    await app.rbac.audit(request, { category: 'rbac', action: 'team.member.remove', changes: { before: { teamId: team.id, userId: request.params.userId } } });
    return dtoFor(team);
  });

  app.get('/people', { preHandler: app.requireAuth, schema: { querystring: peopleQuery, response: { 200: peopleReply } } }, async (request) => {
    // A person asks who their colleagues are; an API key is nobody and names nobody.
    const keyed = request.apiKeyPrincipal !== null && request.apiKeyPrincipal !== undefined;
    if (keyed || (request as unknown as { user?: { id?: string } }).user?.id === undefined) throw new UnauthorizedError('UNAUTHENTICATED', 'The list of people needs a user session.');
    const limit = request.query.limit ?? 50;
    const q = request.query.q;
    const found: User[] = [];
    // Somebody who can be given a row: here already (active), or the sample's.
    for (const status of ['active', 'sample'] as const) {
      found.push(...(await users.list({ status, ...(q === undefined ? {} : { q }), limit })));
    }
    // By name only: the search above also reads addresses, and an address is not this route's to confirm.
    const needle = q?.trim().toLowerCase() ?? '';
    const people = found
      .filter((user) => needle === '' || user.name.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .slice(0, limit)
      .map((user) => ({ id: user.id, name: user.name, sample: user.status === 'sample' }));
    return { people };
  });
};
