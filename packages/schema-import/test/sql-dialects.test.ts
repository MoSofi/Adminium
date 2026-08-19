// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SQL DDL parser — dialect and statement variants the two Northwind dumps do
 * not contain. Every input here is a shape a real dump or migration file
 * emits: pg_dump's full FK tail, identity/generated columns, views, MySQL's
 * index spellings, SQLite's typeless columns, and the ALTER TABLE forms a
 * migration history is made of.
 */
import { describe, expect, it } from 'vitest';

import { parseSchemaFile, SchemaImportError } from '../src/index.js';
import { column, relationBetween, table } from './helpers.js';

/** Two tables so FK targets always resolve. */
const PARENT = 'CREATE TABLE customers (id integer PRIMARY KEY, email text);\n';

describe('sql — postgres foreign-key tails', () => {
  it('reads MATCH/ON UPDATE/DEFERRABLE/INITIALLY/NOT VALID around the actions', () => {
    const { model } = parseSchemaFile(
      `${PARENT}CREATE TABLE orders (id integer PRIMARY KEY, customer_id integer);\n` +
        'ALTER TABLE ONLY orders ADD CONSTRAINT orders_customer_fk FOREIGN KEY (customer_id) ' +
        'REFERENCES customers(id) MATCH FULL ON UPDATE CASCADE ON DELETE RESTRICT ' +
        'DEFERRABLE INITIALLY DEFERRED NOT VALID;',
    );
    const rel = relationBetween(model, 'orders', 'customers');
    expect(rel?.onUpdate).toBe('cascade');
    expect(rel?.onDelete).toBe('restrict');
  });

  it('maps the two-word actions SET DEFAULT and NO ACTION', () => {
    const { model } = parseSchemaFile(
      `${PARENT}CREATE TABLE a (id integer PRIMARY KEY, c1 integer REFERENCES customers(id) ON DELETE SET DEFAULT);\n` +
        'CREATE TABLE b (id integer PRIMARY KEY, c2 integer REFERENCES customers(id) ON DELETE NO ACTION);',
    );
    expect(relationBetween(model, 'a', 'customers')?.onDelete).toBe('set-default');
    expect(relationBetween(model, 'b', 'customers')?.onDelete).toBe('no-action');
  });

  it('resolves a table-level REFERENCES without a target column list to the target pk', () => {
    const { model } = parseSchemaFile(
      `${PARENT}CREATE TABLE orders (id integer PRIMARY KEY, customer_id integer, ` +
        'FOREIGN KEY (customer_id) REFERENCES customers);',
    );
    expect(column(model, 'orders', 'customer_id').references).toEqual({
      tableId: 'public.customers',
      column: 'id',
    });
  });

  it('resolves an inline REFERENCES with no target column to the target pk', () => {
    const { model } = parseSchemaFile(
      `${PARENT}CREATE TABLE orders (id integer PRIMARY KEY, customer_id integer REFERENCES customers ON DELETE CASCADE);`,
    );
    expect(column(model, 'orders', 'customer_id').references).toEqual({
      tableId: 'public.customers',
      column: 'id',
    });
    expect(relationBetween(model, 'orders', 'customers')?.onDelete).toBe('cascade');
  });

  it('emits a composite foreign key as a multi-column relation', () => {
    const { model } = parseSchemaFile(
      'CREATE TABLE order_items (order_id integer, product_id integer, PRIMARY KEY (order_id, product_id));\n' +
        'CREATE TABLE shipment_lines (\n' +
        '  id integer PRIMARY KEY,\n' +
        '  order_id integer NOT NULL,\n' +
        '  product_id integer NOT NULL,\n' +
        '  CONSTRAINT shipment_lines_item_fk FOREIGN KEY (order_id, product_id)\n' +
        '    REFERENCES order_items (order_id, product_id) ON DELETE CASCADE\n' +
        ');',
    );
    const rel = relationBetween(model, 'shipment_lines', 'order_items');
    expect(rel?.from.columns).toEqual(['order_id', 'product_id']);
    expect(rel?.to.columns).toEqual(['order_id', 'product_id']);
    expect(rel?.onDelete).toBe('cascade');
  });

  it('warns instead of guessing when a composite FK arity does not match the target', () => {
    const { model, warnings } = parseSchemaFile(
      `${PARENT}CREATE TABLE notes (\n` +
        '  a integer, b integer,\n' +
        '  FOREIGN KEY (a, b) REFERENCES customers\n' +
        ');',
    );
    expect(model.relations).toHaveLength(0);
    expect(warnings.some((w) => /composite foreign key on "notes"/.test(w))).toBe(true);
  });

  it('accepts MySQL’s optional index name between FOREIGN KEY and its column list', () => {
    const { model } = parseSchemaFile(
      'CREATE TABLE `customers` (`id` int PRIMARY KEY) ENGINE=InnoDB;\n' +
        'CREATE TABLE `orders` (\n' +
        '  `id` int PRIMARY KEY,\n' +
        '  `customer_id` int,\n' +
        '  CONSTRAINT `fk_orders_customer` FOREIGN KEY `fk_orders_customer_idx` (`customer_id`)\n' +
        '    REFERENCES `customers` (`id`) ON DELETE CASCADE\n' +
        ') ENGINE=InnoDB;',
    );
    expect(relationBetween(model, 'orders', 'customers')?.onDelete).toBe('cascade');
  });

  it('parses a MySQL FOREIGN KEY whose CONSTRAINT symbol is omitted', () => {
    const { model } = parseSchemaFile(
      'CREATE TABLE `customers` (`id` int PRIMARY KEY) ENGINE=InnoDB;\n' +
        'CREATE TABLE `orders` (\n' +
        '  `id` int PRIMARY KEY,\n' +
        '  `customer_id` int,\n' +
        '  CONSTRAINT FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE CASCADE\n' +
        ') ENGINE=InnoDB;',
    );
    expect(relationBetween(model, 'orders', 'customers')?.onDelete).toBe('cascade');
    expect(table(model, 'orders').indexes).toHaveLength(0);
  });
});

