export type Command = {
  name: string;
  usage: string;
  summary: string;
  run(args: readonly string[]): { readonly value: unknown; readonly exitCode: 0 | 1 };
};
