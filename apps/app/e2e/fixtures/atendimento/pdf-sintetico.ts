/** PDF de uma página com `texto`: o suficiente para o acervo aceitar o tipo; o conteúdo é inventado. */
export function pdfSintetico(texto: string): Buffer {
  const fluxo = `BT /F1 12 Tf 72 720 Td (${texto.replace(/[()\\]/g, '')}) Tj ET`
  const objetos = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${fluxo.length}>>\nstream\n${fluxo}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ]
  let corpo = '%PDF-1.4\n'
  const posicoes = objetos.map((objeto, i) => {
    const posicao = corpo.length
    corpo += `${i + 1} 0 obj\n${objeto}\nendobj\n`
    return posicao
  })
  const tabela = posicoes.map((posicao) => `${String(posicao).padStart(10, '0')} 00000 n \n`).join('')
  corpo += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${tabela}trailer\n<</Size ${objetos.length + 1}/Root 1 0 R>>\nstartxref\n${corpo.length}\n%%EOF\n`
  return Buffer.from(corpo, 'latin1')
}