describe('sql — postgres column shapes', () => {
  it('keeps the full type phrase for WITHOUT TIME ZONE, double precision and intervals', () => {
    const { model } = parseSchemaFile(
      'CREATE TABLE readings (\n' +
        '  id integer PRIMARY KEY,\n' +
        '  taken_at timestamp(3) without time zone NOT NULL,\n' +
        '  mass double precision,\n' +
        '  age interval year to month,\n' +
        '  flags bit varying(8)\n' +
        ');',
    );
    expect(column(model, 'readings', 'taken_at').dbType).toBe('timestamp(3) without time zone');
    expect(column(model, 'readings', 'taken_at').logicalType).toBe('timestamp');
    expect(column(model, 'readings', 'mass').logicalType).toBe('float');
    expect(column(model, 'readings', 'age').dbType).toBe('interval');
    expect(column(model, 'readings', 'age').logicalType).toBe('interval');
    expect(column(model, 'readings', 'flags').logicalType).toBe('binary');
  });

  it('treats the ARRAY keyword and a sized array suffix as arrays', () => {
    const { model, warnings } = parseSchemaFile(
      'CREATE TABLE matrices (id integer PRIMARY KEY, labels text ARRAY, grid integer[3][3]);',
    );
    expect(column(model, 'matrices', 'labels').isArray).toBe(true);
    expect(column(model, 'matrices', 'grid').isArray).toBe(true);
    // The `[3]` bounds are not part of the type; they are dropped, with a warning.
    expect(column(model, 'matrices', 'grid').dbType).toBe('integer[]');
    expect(warnings.some((w) => /ignored trailing tokens/.test(w))).toBe(true);
  });

  it('strips trailing casts (including array casts) from a DEFAULT expression', () => {
    const { model } = parseSchemaFile(
      "CREATE TABLE docs (\n" +
        '  id integer PRIMARY KEY,\n' +
        "  tags text[] DEFAULT '{}'::text[] NOT NULL,\n" +
        "  title character varying(40) DEFAULT 'untitled'::character varying\n" +
        ');',
    );
    expect(column(model, 'docs', 'tags').default).toEqual({ kind: 'literal', text: '{}' });
    expect(column(model, 'docs', 'tags').nullable).toBe(false);
    expect(column(model, 'docs', 'title').default).toEqual({ kind: 'literal', text: 'untitled' });
  });

  it('reads identity columns and stored generated columns', () => {
    const { model } = parseSchemaFile(
      'CREATE TABLE invoices (\n' +
        '  id integer GENERATED BY DEFAULT AS IDENTITY (START WITH 100) PRIMARY KEY,\n' +
        '  seq bigint GENERATED ALWAYS AS IDENTITY,\n' +
        '  net numeric(10,2) NOT NULL,\n' +
        '  vat numeric(10,2) NOT NULL,\n' +
        '  gross numeric(10,2) GENERATED ALWAYS AS (net + vat) STORED\n' +
        ');',
    );
    expect(column(model, 'invoices', 'id').default).toEqual({ kind: 'autoincrement' });
    expect(column(model, 'invoices', 'seq').default).toEqual({ kind: 'autoincrement' });
    expect(column(model, 'invoices', 'gross').isGenerated).toBe(true);
    expect(column(model, 'invoices', 'gross').default).toBeNull();
  });

  it('reads inline CONSTRAINT names, explicit NULL, inline UNIQUE and COLLATE', () => {
    const { model } = parseSchemaFile(
      'CREATE TABLE people (\n' +
        '  id integer CONSTRAINT people_pkey PRIMARY KEY,\n' +
        '  email text CONSTRAINT people_email_key UNIQUE,\n' +
        '  nickname text NULL,\n' +
        '  sort_name text COLLATE "C" NOT NULL\n' +
        ');',
    );
    expect(table(model, 'people').primaryKey).toEqual(['id']);
    expect(column(model, 'people', 'email').isUnique).toBe(true);
    expect(column(model, 'people', 'nickname').nullable).toBe(true);
    expect(column(model, 'people', 'sort_name').nullable).toBe(false);
    expect(column(model, 'people', 'sort_name').logicalType).toBe('text');
  });

  it('serial columns imply NOT NULL and an autoincrement default', () => {
    const { model } = parseSchemaFile(
      'CREATE TABLE tickets (id serial PRIMARY KEY, ref bigserial, note text);',
    );
    expect(column(model, 'tickets', 'ref').default).toEqual({ kind: 'autoincrement' });
    expect(column(model, 'tickets', 'ref').nullable).toBe(false);
    expect(column(model, 'tickets', 'ref').logicalType).toBe('bigint');
  });
});

