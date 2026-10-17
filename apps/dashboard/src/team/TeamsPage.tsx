// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/settings/teams` — Teams, a page of its own under People (comp: Console
 * Additions, section 2).
 *
 * A team is what "their team's rows" is read from: where a role is held to
 * the rows of a person and their team, whoever LEADS a team reaches the rows
 * of everybody in it, and a member reaches no more than their own. So the
 * page is the people-manager's, like the People list beside it (every team
 * route asks for "manage users", reading included), and it says the rule
 * before it offers a tick that hands somebody a colleague's rows.
 *
 * A team opens in a side sheet that holds a draft: the name, who is in it and
 * who leads it change nothing until "Save team", which then sends one small
 * request a change. Leaving a team moves no rows (the rows follow the person,
 * not the team); rows are handed on only as an account is suspended or
 * removed, on the People list.
 *
 * Where it departs from the comp:
 *  1. Deleting a team asks first, and says that nobody's account or rows are
 *     touched; the comp deletes at once.
 *  2. A member's line names their address, not their role and "owns n
 *     deals": no route counts a person's rows but the one a removal asks.
 *  3. Removing somebody from a team asks nothing: no rows move on leaving a
 *     team (the owner's ruling), so there is no "Hand their deals to…" here.
 *  4. A save is several requests, one a change, not one: a refusal part of
 *     the way says so, and the list is read again to show what was saved.
 *  5. A lead of more people than one reach holds is warned of, and a team
 *     with no members says so; neither is drawn.
 */
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Plus, Trash2, UsersRound, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Drawer,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  EmptyState,
  FormField,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Select,
  Tag,
} from '@adminium/ui';

import { bootstrapQuery, holdsSystemAction } from '../app/bootstrap.js';
import { useCommonWords } from '../i18n/commonWords.js';
import { t } from '../i18n/t.js';
import { PageActions } from '../shell/PageActionsProvider.js';
import { PageSurface } from '../shell/PageSurface.js';
import { peopleQuery } from './rolesApi.js';
import { TEAMS_KEY, createTeam, deleteTeam, removeTeamMember, renameTeam, setTeamMember, teamsQuery, type TeamDto, type TeamMemberDto } from './teamApi.js';

/** A team as the sheet holds it before "Save team": `id` null for a new one. */
export interface TeamDraft {
  id: string | null;
  name: string;
  members: TeamMemberDto[];
}

/**
 * The requests that turn a team into its draft, in the order they are sent:
 * the name first (a new team is made by it), then who leaves, then who joins
 * or changes whether they lead. Pure, so what a save sends is tested without
 * a screen.
 */
export function draftChanges(before: TeamDto | null, draft: TeamDraft): { rename: string | null; remove: string[]; set: { userId: string; lead: boolean }[] } {
  const name = draft.name.trim();
  const held = new Map((before?.members ?? []).map((member) => [member.userId, member]));
  const wanted = new Set(draft.members.map((member) => member.userId));
  return {
    rename: before === null || name !== before.name ? name : null,
    remove: [...held.keys()].filter((userId) => !wanted.has(userId)),
    set: draft.members.filter((member) => held.get(member.userId)?.lead !== member.lead).map((member) => ({ userId: member.userId, lead: member.lead })),
  };
}

/** Two letters for a name's round mark. */
const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter((part) => part !== '')
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

function Mark({ name }: { name: string }): ReactNode {
  return (
    <span aria-hidden className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[10.5px] font-bold text-fg-muted">
      {initials(name)}
    </span>
  );
}

const firstName = (name: string): string => name.split(/\s+/)[0] ?? name;

