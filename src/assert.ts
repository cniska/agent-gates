import { BUG, faulter } from "./coded-error";

const fault = faulter<{
  readonly unreachable: { readonly value: string };
}>({
  unreachable: { message: ({ value }) => `unreachable: ${value}`, resolve: () => BUG },
});

export function unreachable(value: never): never {
  throw fault("unreachable", { value: JSON.stringify(value) });
}