describe('sql — views, types and indexes', () => {
  it('imports CREATE VIEW / MATERIALIZED VIEW when the column list is explicit', () => {
    const { model } = parseSchemaFile(
      'CREATE TABLE products (id integer PRIMARY KEY, name text, active boolean);\n' +
        'CREATE OR REPLACE VIEW active_products (id, name) AS SELECT id, name FROM products WHERE active;\n' +
        'CREATE MATERIALIZED VIEW product_counts (total) AS SELECT count(*) FROM products;',
    );
    expect(table(model, 'active_products').kind).toBe('view');
    expect(table(model, 'active_products').columns.map((c) => c.name)).toEqual(['id', 'name']);
    expect(table(model, 'product_counts').kind).toBe('materialized-view');
  });

  it('skips a view with no column list rather than importing an empty table', () => {
    const { model, warnings } = parseSchemaFile(
      'CREATE TABLE products (id integer PRIMARY KEY);\n' +
        'CREATE VIEW cheap AS SELECT id FROM products;',
    );
    expect(model.tables.map((t) => t.name)).toEqual(['products']);
    expect(warnings.some((w) => /skipped CREATE VIEW without column list/.test(w))).toBe(true);
  });

  it('skips a non-enum CREATE TYPE with a warning', () => {
    const { model, warnings } = parseSchemaFile(
      'CREATE TYPE address AS (street text, city text);\n' +
        'CREATE TABLE places (id integer PRIMARY KEY, home address);',
    );
    expect(model.enums).toHaveLength(0);
    expect(column(model, 'places', 'home').logicalType).toBe('unknown');
    expect(warnings.some((w) => /skipped CREATE TYPE \(non-enum\)/.test(w))).toBe(true);
  });

  it('records the index method and marks partial indexes', () => {
    const { model } = parseSchemaFile(
      'CREATE TABLE posts (id integer PRIMARY KEY, tags text[], body text);\n' +
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_posts_tags ON ONLY public.posts USING gin (tags);\n' +
        'CREATE INDEX idx_posts_body ON posts (body) WHERE body IS NOT NULL;',
    );
    const posts = table(model, 'posts');
    expect(posts.indexes.find((ix) => ix.name === 'idx_posts_tags')?.method).toBe('gin');
    expect(posts.indexes.find((ix) => ix.name === 'idx_posts_body')?.partial).toBe(true);
    expect(posts.indexes.find((ix) => ix.name === 'idx_posts_tags')?.partial).toBe(false);
  });

  it('warns when CREATE INDEX names a table that is not in the file', () => {
    const { warnings } = parseSchemaFile(
      'CREATE TABLE posts (id integer PRIMARY KEY);\nCREATE INDEX idx_legacy ON archived_posts (id);',
    );
    expect(warnings.some((w) => /CREATE INDEX on unknown table "archived_posts"/.test(w))).toBe(true);
  });

  it('skips COMMENT ON targets other than tables and columns', () => {
    const { warnings } = parseSchemaFile(
      'CREATE TABLE t (id integer PRIMARY KEY);\n' +
        "COMMENT ON SCHEMA public IS 'standard public schema';",
    );
    expect(warnings.some((w) => /skipped COMMENT ON SCHEMA statement/.test(w))).toBe(true);
  });
});