export function TeamsPage(): ReactNode {
  // This screen's words load with it, not with the first paint.
  useCommonWords();
  const queryClient = useQueryClient();
  const { data: bootstrap } = useQuery(bootstrapQuery());
  const teams = useQuery(teamsQuery());
  const [open, setOpenState] = useState<{ team: TeamDto | null } | null>(null);
  /*
   * FOCUS RETURNS TO WHAT OPENED THE SHEET. The sheet is opened by ordinary
   * buttons (a team's name, "New team"), which Radix does not return focus to,
   * so the opener is remembered and focused again once the sheet has closed.
   */
  const opener = useRef<HTMLElement | null>(null);
  const setOpen = (next: { team: TeamDto | null } | null): void => {
    if (next !== null && typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) opener.current = document.activeElement;
    setOpenState(next);
  };
  useEffect(() => {
    if (open !== null || opener.current === null) return;
    const target = opener.current;
    opener.current = null;
    // After the sheet's own focus handling has run.
    const timer = window.setTimeout(() => {
      if (target.isConnected) target.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);
  const [deleting, setDeleting] = useState<TeamDto | null>(null);
  const list = teams.data?.teams ?? [];
  const inSome = new Set(list.flatMap((team) => team.members.map((member) => member.userId))).size;
  const mayManageRoles = bootstrap !== undefined && holdsSystemAction(bootstrap, 'roles.manage');

  const remove = useMutation({
    mutationFn: (id: string) => deleteTeam(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: TEAMS_KEY }),
  });

  return (
    <PageSurface width="page" className="flex flex-col gap-5">
      <PageActions title={t('team.teams.title', 'Teams')} subtitle={t('team.teams.pageSubtitle', 'Groups of people, each with someone who leads it.')}>
        <Button iconLeft={<Plus className="size-4" />} onClick={() => setOpen({ team: null })} data-testid="teams-new">
          {t('team.teams.newTeam', 'New team')}
        </Button>
      </PageActions>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[12px] border border-border bg-surface-2 px-4 py-3 text-body-sm text-fg-muted" data-testid="teams-notice">
        <UsersRound aria-hidden className="size-4 shrink-0 text-accent" />
        <span className="min-w-0 flex-1">{t('team.teams.notice', 'A team decides whose records a person can open when their role says “their team’s”.')}</span>
        {mayManageRoles ? (
          <Link to="/settings/roles" className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">
            {t('team.teams.rolesLink', 'Roles & access')}
            <ArrowRight aria-hidden className="size-3.5 rtl:rotate-180" />
          </Link>
        ) : null}
      </div>

      {remove.error === null ? null : <Alert role="alert" tone="danger" data-testid="teams-error" title={t('team.teams.failed', 'The team was not changed')} body={remove.error.message} />}
      {(teams.data?.over ?? []).map((one) => (
        <Alert key={one.userId} tone="warn" data-testid="teams-over" title={t('team.teams.over', '{name} leads more than {max} people. Only the first {max} are reached.', { name: one.name, max: teams.data?.reachMax ?? 0 })} />
      ))}

      <Card padded={false} data-testid="teams-card">
        <CardHeader className="flex flex-col items-start gap-1">
          <h2 className="text-section text-fg">{t('team.teams.title', 'Teams')}</h2>
          {teams.data === undefined ? null : (
            <p className="text-body-sm text-fg-muted" data-testid="teams-summary">
              {t('team.teams.summary', '{teams, plural, one {# team} other {# teams}} · {people, plural, one {# person} other {# people}} in one or more', { teams: list.length, people: inSome })}
            </p>
          )}
        </CardHeader>
        <CardBody className="p-0">
          {teams.isError ? (
            <div className="p-4">
              <Alert role="alert" tone="danger" title={t('team.teams.loadFailed', 'The teams could not be read.')} body={teams.error.message} />
            </div>
          ) : teams.isPending ? null : list.length === 0 ? (
            <EmptyState
              compact
              preset="no-data"
              icon={<UsersRound />}
              title={t('team.teams.empty', 'No teams yet')}
              body={t('team.teams.emptyBody', 'Until there is one, a role set to “their team’s” opens the same rows as “their own”.')}
              actions={
                <Button variant="secondary" iconLeft={<Plus className="size-4" />} onClick={() => setOpen({ team: null })}>
                  {t('team.teams.newTeam', 'New team')}
                </Button>
              }
              data-testid="teams-empty"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-body-sm" data-testid="teams-table">
                <caption className="sr-only">{t('team.teams.caption', 'Teams, who leads each and who is in it')}</caption>
                <thead>
                  <tr className="border-b border-border text-micro uppercase text-fg-subtle">
                    <th scope="col" className="px-4 py-2 text-start font-bold">
                      {t('team.teams.colTeam', 'Team')}
                    </th>
                    <th scope="col" className="px-4 py-2 text-start font-bold">
                      {t('team.teams.colLead', 'Lead')}
                    </th>
                    <th scope="col" className="px-4 py-2 text-start font-bold">
                      {t('team.teams.colMembers', 'Members')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((team) => {
                    const leads = team.members.filter((member) => member.lead);
                    const others = team.members.filter((member) => !member.lead);
                    return (
                      <tr key={team.id} className="border-b border-border/60 last:border-0" data-testid={`teams-row-${team.name}`}>
                        <th scope="row" className="px-4 py-2.5 text-start">
                          <button type="button" aria-haspopup="dialog" className="font-semibold text-fg hover:text-accent hover:underline" onClick={() => setOpen({ team })}>
                            {team.name}
                          </button>
                        </th>
                        <td className="px-4 py-2.5">
                          {leads.length === 0 ? (
                            <span className="text-fg-subtle">{t('team.teams.noLead', 'Nobody leads it')}</span>
                          ) : (
                            <span className="flex flex-wrap items-center gap-2">
                              {leads.map((lead) => (
                                <span key={lead.userId} className="inline-flex items-center gap-1.5">
                                  <Mark name={lead.name} />
                                  {lead.name}
                                </span>
                              ))}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {team.members.length === 0 ? (
                            <span className="text-fg-subtle">{t('team.teams.noMembers', 'Nobody is in this team yet.')}</span>
                          ) : others.length === 0 ? (
                            <span className="text-fg-subtle">{t('team.teams.onlyLead', 'Only the lead')}</span>
                          ) : (
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="flex -space-x-1.5 rtl:space-x-reverse">
                                {others.slice(0, 4).map((member) => (
                                  <span key={member.userId} title={member.name} className="rounded-full ring-2 ring-surface">
                                    <Mark name={member.name} />
                                  </span>
                                ))}
                              </span>
                              <span className="text-fg-muted">
                                {t('team.teams.inAll', '{names} · {count, plural, one {# person} other {# people}} in all', {
                                  names: others.map((member) => firstName(member.name)).join(', '),
                                  count: team.members.length,
                                })}
                              </span>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {open === null ? null : (
        <TeamSheet
          key={open.team?.id ?? 'new'}
          team={open.team}
          onClose={() => setOpen(null)}
          onDelete={(team) => {
            // The question that follows takes the focus; nothing is given back to the opener under it.
            opener.current = null;
            setOpenState(null);
            setDeleting(team);
          }}
        />
      )}

      {deleting === null ? null : (
        <Modal open size="sm" onOpenChange={(next) => { if (!next) setDeleting(null); }}>
          <ModalHeader icon={<Trash2 />} title={t('team.teams.deleteTitle', 'Delete “{name}”?', { name: deleting.name })} closeLabel={t('common.close', 'Close')} />
          <ModalBody>
            <p className="text-body-sm text-fg-muted">{t('team.teams.deleteBody', 'Its lead stops reaching the members’ rows. Nobody’s account and nobody’s rows are touched.')}</p>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              data-testid="teams-delete-confirm"
              onClick={() => {
                const id = deleting.id;
                setDeleting(null);
                remove.mutate(id);
              }}
            >
              {t('team.teams.delete', 'Delete team')}
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </PageSurface>
  );
}

/** One team's sheet: a draft of its name, members and leads, sent by "Save team". */
function TeamSheet(props: { team: TeamDto | null; onClose: () => void; onDelete: (team: TeamDto) => void }): ReactNode {
  const { team } = props;
  const queryClient = useQueryClient();
  const people = useQuery(peopleQuery());
  const [draft, setDraft] = useState<TeamDraft>({ id: team?.id ?? null, name: team?.name ?? '', members: team?.members ?? [] });
  const [adding, setAdding] = useState('');
  const [missingName, setMissingName] = useState(false);
  const inTeam = new Set(draft.members.map((member) => member.userId));
  const addable = (people.data ?? []).filter((person) => !inTeam.has(person.id));

  const save = useMutation({
    mutationFn: async () => {
      const changes = draftChanges(team, draft);
      let id = team?.id ?? null;
      if (changes.rename !== null) id = (id === null ? await createTeam(changes.rename) : await renameTeam(id, changes.rename)).id;
      if (id === null) return;
      for (const userId of changes.remove) await removeTeamMember(id, userId);
      for (const one of changes.set) await setTeamMember(id, one.userId, one.lead);
    },
    onSuccess: props.onClose,
    // Read again whatever happened: a refusal part of the way leaves the changes before it saved.
    onSettled: () => queryClient.invalidateQueries({ queryKey: TEAMS_KEY }),
  });

  const title = team === null ? t('team.teams.newTeam', 'New team') : draft.name.trim() === '' ? t('team.teams.untitled', 'Untitled team') : draft.name;

  return (
    <Drawer open size="md" onOpenChange={(next) => { if (!next && !save.isPending) props.onClose(); }}>
      <DrawerHeader icon={<UsersRound />} title={title} subtitle={t('team.teams.sheetEyebrow', 'Team')} closeLabel={t('common.close', 'Close')} data-testid="team-sheet" />
      <DrawerBody className="flex flex-col gap-4">
        <FormField label={t('team.teams.nameLabel', 'Name')} required>
          <Input
            value={draft.name}
            maxLength={80}
            autoFocus={team === null}
            placeholder={t('team.teams.namePlaceholder', 'e.g. North')}
            onChange={(event) => {
              setMissingName(false);
              setDraft({ ...draft, name: event.target.value });
            }}
            data-testid="team-sheet-name"
          />
        </FormField>

        <section aria-labelledby="team-sheet-people" className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <h3 id="team-sheet-people" className="text-body font-semibold text-fg">
              {t('team.teams.people', 'People')}
            </h3>
            <span className="text-caption text-fg-subtle">{t('team.teams.memberCount', '{count, plural, one {# person} other {# people}}', { count: draft.members.length })}</span>
          </div>
          <p className="text-body-sm text-fg-muted">{t('team.teams.peopleHint', 'Tick who leads. A lead’s “their team’s” covers everyone here.')}</p>
          {draft.members.length === 0 ? (
            <p className="text-body-sm text-fg-subtle">{t('team.teams.noMembers', 'Nobody is in this team yet.')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border/60 rounded-lg border border-border">
              {draft.members.map((member) => (
                <li key={member.userId} className="flex flex-wrap items-center gap-3 px-3 py-2" data-testid={`team-sheet-member-${member.name}`}>
                  <Mark name={member.name} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-body-sm font-semibold text-fg">
                      {member.name}
                      {member.status === 'sample' ? <Tag className="ms-2">{t('team.status.sample', 'Sample person')}</Tag> : null}
                    </span>
                    {member.email === '' ? null : <span className="truncate text-caption text-fg-subtle">{member.email}</span>}
                  </span>
                  <label className="flex items-center gap-2 text-body-sm text-fg">
                    <Checkbox
                      checked={member.lead}
                      disabled={save.isPending}
                      onCheckedChange={(checked) => setDraft({ ...draft, members: draft.members.map((one) => (one.userId === member.userId ? { ...one, lead: checked === true } : one)) })}
                    />
                    {t('team.teams.leads', 'Leads')}
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={save.isPending}
                    aria-label={t('team.teams.removeLabel', 'Remove {name} from {team}', { name: member.name, team: title })}
                    onClick={() => setDraft({ ...draft, members: draft.members.filter((one) => one.userId !== member.userId) })}
                  >
                    <X aria-hidden className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-56 flex-1 flex-col gap-1.5">
              <span className="text-[11.5px] font-bold">{t('team.teams.addLabel', 'Add a person')}</span>
              <Select value={adding} disabled={save.isPending || addable.length === 0} onChange={(event) => setAdding(event.target.value)} data-testid="team-sheet-add">
                <option value="">{t('team.teams.addMember', 'Pick someone…')}</option>
                {addable.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.sample ? t('team.teams.sample', '{name} (sample)', { name: person.name }) : person.name}
                  </option>
                ))}
              </Select>
            </label>
            <Button
              variant="secondary"
              disabled={adding === '' || save.isPending}
              onClick={() => {
                const person = addable.find((one) => one.id === adding);
                if (person === undefined) return;
                setDraft({ ...draft, members: [...draft.members, { userId: person.id, name: person.name, email: '', status: person.sample ? 'sample' : 'active', lead: false }] });
                setAdding('');
              }}
              data-testid="team-sheet-add-confirm"
            >
              {t('team.teams.add', 'Add')}
            </Button>
          </div>
        </section>

        {!missingName ? null : <Alert role="alert" tone="warn" title={t('team.teams.needName', 'Give the team a name first.')} />}
        {save.error === null ? null : <Alert role="alert" tone="danger" data-testid="team-sheet-error" title={t('team.teams.failed', 'The team was not changed')} body={save.error.message} />}
      </DrawerBody>
      <DrawerFooter className="justify-between">
        {team === null ? (
          <span />
        ) : (
          <Button variant="ghost" disabled={save.isPending} onClick={() => props.onDelete(team)} data-testid="team-sheet-delete">
            {t('team.teams.delete', 'Delete team')}
          </Button>
        )}
        <span className="flex gap-2">
          <Button variant="secondary" disabled={save.isPending} onClick={props.onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              if (draft.name.trim() === '') {
                setMissingName(true);
                return;
              }
              save.mutate();
            }}
            data-testid="team-sheet-save"
          >
            {t('team.teams.save', 'Save team')}
          </Button>
        </span>
      </DrawerFooter>
    </Drawer>
  );
}
