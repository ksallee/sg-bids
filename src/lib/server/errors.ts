/**
 * The one error the server's data layer throws on purpose. `status` is the HTTP status a route
 * answers with; `message` is safe to show the caller.
 */
export class StoreError extends Error {
	constructor(
		readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 500 | 502,
		message: string,
		options?: { cause?: unknown; reason?: string }
	) {
		super(message, options);
		this.name = 'StoreError';
		this.reason = options?.reason;
	}

	/** A word the page can act on, beside the message: `session`, `bid`. */
	readonly reason: string | undefined;
}

/** A database error as a StoreError. The guards raise P0001 (refused) and P0002 (not found). */
export function fromDatabase(error: { code?: string; message: string }): StoreError {
	switch (error.code) {
		case 'P0002':
			return new StoreError(404, error.message, { cause: error });
		case 'P0001':
			return new StoreError(409, error.message, { cause: error });
		case '23505':
			return new StoreError(409, 'That already exists.', { cause: error });
		case '23503':
		case '23514':
		case '22P02':
			return new StoreError(422, 'The data does not fit the request.', { cause: error });
		default:
			return new StoreError(500, 'The database failed.', { cause: error });
	}
}
