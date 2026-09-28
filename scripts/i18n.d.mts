export declare const CSV_PATH: string
export declare const TS_PATH: string

export declare function parseCsv(text: string): string[][]
export declare function parseTranslations(text: string): {
  langs: string[]
  keys: string[]
  dict: Record<string, Record<string, string>>
  warnings: string[]
}
export declare function generate(text: string): string
