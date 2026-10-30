import type { z } from 'zod';

/**
 * An error the UI can explain. `code` is a stable, machine-readable reason mapped to a localized
 * message; `message` is the English fallback; `field` names the input that failed validation.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public code?: string,
    public field?: string,
  ) {
    super(message);
  }
}

/** Validates input against a schema, throwing a 'validation' AppError for the first problem. */
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);

  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.join('.');

    throw new AppError(`${field ? `${field}: ` : ''}${issue.message}`, 'validation', field || undefined);
  }

  return result.data;
}