describe('sql — ALTER TABLE migrations', () => {
  const base = 'CREATE TABLE users (id integer PRIMARY KEY, email text);\n';

  it('adds a column declared by ALTER TABLE ADD COLUMN', () => {
    const { model } = parseSchemaFile(
      `${base}ALTER TABLE users ADD COLUMN IF NOT EXISTS locale text DEFAULT 'en' NOT NULL;`,
    );
    expect(column(model, 'users', 'locale').default).toEqual({ kind: 'literal', text: 'en' });
    expect(column(model, 'users', 'locale').nullable).toBe(false);
  });

  it('applies SET NOT NULL and DROP NOT NULL, with or without the COLUMN keyword', () => {
    const { model } = parseSchemaFile(
      `${base}ALTER TABLE users ALTER COLUMN email SET NOT NULL;\n` +
        'ALTER TABLE users ADD COLUMN nickname text NOT NULL;\n' +
        'ALTER TABLE users ALTER nickname DROP NOT NULL;',
    );
    expect(column(model, 'users', 'email').nullable).toBe(false);
    expect(column(model, 'users', 'nickname').nullable).toBe(true);
  });

  it('adds a bare PRIMARY KEY / UNIQUE without a CONSTRAINT name', () => {
    const { model } = parseSchemaFile(
      'CREATE TABLE `logs` (`id` int NOT NULL AUTO_INCREMENT, `slug` varchar(20)) ENGINE=InnoDB;\n' +
        'ALTER TABLE `logs` ADD PRIMARY KEY (`id`);\n' +
        'ALTER TABLE `logs` ADD UNIQUE KEY `logs_slug` (`slug`);',
    );
    expect(table(model, 'logs').primaryKey).toEqual(['id']);
    expect(column(model, 'logs', 'slug').isUnique).toBe(true);
  });

  it('skips unmodelled ALTER TABLE actions without losing the table', () => {
    const { model, warnings } = parseSchemaFile(
      `${base}ALTER TABLE public.users OWNER TO postgres;\n` +
        'ALTER TABLE users ALTER COLUMN email TYPE character varying(320);\n' +
        'ALTER TABLE nowhere ADD CONSTRAINT nowhere_pkey PRIMARY KEY (id);',
    );
    expect(model.tables.map((t) => t.name)).toEqual(['users']);
    expect(warnings.some((w) => /skipped ALTER TABLE OWNER action/.test(w))).toBe(true);
    expect(warnings.some((w) => /skipped ALTER TABLE ALTER COLUMN action/.test(w))).toBe(true);
    expect(warnings.some((w) => /ALTER TABLE on unknown table "nowhere"/.test(w))).toBe(true);
  });
});

