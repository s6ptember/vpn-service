/**
 * Expected domain outcome (promo expired, limit reached) is a Result.
 * Unexpected (Marzban down, DB unavailable) throws AppError. Flow is never steered by exceptions.
 */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
