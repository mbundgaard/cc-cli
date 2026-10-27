// Node 22+ supports reviver source text and raw JSON values. Request JSON and
// derived record-history files use this parser. Original response bytes remain
// unchanged; parsing a derived representation never replaces source evidence.
const sourceJSON = JSON as unknown as {
  parse(text: string, reviver: (key: string, value: unknown, context?: { source?: string }) => unknown): unknown;
  rawJSON(text: string): object;
  isRawJSON(value: unknown): boolean;
};
export function isRawJson(value: unknown): boolean { return sourceJSON.isRawJSON(value); }
export function parseJson(text: string): unknown {
  return sourceJSON.parse(text, (_key, value, context) => {
    if (typeof value !== 'number') return value;
    if (context?.source === undefined) throw new Error('JSON source support requires Node.js 22+');
    // Preserve numeric text if Number/stringify would change it, including large
    // integers, precise decimals, negative zero and overflowing exponents.
    return JSON.stringify(value) === context.source ? value : sourceJSON.rawJSON(context.source);
  });
}
