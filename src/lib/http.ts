import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isServiceError } from '@/lib/services/errors';

export const strictPositiveIntSchema = z
  .number()
  .int()
  .positive()
  .refine((n) => Number.isSafeInteger(n), 'Must be a safe integer');

export const strictNonNegativeIntSchema = z
  .number()
  .int()
  .min(0)
  .refine((n) => Number.isSafeInteger(n), 'Must be a safe integer');

export const istDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

export const uuidSchema = z.string().uuid('Invalid identifier');

export async function parseJsonBody<T extends z.ZodTypeAny>(
  req: Request,
  schema: T
): Promise<{ data: z.infer<T> } | { errorResponse: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      errorResponse: NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 }),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      errorResponse: NextResponse.json(
        {
          error: 'Validation failed',
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        },
        { status: 400 }
      ),
    };
  }
  return { data: parsed.data };
}

export function handleApiError(err: unknown): NextResponse {
  if (isServiceError(err)) {
    return NextResponse.json({ error: err.message }, { status: err.statusCode });
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  return NextResponse.json({ error: message }, { status: 500 });
}