describe('sql — mysql spellings', () => {
  const mysql = (body: string): string =>
    `CREATE TABLE \`articles\` (\n${body}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;

  it('reads UNIQUE KEY / KEY / FULLTEXT KEY / SPATIAL INDEX table constraints', () => {
    const { model } = parseSchemaFile(
      mysql(
        '  `id` int NOT NULL AUTO_INCREMENT,\n' +
          '  `slug` varchar(64) NOT NULL,\n' +
          '  `body` text,\n' +
          '  `place` geometry NOT NULL,\n' +
          '  PRIMARY KEY (`id`),\n' +
          '  UNIQUE KEY `uq_articles_slug` (`slug`),\n' +
          '  KEY `idx_articles_body` (`body`),\n' +
          '  FULLTEXT KEY `ft_articles_body` (`body`),\n' +
          '  SPATIAL INDEX `sp_articles_place` (`place`)',
      ),
    );
    const articles = table(model, 'articles');
    expect(column(model, 'articles', 'slug').isUnique).toBe(true);
    expect(articles.indexes.map((ix) => ix.name).sort()).toEqual([
      'ft_articles_body',
      'idx_articles_body',
      'sp_articles_place',
    ]);
    expect(articles.indexes.every((ix) => ix.unique === false)).toBe(true);
  });

  it('reads CHARACTER SET / CHARSET / ON UPDATE and virtual generated columns', () => {
    const { model } = parseSchemaFile(
      mysql(
        '  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,\n' +
          "  `title` varchar(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '',\n" +
          '  `summary` text CHARSET latin1,\n' +
          '  `title_len` int AS (CHAR_LENGTH(`title`)) VIRTUAL,\n' +
          '  `touched_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
      ),
    );
    expect(column(model, 'articles', 'title').maxLength).toBe(120);
    expect(column(model, 'articles', 'title').default).toEqual({ kind: 'literal', text: '' });
    expect(column(model, 'articles', 'summary').logicalType).toBe('text');
    expect(column(model, 'articles', 'title_len').isGenerated).toBe(true);
    expect(column(model, 'articles', 'touched_at').default).toEqual({ kind: 'now' });
  });

  it('drops a functional index rather than inventing a phantom column', () => {
    const { model } = parseSchemaFile(
      mysql(
        '  `id` int NOT NULL AUTO_INCREMENT,\n' +
          '  `title` varchar(120) NOT NULL,\n' +
          '  PRIMARY KEY (`id`),\n' +
          '  KEY `idx_title_len` ((CHAR_LENGTH(`title`)))',
      ),
    );
    expect(table(model, 'articles').indexes).toHaveLength(0);
    expect(table(model, 'articles').columns.map((c) => c.name)).toEqual(['id', 'title']);
  });

  it('names an unnamed KEY after the table and warns on unknown column modifiers', () => {
    const { model, warnings } = parseSchemaFile(
      mysql(
        '  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,\n' +
          '  `body` text,\n' +
          '  `place` geometry NOT NULL SRID 4326,\n' +
          '  `body_len` int GENERATED ALWAYS AS (CHAR_LENGTH(`body`)) VIRTUAL,\n' +
          '  KEY (`body`)',
      ),
    );
    expect(table(model, 'articles').indexes.map((ix) => ix.name)).toEqual(['articles_idx']);
    expect(column(model, 'articles', 'body_len').isGenerated).toBe(true);
    expect(warnings.some((w) => /ignored column modifier SRID/.test(w))).toBe(true);
  });

  it('reads a table COMMENT from the mysql options tail', () => {
    const { model } = parseSchemaFile(
      "CREATE TABLE `t` (`id` int PRIMARY KEY) ENGINE=InnoDB COMMENT='It''s a table';",
    );
    expect(table(model, 't').comment).toBe("It's a table");
  });
});

describe('sql — sqlite and other dialect edges', () => {
  it('accepts sqlite typeless columns, warning once per skipped column', () => {
    const { model, warnings } = parseSchemaFile(
      'CREATE TABLE kv (name TEXT PRIMARY KEY, value) WITHOUT ROWID;',
    );
    expect(model.dialect).toBe('sqlite');
    expect(table(model, 'kv').columns.map((c) => c.name)).toEqual(['name']);
    expect(warnings.some((w) => /skipped unparseable column on "kv"/.test(w))).toBe(true);
  });

  it('accepts CREATE TEMPORARY / UNLOGGED tables', () => {
    // Auto-detection keys off a bare `CREATE TABLE`, so these need the format
    // the import wizard would have been told explicitly.
    const { model } = parseSchemaFile(
      'CREATE UNLOGGED TABLE staging (id integer PRIMARY KEY);\n' +
        'CREATE GLOBAL TEMPORARY TABLE scratch (id integer PRIMARY KEY);',
      { format: 'sql' },
    );
    expect(model.tables.map((t) => t.name).sort()).toEqual(['scratch', 'staging']);
  });

  it('skips an EXCLUDE constraint without dropping the table', () => {
    const { model, warnings } = parseSchemaFile(
      'CREATE TABLE bookings (\n' +
        '  id integer PRIMARY KEY,\n' +
        '  room_id integer NOT NULL,\n' +
        '  during tsrange NOT NULL,\n' +
        '  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (room_id WITH =, during WITH &&)\n' +
        ');',
    );
    expect(table(model, 'bookings').columns).toHaveLength(3);
    expect(warnings.some((w) => /skipped unsupported table constraint/.test(w))).toBe(true);
  });
});

