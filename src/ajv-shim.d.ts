/**
 * ajv's published .d.ts uses extensionless relative imports that NodeNext
 * cannot resolve, so its types degrade to unusable under this repo's module
 * resolution. Runtime default-import interop with the CJS build is fine;
 * this declaration types the minimal surface docwright uses.
 */
declare module 'ajv' {
  export interface ErrorObject {
    keyword?: string
    instancePath?: string
    message?: string
    [key: string]: unknown
  }
  export interface ValidateFunction {
    (data: unknown): boolean
    errors: ErrorObject[] | null
  }
  export default class Ajv {
    constructor(options?: { allErrors?: boolean; strict?: boolean | 'log'; [key: string]: unknown })
    compile(schema: unknown): ValidateFunction
  }
}
