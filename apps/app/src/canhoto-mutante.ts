// DEFEITO PROPOSITAL (PR canhoto, ticket S00-02) — coberto por teste fraco que
// não afirma o valor exato, deixando um mutante de string literal sobreviver.
export function greetingLabel(): string {
  return 'Bem-vindo'
}
