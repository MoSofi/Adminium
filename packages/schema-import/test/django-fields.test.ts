// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Django models.py parser — field options, relation forms and `class Meta`
 * shapes the Northwind fixture does not use: OneToOneField, self-references,
 * `through=` models, the `app.Model` target spelling, the remaining
 * `on_delete` policies and the multi-line Meta values a real models.py has.
 */
import { describe, expect, it } from 'vitest';

import { parseSchemaFile, SchemaImportError } from '../src/index.js';
import { column, relationBetween, table } from './helpers.js';

const parse = (src: string) => parseSchemaFile(src, { format: 'django' });
const py = (...lines: string[]): string => `from django.db import models\n\n${lines.join('\n')}\n`;

describe('django — relations', () => {
  it('makes a OneToOneField a unique one-to-one FK', () => {
    const { model } = parse(
      py(
        'class Profile(models.Model):',
        '    user = models.OneToOneField("Account", on_delete=models.CASCADE)',
        '',
        'class Account(models.Model):',
        '    email = models.EmailField()',
      ),
    );
    expect(column(model, 'profile', 'user_id').isUnique).toBe(true);
    expect(relationBetween(model, 'profile', 'account')?.cardinality).toBe('one-to-one');
  });

  it('resolves a self-referential ForeignKey to its own table', () => {
    const { model } = parse(
      py(
        'class Category(models.Model):',
        '    name = models.CharField(max_length=40)',
        '    parent = models.ForeignKey("self", on_delete=models.SET_NULL, null=True)',
      ),
    );
    const rel = relationBetween(model, 'category', 'category');
    expect(rel?.selfReferential).toBe(true);
    expect(rel?.onDelete).toBe('set-null');
  });

  it('accepts the app-qualified target spelling and the to= keyword form', () => {
    const { model } = parse(
      py(
        'class Order(models.Model):',
        '    customer = models.ForeignKey("shop.Customer", on_delete=models.DO_NOTHING)',
        '    biller = models.ForeignKey(to="Customer", on_delete=models.SET_DEFAULT, default=1)',
        '',
        'class Customer(models.Model):',
        '    email = models.EmailField()',
      ),
    );
    expect(relationBetween(model, 'order', 'customer')?.onDelete).toBe('no-action');
    expect(column(model, 'order', 'biller_id').references).toMatchObject({
      tableId: 'public.customer',
    });
  });

  it('honours db_column, to_field, unique and primary_key on a ForeignKey', () => {
    const { model } = parse(
      py(
        'class Membership(models.Model):',
        '    account = models.ForeignKey("Account", on_delete=models.CASCADE, db_column="acct", to_field="slug", primary_key=True)',
        '',
        'class Account(models.Model):',
        '    slug = models.SlugField(unique=True)',
      ),
    );
    const acct = column(model, 'membership', 'acct');
    expect(acct.isPrimaryKey).toBe(true);
    expect(acct.references).toEqual({ tableId: 'public.account', column: 'slug' });
    // primary_key=True on the FK suppresses the implicit `id` column.
    expect(table(model, 'membership').columns.map((c) => c.name)).toEqual(['acct']);
  });

  it('warns when a ForeignKey targets a model outside the file', () => {
    const { model, warnings } = parse(
      py(
        'class Order(models.Model):',
        '    owner = models.ForeignKey("auth.User", on_delete=models.CASCADE)',
      ),
    );
    expect(column(model, 'order', 'owner_id').references).toBeNull();
    expect(warnings.some((w) => /ForeignKey "Order.owner" targets/.test(w))).toBe(true);
  });

  it('emits a m2m relation through an explicit through model instead of synthesizing one', () => {
    const { model, warnings } = parse(
      py(
        'class Product(models.Model):',
        '    tags = models.ManyToManyField("Tag", through="Tagging")',
        '',
        'class Tag(models.Model):',
        '    label = models.CharField(max_length=20)',
        '',
        'class Tagging(models.Model):',
        '    product = models.ForeignKey("Product", on_delete=models.CASCADE)',
        '    tag = models.ForeignKey("Tag", on_delete=models.CASCADE)',
        '    added_by = models.CharField(max_length=20)',
      ),
    );
    expect(model.tables.map((t) => t.name).sort()).toEqual(['product', 'tag', 'tagging']);
    const m2m = model.relations.find((r) => r.kind === 'inferred-join-table');
    expect(m2m?.through).toEqual({
      tableId: 'public.tagging',
      fromColumns: ['product_id'],
      toColumns: ['tag_id'],
    });
    expect(warnings.some((w) => /synthesized join table/.test(w))).toBe(false);
  });

  it('warns when the through model is not in the file', () => {
    const { model, warnings } = parse(
      py(
        'class Product(models.Model):',
        '    tags = models.ManyToManyField("Tag", through="Tagging")',
        '',
        'class Tag(models.Model):',
        '    label = models.CharField(max_length=20)',
      ),
    );
    expect(model.relations).toHaveLength(0);
    expect(warnings.some((w) => /through "Tagging" not found/.test(w))).toBe(true);
  });

  it('warns when a ManyToManyField targets a model outside the file', () => {
    const { model, warnings } = parse(
      py('class Product(models.Model):', '    groups = models.ManyToManyField("auth.Group")'),
    );
    expect(model.tables.map((t) => t.name)).toEqual(['product']);
    expect(warnings.some((w) => /targets a model outside this file; skipped/.test(w))).toBe(true);
  });

  it('disambiguates the two sides of a self-referential ManyToManyField', () => {
    const { model } = parse(
      py(
        'class Person(models.Model):',
        '    name = models.CharField(max_length=20)',
        '    friends = models.ManyToManyField("self")',
      ),
    );
    const join = table(model, 'person_friends');
    expect(join.columns.map((c) => c.name)).toEqual(['id', 'person_id', 'to_person_id']);
    expect(join.uniques).toEqual([{ name: null, columns: ['person_id', 'to_person_id'] }]);
  });
});

