// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TypeORM parser — decorators and entity-file shapes the Northwind entity
 * file does not use: the lifecycle columns, class-level @Index/@Unique,
 * @OneToOne pairs, inline and imported enums, and the class-body scanner's
 * handling of methods, initialisers and non-entity classes.
 */
import { describe, expect, it } from 'vitest';

import { parseSchemaFile, SchemaImportError } from '../src/index.js';
import { column, relationBetween, table } from './helpers.js';

const parse = (src: string) => parseSchemaFile(src, { format: 'typeorm' });

describe('typeorm — column decorators', () => {
  const src = `
enum Role { Admin, Member, Guest }

@Entity('accounts')
export class Account {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'enum', enum: Role, default: 'Member' })
  role: Role;

  @Column({ type: 'text', array: true })
  tags: string[];

  @Column({ type: 'int', generated: true })
  seat: number;

  @Column({ default: () => 'CURRENT_TIMESTAMP' })
  signedUpAt: Date;

  @Column({ default: () => "nextval('seat_seq')" })
  seatHint: number;

  @Column()
  loginCount = 0;

  @Index('idx_accounts_handle', { unique: true })
  @Column({ name: 'handle', nullable: true })
  userHandle: string;

  @VersionColumn()
  version: number;

  @DeleteDateColumn()
  deletedAt: Date;

  @Generated('increment')
  @Column()
  ordinal: number;

  toJSON(): Record<string, unknown> {
    return { id: this.id };
  }
}
`;
  const { model, warnings } = parse(src);

  it('treats @PrimaryColumn as the primary key and reads its type options', () => {
    expect(table(model, 'accounts').primaryKey).toEqual(['id']);
    const id = column(model, 'accounts', 'id');
    expect(id.logicalType).toBe('varchar');
    expect(id.maxLength).toBe(26);
    expect(id.nullable).toBe(false);
  });

  it('resolves an enum column through a numeric TS enum declared in the file', () => {
    const role = column(model, 'accounts', 'role');
    expect(role.logicalType).toBe('enum');
    expect(model.enums.find((e) => e.id === role.enumRef)?.values).toEqual([
      'Admin',
      'Member',
      'Guest',
    ]);
    expect(role.default).toEqual({ kind: 'literal', text: 'Member' });
  });

  it('reads array: true and generated: true', () => {
    expect(column(model, 'accounts', 'tags').isArray).toBe(true);
    expect(column(model, 'accounts', 'seat').default).toEqual({ kind: 'autoincrement' });
  });

  it('classifies arrow-function defaults as now() or an expression', () => {
    expect(column(model, 'accounts', 'signedUpAt').default).toEqual({ kind: 'now' });
    expect(column(model, 'accounts', 'seatHint').default).toEqual({
      kind: 'expression',
      text: "nextval('seat_seq')",
    });
  });

  it('falls back to unknown when a property has an initialiser but no TS type', () => {
    expect(column(model, 'accounts', 'loginCount').logicalType).toBe('unknown');
  });

  it('honours the name option and property-level @Index options', () => {
    expect(column(model, 'accounts', 'handle').nullable).toBe(true);
    const idx = table(model, 'accounts').indexes.find((i) => i.name === 'idx_accounts_handle');
    expect(idx?.unique).toBe(true);
    expect(idx?.columns).toEqual(['handle']);
  });

  it('types @VersionColumn as a non-null integer and @DeleteDateColumn as a nullable timestamp', () => {
    const version = column(model, 'accounts', 'version');
    expect(version.logicalType).toBe('integer');
    expect(version.nullable).toBe(false);
    const deleted = column(model, 'accounts', 'deletedAt');
    expect(deleted.logicalType).toBe('timestamp');
    expect(deleted.nullable).toBe(true);
  });

  it('reads @Generated as an autoincrement default', () => {
    expect(column(model, 'accounts', 'ordinal').default).toEqual({ kind: 'autoincrement' });
  });

  it('skips methods without inventing columns', () => {
    expect(table(model, 'accounts').columns.map((c) => c.name)).not.toContain('toJSON');
    expect(warnings.some((w) => /unparseable/.test(w))).toBe(false);
  });
});

