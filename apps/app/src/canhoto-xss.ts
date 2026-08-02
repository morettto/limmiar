// DEFEITO PROPOSITAL (PR canhoto, ticket S00-02) — sink de DOM XSS clássico
// (string não sanitizada atribuída a innerHTML), pra provar que o gate SAST
// (CodeQL) reprova. Nunca importado pelo app real.
export function renderUserBio(bio: string): void {
  document.getElementById('bio')!.innerHTML = bio
}
