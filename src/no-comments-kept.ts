export type KeptForm<Read> = { readonly shown: string; readonly keeps: (comment: Read) => boolean };

export function shownOf<Read>(forms: readonly KeptForm<Read>[]): readonly string[] {
  return forms.map(({ shown }) => shown);
}

export function keptBy<Read>(forms: readonly KeptForm<Read>[]): (comment: Read) => boolean {
  return (comment) => forms.some(({ keeps }) => keeps(comment));
}