describe('typeorm — entity and relation shapes', () => {
  it('reads the table name from the @Entity options object', () => {
    // Regression: the decorator region used to be cut at the last `}` in the
    // preceding text, which is the `}` of this very options object — so every
    // entity declared this way disappeared.
    const { model } = parse(`
@Entity({ name: 'invoices', schema: 'billing' })
export class Invoice {
  @PrimaryGeneratedColumn() id: number;
}
`);
    expect(model.tables.map((t) => t.name)).toEqual(['invoices']);
  });

  it('reads class-level @Index and @Unique lists', () => {
    const { model } = parse(`
@Entity({ name: 'invoices' })
@Index('idx_invoices_period', ['year', 'month'])
@Unique('uq_invoices_period', ['year', 'month'])
export class Invoice {
  @PrimaryGeneratedColumn() id: number;
  @Column() year: number;
  @Column() month: number;
}
`);
    const invoices = table(model, 'invoices');
    expect(invoices.indexes.find((i) => i.name === 'idx_invoices_period')?.columns).toEqual([
      'year',
      'month',
    ]);
    expect(invoices.uniques).toEqual([{ name: 'uq_invoices_period', columns: ['year', 'month'] }]);
  });

  it('builds a one-to-one FK from the owning side and skips the inverse side', () => {
    const { model } = parse(`
@Entity('users')
export class User {
  @PrimaryGeneratedColumn() id: number;
  @OneToOne(() => Profile, (p) => p.user)
  profile: Profile;
}

@Entity('profiles')
export class Profile {
  @PrimaryGeneratedColumn() id: number;
  @OneToOne(() => User, (u) => u.profile, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'owner_id', referencedColumnName: 'id' })
  user: User;
}
`);
    expect(table(model, 'users').columns.map((c) => c.name)).toEqual(['id']);
    const rel = relationBetween(model, 'profiles', 'users');
    expect(rel?.cardinality).toBe('one-to-one');
    expect(rel?.onDelete).toBe('restrict');
    expect(column(model, 'profiles', 'owner_id').references).toEqual({
      tableId: 'public.users',
      column: 'id',
    });
  });

  it('accepts a string relation target and the SET NULL / NO ACTION actions', () => {
    const { model } = parse(`
@Entity('teams')
export class Team {
  @PrimaryGeneratedColumn() id: number;
}

@Entity('members')
export class Member {
  @PrimaryGeneratedColumn() id: number;
  @ManyToOne('Team', { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'team_id' })
  team: unknown;

  @ManyToOne('Team', { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'backup_team_id' })
  backupTeam: unknown;
}
`);
    expect(relationBetween(model, 'members', 'teams')?.onDelete).toBe('set-null');
    expect(column(model, 'members', 'backup_team_id').references).toMatchObject({
      tableId: 'public.teams',
    });
  });

  it('warns when a relation targets an entity that is not in the file', () => {
    const { model, warnings } = parse(`
@Entity('members')
export class Member {
  @PrimaryGeneratedColumn() id: number;
  @ManyToOne(() => Organisation)
  @JoinColumn({ name: 'org_id' })
  org: Organisation;
}
`);
    expect(table(model, 'members').columns.map((c) => c.name)).toEqual(['id']);
    expect(warnings.some((w) => /to entity "Organisation" not in input/.test(w))).toBe(true);
  });

  it('warns and skips a relation whose target expression is not statically resolvable', () => {
    const { warnings } = parse(`
@Entity('members')
export class Member {
  @PrimaryGeneratedColumn() id: number;
  @ManyToOne()
  team: unknown;
}
`);
    expect(warnings.some((w) => /could not resolve relation target on "Member.team"/.test(w))).toBe(
      true,
    );
  });

  it('warns once about @ManyToMany, which needs the owning @JoinTable', () => {
    const { model, warnings } = parse(`
@Entity('posts')
export class Post {
  @PrimaryGeneratedColumn() id: number;
  @ManyToMany(() => Tag)
  @JoinTable()
  tags: Tag[];
}

@Entity('tags')
export class Tag {
  @PrimaryGeneratedColumn() id: number;
}
`);
    expect(model.relations).toHaveLength(0);
    expect(warnings.some((w) => /skipped @ManyToMany relation/.test(w))).toBe(true);
  });

  it('warns instead of guessing when enum values cannot be resolved statically', () => {
    const { model, warnings } = parse(`
@Entity('tickets')
export class Ticket {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'enum', enum: ImportedStatus })
  status: ImportedStatus;
}
`);
    const status = column(model, 'tickets', 'status');
    expect(status.logicalType).toBe('text');
    expect(status.enumRef).toBeNull();
    expect(warnings.some((w) => /enum values for "Ticket.status" could not be resolved/.test(w))).toBe(
      true,
    );
  });

  it('reads an inline enum array', () => {
    const { model } = parse(`
@Entity('tickets')
export class Ticket {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'enum', enum: ['open', 'closed'] })
  status: string;
}
`);
    const status = column(model, 'tickets', 'status');
    expect(status.logicalType).toBe('enum');
    expect(model.enums.find((e) => e.id === status.enumRef)?.values).toEqual(['open', 'closed']);
  });

  it('warns when decorator options are spread from a variable', () => {
    const { warnings } = parse(`
@Entity('tickets')
export class Ticket {
  @PrimaryGeneratedColumn() id: number;
  @Column({ ...baseOptions, nullable: true })
  note: string;
}
`);
    expect(warnings.some((w) => /options with spread on "Ticket.note"/.test(w))).toBe(true);
  });

  it('ignores classes that are not entities and properties with no column decorator', () => {
    const { model } = parse(`
export class NotAnEntity {
  @Column() ghost: string;
}

@Entity('tickets')
export class Ticket {
  @PrimaryGeneratedColumn() id: number;
  @Exclude()
  secret: string;
}
`);
    expect(model.tables.map((t) => t.name)).toEqual(['tickets']);
    expect(table(model, 'tickets').columns.map((c) => c.name)).toEqual(['id']);
  });

  it('does not let a semicolon inside a property initialiser end the statement', () => {
    const { model } = parse(`
@Entity('tickets')
export class Ticket {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'varchar' }) label: string = 'a; b';
  @Column({ type: 'jsonb' }) meta: Record<string, unknown> = { a: 1 };
  @Column({ type: 'boolean' }) done: boolean;
}
`);
    expect(table(model, 'tickets').columns.map((c) => c.name)).toEqual([
      'id',
      'label',
      'meta',
      'done',
    ]);
  });

  it('warns about a decorated member whose name is not a plain identifier', () => {
    const { model, warnings } = parse(`
@Entity('tickets')
export class Ticket {
  @PrimaryGeneratedColumn() id: number;
  @Column()
  'legacy name': string;
}
`);
    expect(table(model, 'tickets').columns.map((c) => c.name)).toEqual(['id']);
    expect(warnings.some((w) => /unparseable decorated class member/.test(w))).toBe(true);
  });

  it('generates names for anonymous class-level @Index / @Unique and property @Index', () => {
    const { model } = parse(`
@Entity('rows')
@Index(['a', 'b'])
@Unique(['a'])
export class Row {
  @PrimaryGeneratedColumn() id: number;
  @Column() a: string;
  @Index()
  @Column() b: string;
}
`);
    const rows = table(model, 'rows');
    expect(rows.indexes.map((i) => i.name).sort()).toEqual(['rows_a_b_idx', 'rows_b_idx']);
    expect(rows.uniques).toEqual([{ name: null, columns: ['a'] }]);
  });

  it('falls back to snake_case when the @Entity options carry no name', () => {
    const { model, warnings } = parse(`
@Entity({ schema: 'billing' })
export class InvoiceLine {
  @PrimaryGeneratedColumn() id: number;
}
`);
    expect(model.tables.map((t) => t.name)).toEqual(['invoice_line']);
    expect(warnings.some((w) => /assumed snake_case "invoice_line"/.test(w))).toBe(true);
  });

  it('falls back to the id convention when @JoinColumn names no column', () => {
    const { model, warnings } = parse(`
@Entity('teams')
export class Team {
  @Column() label: string;
}

@Entity('members')
export class Member {
  @PrimaryGeneratedColumn() id: number;
  @ManyToOne(() => Team, { onDelete: 'SET DEFAULT' })
  @JoinColumn({ referencedColumnName: 'label' })
  homeTeam: Team;
}
`);
    // The target entity has no primary key, and @JoinColumn named no column.
    expect(column(model, 'members', 'home_team_id').references).toMatchObject({
      tableId: 'public.teams',
      column: 'label',
    });
    expect(relationBetween(model, 'members', 'teams')?.onDelete).toBe('set-default');
    expect(warnings.some((w) => /assumed FK column "home_team_id"/.test(w))).toBe(true);
  });

  it('warns when @Column type is enum but no enum values are given', () => {
    const { model, warnings } = parse(`
@Entity('rows')
export class Row {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'enum' })
  state: string;
}
`);
    expect(column(model, 'rows', 'state').logicalType).toBe('text');
    expect(warnings.some((w) => /enum values for "Row.state" could not be resolved/.test(w))).toBe(
      true,
    );
  });

  it('keeps an unrecognised TS property type as its own dbType', () => {
    const { model } = parse(`
@Entity('rows')
export class Row {
  @PrimaryGeneratedColumn() id: number;
  @Column() blob: Buffer;
  @Column() maybe: string | null;
  @Column() when: Date;
}
`);
    expect(column(model, 'rows', 'blob')).toMatchObject({
      logicalType: 'unknown',
      dbType: 'Buffer',
    });
    expect(column(model, 'rows', 'maybe').logicalType).toBe('varchar');
    expect(column(model, 'rows', 'when').logicalType).toBe('timestamp');
  });

  it('keeps a non-string arrow default as an opaque expression', () => {
    const { model } = parse(`
@Entity('rows')
export class Row {
  @PrimaryGeneratedColumn() id: number;
  @Column({ default: () => computeDefault() })
  seed: string;
}
`);
    expect(column(model, 'rows', 'seed').default).toEqual({
      kind: 'expression',
      text: 'computeDefault()',
    });
  });

  it('throws when the input holds no @Entity class at all', () => {
    expect(() => parse('export class Plain { name: string; }')).toThrow(SchemaImportError);
  });
});
