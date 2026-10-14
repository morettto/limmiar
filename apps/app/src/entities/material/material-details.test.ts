import { describe, expect, it } from 'vitest'
import { readMaterialDetails } from './material-details'

const latin1 = (text: string) => Uint8Array.from(text, char => char.charCodeAt(0))
const utf8 = (text: string) => String.fromCharCode(...new TextEncoder().encode(text))
const utf16Hex = (text: string) => `FEFF${Array.from(text, char => char.charCodeAt(0).toString(16).padStart(4, '0')).join('')}`
const NAMESPACES = 'xmlns:x="adobe:ns:meta/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"'
const packet = (inner: string) => `<?xpacket begin="">\n<x:xmpmeta ${NAMESPACES}><rdf:RDF><rdf:Description>${inner}</rdf:Description></rdf:RDF></x:xmpmeta>\n<?xpacket end="w"?>\n`
const xmpTitle = (text: string) => `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${text}</rdf:li></rdf:Alt></dc:title>`
const xmpCreators = (...names: string[]) => `<dc:creator><rdf:Seq>${names.map(name => `<rdf:li>${name}</rdf:li>`).join('')}</rdf:Seq></dc:creator>`
const infoObject = (dict: string, id = '1 0') => `${id} obj\n<<${dict}>>\nendobj\n`
const trailer = (reference = '1 0 R') => `trailer\n<</Root 9 0 R /Info ${reference}>>\n%%EOF\n`
const read = (body: string, filename = 'obra.pdf') => readMaterialDetails(filename, 'pdf', latin1(`%PDF-1.7\n${body}`))
const readInfo = (dict: string) => read(infoObject(dict) + trailer())

