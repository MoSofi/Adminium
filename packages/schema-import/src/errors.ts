/** Thrown for fatal import problems (undetectable format, unparseable JSON, invalid IR). */
export class SchemaImportError extends Error {
  override readonly name = 'SchemaImportError';

  constructor(
    message: string,
    /** Optional detail lines (e.g. Zod issue paths) already embedded in `message`. */
    readonly details: readonly string[] = [],
  ) {
    super(message);
  }
}
