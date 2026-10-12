// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Teams, on the Team page.
 *
 * A team is what "their team's rows" is read from: where a role is held to
 * the rows of a person and their team, whoever LEADS a team reaches the rows
 * of everybody in it, and a member reaches no more than their own. So this
 * card is the people-manager's, like the directory above it, and it says the
 * rule before it offers a tick box that hands somebody a colleague's rows.
 *
 * Drawn only inside `TeamPage`, which waits for the `team.*` words
 * (`useCommonWords`): a key named here never shows its inline English first.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, UsersRound } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Alert, Button, Card, CardBody, CardHeader, Checkbox, EmptyState, Input, Modal, ModalBody, ModalFooter, ModalHeader, Select, Tag } from '@adminium/ui';

import { t } from '../i18n/t.js';
import { peopleQuery, type PersonRef } from './rolesApi.js';
import { TEAMS_KEY, createTeam, deleteTeam, removeTeamMember, renameTeam, setTeamMember, teamsQuery, type TeamDto } from './teamApi.js';

export function TeamsCard(): ReactNode {
  const queryClient = useQueryClient();
  const teams = useQuery(teamsQuery());
  const people = useQuery(peopleQuery());
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState<TeamDto | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: TEAMS_KEY });
  // One mutation for every change: each is one small request, and one error line serves them all.
  const change = useMutation({ mutationFn: (run: () => Promise<unknown>) => run(), onSettled: refresh });
  const busy = change.isPending;
  const list = teams.data?.teams ?? [];

  return (
    <Card padded={false} data-testid="teams-card">
      <CardHeader className="flex flex-col items-start gap-1">
        <h2 className="text-section text-fg">{t('team.teams.title', 'Teams')}</h2>
        <p className="text-body-sm text-fg-muted">
          {t(
            'team.teams.intro',
            'Where a role is held to “their team’s rows”, a team’s lead reaches the rows of everyone in it. A member reaches only their own.',
          )}
        </p>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        {change.error === null ? null : (
          <Alert role="alert" tone="danger" data-testid="teams-error" title={t('team.teams.failed', 'The team was not changed')} body={change.error.message} />
        )}
        {(teams.data?.over ?? []).map((one) => (
          <Alert
            key={one.userId}
            tone="warn"
            data-testid="teams-over"
            title={t('team.teams.over', '{name} leads more than {max} people. Only the first {max} are reached.', { name: one.name, max: teams.data?.reachMax ?? 0 })}
          />
        ))}
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const wanted = name.trim();
            if (wanted === '' || busy) return;
            change.mutate(() => createTeam(wanted), { onSuccess: () => setName('') });
          }}
        >
          <Input
            className="min-w-56 flex-1"
            value={name}
            maxLength={80}
            aria-label={t('team.teams.newName', 'New team name')}
            placeholder={t('team.teams.newName', 'New team name')}
            onChange={(event) => setName(event.target.value)}
            data-testid="teams-new-name"
          />
          <Button type="submit" variant="secondary" disabled={name.trim() === '' || busy} data-testid="teams-create">
            {t('team.teams.create', 'Add team')}
          </Button>
        </form>
        {teams.isPending ? null : list.length === 0 ? (
          <EmptyState compact preset="no-data" icon={<UsersRound />} title={t('team.teams.empty', 'No teams yet.')} />
        ) : (
          <ul className="flex flex-col gap-3">
            {list.map((team) => (
              <TeamBlock
                key={team.id}
                team={team}
                people={people.data ?? []}
                busy={busy}
                onRename={(next) => change.mutate(() => renameTeam(team.id, next))}
                onDelete={() => setDeleting(team)}
                onLead={(userId, lead) => change.mutate(() => setTeamMember(team.id, userId, lead))}
                onAdd={(userId) => change.mutate(() => setTeamMember(team.id, userId, false))}
                onRemove={(userId) => change.mutate(() => removeTeamMember(team.id, userId))}
              />
            ))}
          </ul>
        )}
      </CardBody>

      {deleting === null ? null : (
        <Modal open size="sm" onOpenChange={(next) => { if (!next) setDeleting(null); }}>
          <ModalHeader icon={<Trash2 />} title={t('team.teams.deleteTitle', 'Delete “{name}”?', { name: deleting.name })} closeLabel={t('common.close', 'Close')} />
          <ModalBody>
            <p className="text-body-sm text-fg-muted">
              {t('team.teams.deleteBody', 'Its lead stops reaching the members’ rows. Nobody’s account and nobody’s rows are touched.')}
            </p>
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
                change.mutate(() => deleteTeam(id));
              }}
            >
              {t('team.teams.delete', 'Delete team')}
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </Card>
  );
}

