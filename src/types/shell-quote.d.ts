declare module "shell-quote" {
  export type ShellQuoteParseEntry =
    | string
    | { op: string }
    | { comment: string }
    | { pattern: string };

  export function parse(command: string, env?: Record<string, string | undefined>): ShellQuoteParseEntry[];
  export function quote(args: readonly string[]): string;
}
