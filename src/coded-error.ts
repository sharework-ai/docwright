/**
 * Coded errors for the params HTTP surface. `message` stays the full
 * English problem+cause+fix sentence — the log face and the fallback for
 * clients that don't know the code — while `code`+`params` key the
 * browser's locale catalog so the user reads the same three things in
 * their language. `detail` carries a raw underlying cause (parser output,
 * host assertion) that renders as a secondary line, never interpolated
 * into the localized sentence.
 */

export class CodedError extends Error {
  readonly code: string
  readonly params: Readonly<Record<string, string | number>>
  readonly detail: string | undefined

  constructor(code: string, message: string, options: { params?: Readonly<Record<string, string | number>>; detail?: string } = {}) {
    super(message)
    this.name = 'CodedError'
    this.code = code
    this.params = options.params ?? {}
    this.detail = options.detail
  }
}

/** The wire envelope for any handler error; unknown errors degrade to `{ error }`. */
export function errorEnvelope(error: unknown): { error: string; code?: string; params?: Readonly<Record<string, string | number>>; detail?: string } {
  if (error instanceof CodedError) {
    return {
      error: error.message,
      code: error.code,
      params: error.params,
      ...(error.detail === undefined ? {} : { detail: error.detail }),
    }
  }
  return { error: (error as Error).message }
}
