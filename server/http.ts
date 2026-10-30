import type { ErrorRequestHandler } from 'express';
import { z } from 'zod';

/**
 * An error with a status for the client. `code` is a stable, machine-readable reason the UI
 * maps to a localized message; `message` is the English fallback.
 */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public field?: string,
  ) {
    super(message);
  }
}

export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);

  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.join('.');

    throw new HttpError(400, `${field ? `${field}: ` : ''}${issue.message}`, 'validation', field || undefined);
  }

  return result.data;
}

export function idParam(value: unknown): number {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(404, 'Not found', 'not_found');
  }

  return id;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code, field: err.field });

    return;
  }

  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'File is too large', code: 'file_too_large' });

    return;
  }

  console.error(err);
  res.status(500).json({ error: 'Something went wrong', code: 'server_error' });
};
