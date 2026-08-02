// DEFEITO PROPOSITAL (PR canhoto, ticket S00-02) — sem teste, derruba o gate de cobertura.
export function shout(name: string): string {
  return `${name.toUpperCase()}!`
}