function TeamBlock(props: {
  team: TeamDto;
  people: readonly PersonRef[];
  busy: boolean;
  onRename: (name: string) => void;
  onDelete: () => void;
  onLead: (userId: string, lead: boolean) => void;
  onAdd: (userId: string) => void;
  onRemove: (userId: string) => void;
}): ReactNode {
  const { team } = props;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [adding, setAdding] = useState('');
  const inTeam = new Set(team.members.map((member) => member.userId));
  const addable = props.people.filter((person) => !inTeam.has(person.id));

  return (
    <li className="rounded-lg border border-border p-3" data-testid={`teams-team-${team.name}`}>
      <div className="flex flex-wrap items-center gap-2">
        {renaming === null ? (
          <>
            <h3 className="flex-1 text-body font-semibold text-fg">{team.name}</h3>
            <span className="text-caption text-fg-subtle">
              {t('team.teams.memberCount', '{count, plural, one {# person} other {# people}}', { count: team.members.length })}
            </span>
            <Button variant="ghost" size="sm" disabled={props.busy} onClick={() => setRenaming(team.name)}>
              {t('team.teams.rename', 'Rename')}
            </Button>
            <Button variant="ghost" size="sm" disabled={props.busy} onClick={props.onDelete} data-testid={`teams-delete-${team.name}`}>
              {t('team.teams.delete', 'Delete team')}
            </Button>
          </>
        ) : (
          <form
            className="flex flex-1 flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const wanted = renaming.trim();
              if (wanted !== '' && wanted !== team.name) props.onRename(wanted);
              setRenaming(null);
            }}
          >
            <Input className="min-w-48 flex-1" value={renaming} maxLength={80} autoFocus aria-label={t('team.teams.newName', 'New team name')} onChange={(event) => setRenaming(event.target.value)} />
            <Button type="submit" size="sm" disabled={renaming.trim() === ''}>
              {t('common.save', 'Save')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setRenaming(null)}>
              {t('common.cancel', 'Cancel')}
            </Button>
          </form>
        )}
      </div>

      {team.members.length === 0 ? (
        <p className="mt-2 text-body-sm text-fg-subtle">{t('team.teams.noMembers', 'Nobody is in this team yet.')}</p>
      ) : (
        <ul className="mt-2 flex flex-col divide-y divide-border/60">
          {team.members.map((member) => (
            <li key={member.userId} className="flex flex-wrap items-center gap-3 py-2" data-testid={`teams-member-${member.name}`}>
              <span className="min-w-0 flex-1 truncate text-body-sm text-fg">
                {member.name}
                {member.status === 'sample' ? <Tag className="ms-2">{t('team.status.sample', 'Sample person')}</Tag> : null}
              </span>
              <label className="flex items-center gap-2 text-body-sm text-fg">
                <Checkbox checked={member.lead} disabled={props.busy} onCheckedChange={(checked) => props.onLead(member.userId, checked === true)} />
                {t('team.teams.leads', 'Leads the team')}
              </label>
              <Button
                variant="ghost"
                size="sm"
                disabled={props.busy}
                aria-label={t('team.teams.removeLabel', 'Remove {name} from {team}', { name: member.name, team: team.name })}
                onClick={() => props.onRemove(member.userId)}
              >
                {t('team.teams.remove', 'Remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Select
          className="min-w-56 flex-1"
          value={adding}
          disabled={props.busy || addable.length === 0}
          aria-label={t('team.teams.addMemberLabel', 'Person to add to {team}', { team: team.name })}
          onChange={(event) => setAdding(event.target.value)}
          data-testid={`teams-add-${team.name}`}
        >
          <option value="">{t('team.teams.addMember', 'Add a person…')}</option>
          {addable.map((person) => (
            <option key={person.id} value={person.id}>
              {person.sample ? t('team.teams.sample', '{name} (sample)', { name: person.name }) : person.name}
            </option>
          ))}
        </Select>
        <Button
          variant="secondary"
          size="sm"
          disabled={adding === '' || props.busy}
          onClick={() => {
            props.onAdd(adding);
            setAdding('');
          }}
          data-testid={`teams-add-confirm-${team.name}`}
        >
          {t('team.teams.add', 'Add')}
        </Button>
      </div>
    </li>
  );
}
