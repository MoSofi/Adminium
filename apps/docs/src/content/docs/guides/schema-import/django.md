---
title: Import Django models
description: Import models.py. Fields, relations, Meta options, and the implicit id every Django model gets.
---

## The file

Your `models.py`. Concatenate across apps, or import one app's models.

## Detection

Adminium detects Django by `models.Model` or `models.*Field(` calls.

## What is read

| Django | Becomes |
|---|---|
| `class X(models.Model)` | table |
| `models.*Field` | columns |
| Implicit `id`, or `primary_key=True` | primary key |
| `ForeignKey`, `OneToOneField` | foreign key + relation |
| `ManyToManyField` | join table |
| `null=True` | nullable |
| `unique=True` | unique constraint |
| `default=…` | default |
| `choices=…` | enum → select input |
| `db_column=` | **the real column name** |
| `Meta.db_table` | the real table name |
| `help_text=` | field description |

## Table names

Django derives table names as `<app_label>_<modelname>`, lowercased — a rule
that needs the **app**, which `models.py` alone does not state. Adminium applies
the convention as best it can from the file. If your table names matter (they
do), be explicit:

```python
class User(models.Model):
    class Meta:
        db_table = 'users'
```

`Meta.db_table` is always read correctly.

## Column names

- **`ForeignKey` appends `_id`.** `models.ForeignKey(Author, …)` on a field
  named `author` becomes the column `author_id`. Adminium follows this.
- **`db_column`** overrides everything and is always read correctly.

## The implicit `id`

Every Django model gets an auto primary key unless one is declared. Which type
depends on `DEFAULT_AUTO_FIELD` in `settings.py` — `AutoField` (integer) or
`BigAutoField` (bigint) — which is not in `models.py`. Adminium assumes
`BigAutoField`, Django's default since 3.2. Declare the field explicitly if it
matters.

## `choices` becomes an enum

```python
STATUS = [('draft', 'Draft'), ('live', 'Live')]
status = models.CharField(max_length=10, choices=STATUS)
```

Adminium imports the values as an enum and the labels as display names — so the
select reads "Draft", not "draft". This works when `choices` is a literal or a
module-level literal list. Callables and querysets are not evaluated.

## The static-analysis limit

`models.py` is Python, parsed and not executed. Literals are read; anything
computed at import time is not. Abstract base classes with `Meta.abstract = True`
flatten into their concrete children, matching what Django creates.

## Notes

- **`GenericForeignKey`** is `content_type_id` + `object_id` and no constraint —
  two columns, no relation, same as Rails polymorphic.
- **Multi-table inheritance** creates a parent table plus a child table with a
  one-to-one PK/FK. Adminium imports both, which is what exists.
