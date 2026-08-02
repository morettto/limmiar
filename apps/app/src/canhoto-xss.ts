// DEFEITO PROPOSITAL (PR canhoto, ticket S00-02) — DOM XSS: valor lido direto
// de location.search (fonte não confiável reconhecida pelo CodeQL) flui sem
// sanitização até innerHTML (sink clássico), pra provar que o gate SAST
// reprova. Nunca importado pelo app real.
export function renderBioFromUrl(): void {
  const params = new URLSearchParams(window.location.search)
  document.getElementById('bio')!.innerHTML = params.get('bio') ?? ''
}