describe('dados lidos do documento', () => {
  it('usa só o nome do arquivo em texto, sem extensão nem separadores', () => {
    const content = latin1(infoObject('/Title (Dentro) /Author (Alguém)') + trailer())
    expect(readMaterialDetails('Freud_-_Luto-e-melancolia.txt', 'txt', content)).toEqual({ title: 'Freud Luto e melancolia', authors: '' })
    expect(readMaterialDetails('Nota   longa.TXT', 'txt', content).title).toBe('Nota longa')
  })

  it('cai para o nome do arquivo quando o PDF não traz metadados', () => {
    expect(read('1 0 obj\n<</Type/Catalog>>\nendobj\n', 'Obra_Final.pdf')).toEqual({ title: 'Obra Final', authors: '' })
    expect(read('', 'OBRA--dois__tres.PDF').title).toBe('OBRA dois tres')
    expect(read('', 'meu.pdf-guia.pdf').title).toBe('meu.pdf guia')
    expect(read('', '-_Obra _.pdf').title).toBe('Obra')
    expect(read('', 'Manual pdf').title).toBe('Manual pdf')
  })

  it('lê título e autor do dicionário Info, com parênteses aninhados, escapes e octais', () => {
    expect(readInfo('/Title (A (b (c)) d) /Author (Ana)')).toEqual({ title: 'A (b (c)) d', authors: 'Ana' })
    expect(readInfo('/Title (a \\( b \\\\ c \\) d)').title).toBe('a ( b \\ c ) d')
    expect(readInfo('/Title (Cl\\355nica \\1012 \\7)').title).toBe('Clínica A2 \u0007')
    expect(readInfo('/Title (A\\tB\\rC\\nD\\bE\\fF)').title).toBe('A B C D\bE F')
    expect(readInfo('/Title (Linha\\n1 \\qx)').title).toBe('Linha 1 qx')
    expect(readInfo('/Title(  Duas   linhas\r\nfinais  )').title).toBe('Duas linhas finais')
    expect(readInfo('/Title (\x93Aspas\x94 \x81)').title).toBe('“Aspas” \u0081')
  })

  it('decodifica hexadecimal, BOM UTF-16BE e UTF-8, e completa dígito final ímpar', () => {
    expect(readInfo(`/Title <${utf16Hex('Obra Å')}> /Author <${utf16Hex('José')}>`)).toEqual({ title: 'Obra Å', authors: 'José' })
    expect(readInfo('/Author <41 42>').authors).toBe('AB')
    expect(readInfo('/Author <414>').authors).toBe('A@')
    expect(readInfo('/Title (\\376\\377\\000A\\000B)').title).toBe('AB')
    expect(readInfo(`/Title (${utf8('﻿José')})`).title).toBe('José')
    expect(readInfo('/Title (\\357\\273\\277Jos\\303\\251)').title).toBe('José')
  })

  it('ignora valores que não são texto e chaves de outro nome', () => {
    expect(readInfo('/Title 12 0 R /Author <</A 1>>').authors).toBe('')
    expect(readInfo('/Title /Nome /Author <>')).toEqual({ title: 'obra', authors: '' })
    expect(readInfo('/TitleX (Errado) /Subtitle (Errado)').title).toBe('obra')
  })

  it('usa o último trailer, a última definição do objeto e o número exato', () => {
    const duas = infoObject('/Title (Antigo)') + infoObject('/Title (Novo)', '2 0') + trailer('1 0 R') + trailer('2 0 R')
    expect(read(duas).title).toBe('Novo')
    const atualizada = infoObject('/Title (Primeira)') + infoObject('/Title (Segunda)') + infoObject('/Title (Outra geração)', '1 3') + infoObject('/Title (Onze)', '11 0') + trailer()
    expect(read(atualizada).title).toBe('Segunda')
    expect(read(infoObject('/Title (Espaços)') + '\n/Info 1  0   R').title).toBe('Espaços')
    expect(read(infoObject('/Title (Dezenas)', '12 10') + '\n/Info  12  10 R').title).toBe('Dezenas')
  })

  it('ignora /Title de outros objetos, Info ausente e Info criptografado', () => {
    const outline = '7 0 obj\n<</Title (Capítulo 1) /Parent 3 0 R>>\nendobj\n'
    expect(read(outline + infoObject('/Author (Ana)') + trailer())).toEqual({ title: 'obra', authors: 'Ana' })
    expect(read(outline).title).toBe('obra')
    expect(read(outline + trailer('5 0 R')).title).toBe('obra')
    expect(read(infoObject('/Title (Cifrado)') + '\ntrailer\n<</Encrypt 4 0 R /Info 1 0 R>>\n').title).toBe('obra')
  })

  it('tolera strings sem fim, sem lançar', () => {
    expect(read('1 0 obj\n<</Title (Sem fim\nendobj\n/Info 1 0 R').title).toBe('Sem fim endobj /Info 1 0 R')
    expect(read('1 0 obj\n<</Title (Sem fim\nendobj\n/Info 1 0 R (\\').title).toBe('Sem fim endobj /Info 1 0 R (')
  })

  it('lê dc:title e dc:creator do XMP, com entidades XML e UTF-8', () => {
    const body = utf8(packet(xmpTitle('Luto &amp; melancolia  \n Ação') + xmpCreators('Freud, S.', 'Abraham, K.')))
    expect(read(body)).toEqual({ title: 'Luto & melancolia Ação', authors: 'Freud, S.; Abraham, K.' })
    expect(read(utf8(packet(xmpCreators(' ', 'Só'))))).toEqual({ title: 'obra', authors: 'Só' })
    expect(read(utf8(packet(xmpTitle('Só título')))).authors).toBe('')
  })

  it('XMP vence o Info campo a campo, e o último pacote vence o anterior', () => {
    const info = infoObject('/Title (Info) /Author (Autor Info)') + trailer()
    expect(read(info + packet(xmpTitle('XMP')))).toEqual({ title: 'XMP', authors: 'Autor Info' })
    expect(read(info + utf8(packet(xmpTitle('Primeiro')) + packet(xmpTitle('Último')))).title).toBe('Último')
  })

  it('XMP malformado ou truncado não derruba a leitura e cai para o Info', () => {
    const info = infoObject('/Title (Info)') + trailer()
    expect(read(info + `<x:xmpmeta ${NAMESPACES}><dc:title></x:xmpmeta>`).title).toBe('Info')
    expect(read(info + `<x:xmpmeta ${NAMESPACES}><rdf:RDF>${xmpTitle('Truncado')}`).title).toBe('Info')
  })
})