describe('django — field options', () => {
  it('classifies the default= forms', () => {
    const { model } = parse(
      py(
        'import uuid',
        'class Thing(models.Model):',
        '    key = models.UUIDField(default=uuid.uuid4)',
        '    tags = models.JSONField(default=list)',
        '    meta = models.JSONField(default=dict)',
        '    note = models.TextField(default=None, null=True)',
        '    label = models.CharField(max_length=8, default=make_label)',
        '    live = models.BooleanField(default=False)',
        '    rank = models.IntegerField(default=-3)',
      ),
    );
    expect(column(model, 'thing', 'key').default).toEqual({ kind: 'uuid' });
    expect(column(model, 'thing', 'tags').default).toEqual({ kind: 'expression', text: 'list()' });
    expect(column(model, 'thing', 'meta').default).toEqual({ kind: 'expression', text: 'dict()' });
    expect(column(model, 'thing', 'note').default).toBeNull();
    expect(column(model, 'thing', 'label').default).toEqual({
      kind: 'expression',
      text: 'make_label',
    });
    expect(column(model, 'thing', 'live').default).toEqual({ kind: 'literal', text: 'false' });
    expect(column(model, 'thing', 'rank').default).toEqual({ kind: 'literal', text: '-3' });
  });

  it('reads an explicit AutoField primary key and db_index', () => {
    const { model } = parse(
      py(
        'class Legacy(models.Model):',
        '    legacy_id = models.AutoField(primary_key=True)',
        '    code = models.CharField(max_length=8, db_index=True)',
      ),
    );
    const pk = column(model, 'legacy', 'legacy_id');
    expect(pk.isPrimaryKey).toBe(true);
    expect(pk.default).toEqual({ kind: 'autoincrement' });
    expect(pk.nullable).toBe(false);
    expect(table(model, 'legacy').columns.map((c) => c.name)).toEqual(['legacy_id', 'code']);
    expect(table(model, 'legacy').indexes.map((i) => i.name)).toEqual(['legacy_code_idx']);
  });

  it('accepts integer choices and warns when choices are a symbol it cannot resolve', () => {
    const { model, warnings } = parse(
      py(
        'class Thing(models.Model):',
        '    priority = models.IntegerField(choices=[(1, "Low"), (2, "High")])',
        '    kind = models.CharField(max_length=8, choices=KIND_CHOICES)',
      ),
    );
    const priority = column(model, 'thing', 'priority');
    expect(model.enums.find((e) => e.id === priority.enumRef)?.values).toEqual(['1', '2']);
    expect(column(model, 'thing', 'kind').logicalType).toBe('varchar');
    expect(warnings.some((w) => /choices for "Thing.kind" could not be resolved/.test(w))).toBe(true);
  });

  it('honours db_column on an ordinary field', () => {
    const { model } = parse(
      py('class Thing(models.Model):', '    label = models.CharField(max_length=8, db_column="lbl")'),
    );
    expect(table(model, 'thing').columns.map((c) => c.name)).toEqual(['id', 'lbl']);
  });
});