describe('sql — CHECK to enum synthesis edges', () => {
  it('does not re-synthesize an enum for a column that already has one', () => {
    const { model } = parseSchemaFile(
      'CREATE TABLE `jobs` (\n' +
        "  `id` int PRIMARY KEY,\n" +
        "  `state` enum('queued','done') NOT NULL CHECK (`state` IN ('queued','done'))\n" +
        ') ENGINE=InnoDB;',
    );
    expect(model.enums).toHaveLength(1);
    expect(model.enums[0]?.source).toBe('column-type');
    expect(column(model, 'jobs', 'state').enumRef).toBe('public.jobs.state');
  });

  it('keeps a CHECK naming an unknown column but synthesizes nothing from it', () => {
    const { model } = parseSchemaFile(
      "CREATE TABLE jobs (id integer PRIMARY KEY, CHECK (missing IN ('a','b')));",
    );
    expect(model.enums).toHaveLength(0);
    expect(table(model, 'jobs').checks).toHaveLength(1);
  });
});

describe('sql — statement splitting', () => {
  it('keeps a doubled quote inside a literal from ending the statement', () => {
    const { model } = parseSchemaFile(
      "CREATE TABLE quips (id integer PRIMARY KEY, saying text DEFAULT 'it''s; fine');",
    );
    expect(column(model, 'quips', 'saying').default).toEqual({ kind: 'literal', text: "it's; fine" });
  });

  it('keeps line numbers correct across a multi-line dollar-quoted body', () => {
    const { warnings } = parseSchemaFile(
      'CREATE FUNCTION bump() RETURNS trigger AS $body$\nBEGIN\n  RETURN NEW;\nEND;\n$body$ LANGUAGE plpgsql;\n' +
        'CREATE TABLE (((;\n' +
        'CREATE TABLE ok (id integer PRIMARY KEY);',
    );
    expect(warnings.some((w) => /could not parse CREATE TABLE at line 6/.test(w))).toBe(true);
  });

  it('treats a bare $ inside an identifier as an ordinary character', () => {
    const { model } = parseSchemaFile(
      'CREATE TABLE ledger (id integer PRIMARY KEY, total$ numeric(12,2));',
    );
    expect(column(model, 'ledger', 'total$').logicalType).toBe('decimal');
  });

  it('parses a final statement with no trailing semicolon', () => {
    const { model } = parseSchemaFile('CREATE TABLE tail (id integer PRIMARY KEY, note text)');
    expect(table(model, 'tail').columns).toHaveLength(2);
  });

  it('recovers the columns of a table truncated mid-literal', () => {
    const { model } = parseSchemaFile(
      'CREATE TABLE ok (id integer PRIMARY KEY);\n' +
        "CREATE TABLE broken (id integer, note text DEFAULT 'unterminated",
    );
    expect(model.tables.map((t) => t.name)).toEqual(['ok', 'broken']);
    expect(table(model, 'broken').columns.map((c) => c.name)).toEqual(['id', 'note']);
    // The literal never closes, so it stays an opaque expression rather than
    // being silently "closed" at end of file.
    expect(column(model, 'broken', 'note').default).toEqual({
      kind: 'expression',
      text: "'unterminated",
    });
  });

  it('does not hang or throw on a dump truncated inside a dollar-quoted body', () => {
    const { model } = parseSchemaFile(
      'CREATE TABLE ok (id integer PRIMARY KEY);\n' +
        'CREATE FUNCTION f() RETURNS void AS $body$ BEGIN',
    );
    expect(model.tables.map((t) => t.name)).toEqual(['ok']);
  });

  it('rejects an input whose only content is comments', () => {
    expect(() =>
      parseSchemaFile('-- CREATE TABLE nothing (id int);\n/* nor here */\n', { format: 'sql' }),
    ).toThrow(SchemaImportError);
  });
});
