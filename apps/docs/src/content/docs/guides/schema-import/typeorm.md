---
title: Import TypeORM entities
description: Import TypeORM entity classes. Decorators, relations, and what naming strategies do to your column names.
---

## The file

Your entity files. Concatenate them, or import the one that carries the entities
you care about.

## Detection

Adminium detects TypeORM by `@Entity(` decorators, or by `@Column(` alongside a
class declaration.

## What is read

| TypeORM | Becomes |
|---|---|
| `@Entity()` | table |
| `@Column()` | column |
| `@PrimaryColumn`, `@PrimaryGeneratedColumn` | primary key |
| `@ManyToOne`, `@OneToOne` + `@JoinColumn` | foreign key + relation |
| `@OneToMany` | the inverse side (no column) |
| `@ManyToMany` + `@JoinTable` | join table |
| `@Index`, `@Unique` | index / unique constraint |
| `{ nullable: true }` | nullable |
| `{ default: … }` | default |
| `{ type: 'enum', enum: … }` | enum → select input |
| `@Entity('name')` / `@Column({ name })` | **the real table/column name** |

## Naming strategies are the catch

TypeORM derives column names from property names unless told otherwise, and the
derivation depends on a `namingStrategy` configured in your **data source**, not
your entities:

```ts
@Entity()
export class User {
  @Column()
  emailAddress: string;   // → "emailAddress"? "email_address"? Depends.
}
```

With the default strategy the column is `emailAddress`. With
`SnakeNamingStrategy` — which most projects add — it is `email_address`.
Adminium reads entities, not your data-source config, so it assumes the default.

If your project uses a snake-case naming strategy, either be explicit:

```ts
@Column({ name: 'email_address' })
emailAddress: string;
```

…or import a [SQL dump](/guides/schema-import/sql-ddl/) instead. Explicit
`name:` is always read correctly.

## The static-analysis limit

Entity files are TypeScript, parsed and not executed. Decorator arguments must
be literals to be read. Computed options, spread config objects, and
`@Column(getColumnOptions())` are invisible.

## Notes

- **Embedded entities** (`@Column(() => Address)`) flatten into the parent
  table, which is what TypeORM does at runtime.
- **`@TableInheritance`** (single-table inheritance) imports as one table with
  the union of columns and the discriminator, matching the database.
- **Lazy relations** (`Promise<User>`) are read as ordinary relations.