describe('django — class Meta', () => {
  it('reads a multi-line unique_together and a single tuple form', () => {
    const { model } = parse(
      py(
        'class Booking(models.Model):',
        '    room = models.ForeignKey("Room", on_delete=models.CASCADE)',
        '    day = models.DateField()',
        '    slot = models.IntegerField()',
        '',
        '    class Meta:',
        '        db_table = "bookings"',
        '        unique_together = (',
        '            ("room", "day"),',
        '            ("room", "slot"),',
        '        )',
        '',
        'class Room(models.Model):',
        '    name = models.CharField(max_length=20)',
        '',
        '    class Meta:',
        '        unique_together = ("name",)',
      ),
    );
    expect(table(model, 'bookings').uniques).toEqual([
      { name: null, columns: ['room_id', 'day'] },
      { name: null, columns: ['room_id', 'slot'] },
    ]);
    expect(table(model, 'room').uniques).toEqual([{ name: null, columns: ['name'] }]);
  });

  it('leaves Meta when the class body dedents back to field level', () => {
    const { model } = parse(
      py(
        'class Thing(models.Model):',
        '    class Meta:',
        '        db_table = "things"',
        '    label = models.CharField(max_length=8)',
        '    # a comment between fields',
        '    note = models.TextField(null=True)',
      ),
    );
    expect(table(model, 'things').columns.map((c) => c.name)).toEqual(['id', 'label', 'note']);
  });

  it('ignores decorators and non-field statements in the class body', () => {
    const { model } = parse(
      py(
        'class Thing(models.Model):',
        '    label = models.CharField(max_length=8)',
        '',
        '    def __str__(self):',
        '        return self.label  # not a field',
        '',
        '    @property',
        '    def shouty(self):',
        '        return "a \\" quoted # hash"',
      ),
    );
    expect(table(model, 'thing').columns.map((c) => c.name)).toEqual(['id', 'label']);
  });

  it('reads list-of-list choices and ignores a trailing comment on a field line', () => {
    const { model } = parse(
      py(
        'class Thing(models.Model):',
        '    kind = models.CharField(max_length=8, choices=[["a", "A"], ("b", "B")])  # two spellings',
        '    label = models.CharField(max_length=8)  # trailing comment',
      ),
    );
    const kind = column(model, 'thing', 'kind');
    // Only the tuple spelling carries values Django would store.
    expect(model.enums.find((e) => e.id === kind.enumRef)?.values).toEqual(['b']);
    expect(column(model, 'thing', 'label').maxLength).toBe(8);
  });

  it('ignores Meta lines that are not simple lowercase assignments', () => {
    const { model } = parse(
      py(
        'class Thing(models.Model):',
        '    label = models.CharField(max_length=8)',
        '',
        '    class Meta:',
        '        VERBOSE = "not lowercase"',
        '        ordering = ["-label"]',
        '        db_table = "things"',
      ),
    );
    expect(model.tables.map((t) => t.name)).toEqual(['things']);
  });

  it('reads a unique_together listing plain field names', () => {
    const { model } = parse(
      py(
        'class Thing(models.Model):',
        '    a = models.CharField(max_length=4)',
        '    b = models.CharField(max_length=4)',
        '',
        '    class Meta:',
        '        unique_together = ["a", "b"]',
      ),
    );
    expect(table(model, 'thing').uniques).toEqual([{ name: null, columns: ['a', 'b'] }]);
  });

  it('throws when the file declares no models', () => {
    expect(() => parse('from django.db import models\n\nCHOICES = []\n')).toThrow(SchemaImportError);
  });
});
