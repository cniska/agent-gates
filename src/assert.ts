import { BUG, faulter } from "./coded-error";

const fault = faulter<{
  readonly unreachable: { readonly value: string };
  readonly invariant: { readonly claim: string };
}>({
  unreachable: { message: ({ value }) => `unreachable: ${value}`, resolve: () => BUG },
  invariant: { message: ({ claim }) => `invariant broken: ${claim}`, resolve: () => BUG },
});

export function unreachable(value: never): never {
  throw fault("unreachable", { value: JSON.stringify(value) });
}

export function invariant(condition: boolean, claim: string): asserts condition {
  if (!condition) throw fault("invariant", { claim });
}
