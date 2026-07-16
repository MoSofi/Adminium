---
title: Import Sequelize models
description: Import Sequelize models. define() and Model.init(), DataTypes, and the pluralization that catches everyone.
---

## The file

Your model files. Concatenate, or import the one with the models you want.

## Detection

Adminium detects Sequelize by `sequelize.define(`, `DataTypes.*`, or
`extends Model` alongside an `.init(` call.

## What is read

| Sequelize | Becomes |
|---|---|
| `sequelize.define('User', {…})` | table |
| `class User extends Model` + `User.init({…})` | table |
| `DataTypes.*` | column types |
| `primaryKey: true` | primary key |
| `references: { model, key }` | foreign key + relation |
| `allowNull: false` | non-nullable |
| `unique: true` | unique constraint |
| `defaultValue` | default |
| `DataTypes.ENUM('a','b')` | enum → select input |
| `field: 'column_name'` | **the real column name** |
| `tableName`, `freezeTableName` | the real table name |

## Pluralization is the catch

Sequelize pluralizes model names into table names, by default and invisibly:

```js
sequelize.define('User', { … });
// The table is "Users", not "User".
```

Adminium applies the same default rule. It goes wrong exactly where Sequelize's
own inflector goes wrong — irregular plurals, non-English names, and models
already plural. When in doubt, be explicit:

```js
sequelize.define('User', { … }, { tableName: 'users' });
```

`tableName` and `freezeTableName: true` are both read and both authoritative.

## `underscored: true`

```js
sequelize.define('User', { emailAddress: DataTypes.STRING }, { underscored: true });
// The column is "email_address".
```

Read correctly when the option is in the literal. `field: 'email_address'` is
always read correctly and never guesses.

## Associations

`hasMany` / `belongsTo` / `belongsToMany` are usually declared **outside** the
model definition, in an `associate()` function or an `index.js` that wires
everything together. Adminium reads `references:` in the column definition,
which is the one that produces a real constraint.

If your foreign keys exist only as association calls, either import a
[SQL dump](/guides/schema-import/sql-ddl/) or add `references:` to the columns.

## The static-analysis limit

Model files are JavaScript, parsed and not executed. Literal definitions are
read; computed ones are not.
