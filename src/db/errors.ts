/**
 * @file errors.ts
 * @description Custom Error Definitions.
 * Defines the HttpError class, thrown across the application (e.g. in auth.ts and consume.ts)
 * to signal failures that map directly to an HTTP status code and a machine-readable error code.
 */

/**
 * Custom HTTP error class to handle API error responses uniformly.
 */
export class HttpError extends Error {
  constructor(
    /** HTTP status code to send back to the client (e.g. 401, 404, 409). */
    public statusCode: number,
    /** Machine-readable error identifier (e.g. 'invalid_api_key'). */
    public code: string,
    /** Human-readable error description. */
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
