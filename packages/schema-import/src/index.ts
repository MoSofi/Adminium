/**
 * @adminium/schema-import — schema-file parsers producing the engine's
 * DatabaseModel IR (05-introspection-engine.md §5): SQL DDL / pg_dump /
 * mysqldump, Prisma, Drizzle, TypeORM, Sequelize, Rails schema.rb, Django
 * models.py, and the public JSON IR (which is simply the DatabaseModel
 * schema itself). Setup never reads rows — these parsers see schema text
 * only.
 */
export const PACKAGE_NAME = '@adminium/schema-import';

export { parseSchemaFile } from './parse.js';
export { detectFormat, detectCandidates } from './detect.js';
export { SchemaImportError } from './errors.js';
export {
  FORMATS,
  FORMAT_TO_IR,
  type Format,
  type ParseSchemaFileOptions,
  type ParseSchemaFileResult,
} from './types.js';
