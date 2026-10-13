import type { KeyboardEvent } from 'react'
import { useLingui } from '@lingui/react/macro'
import type { Ancora } from '@limmiar/copilot'
import { editarFrase, ESTADO_ASSINADA, ORDEM_SECOES, type Nota, type SecaoSoap } from '../../entities/nota/nota'
import { ehAtalhoAssinar } from './atalho-assinar'
import { Citacao } from './Citacao'

export interface EditorSoapProps {
  /** Controlado pelo widget-pai -- este componente não guarda estado próprio da nota. */
  nota: Nota
  onChange: (nota: Nota) => void
  /** Vem do reprodutor real (fatia 3, `features/nota-audio/reprodutor.ts`), repassado sem
   *  alteração até `Citacao`. */
  aoTocar?: (ancora: Ancora) => void
  /** Assinar de facto (fatia 4) fica por conta do chamador; aqui só se garante o atalho. */
  aoAssinar: (nota: Nota) => void
  aoAbrirTranscricao?(transcriptId: string, revisao: number): void
}

/**
 * Editor SOAP: as quatro secções (S/O/A/P) na ordem certa, frases editáveis e uma
 * `Citacao` por âncora de cada frase. `⌘↵`/`Ctrl+↵` (ver `ehAtalhoAssinar`, `./atalho-assinar.ts`)
 * disparam `aoAssinar(nota)` a partir de qualquer ponto do editor.
 */
export function EditorSoap({ nota, onChange, aoTocar, aoAssinar, aoAbrirTranscricao }: EditorSoapProps) {
  const { t } = useLingui()
  const assinada = nota.estado === ESTADO_ASSINADA
  const rotulos: Record<SecaoSoap, string> = {
    S: t`Subjetivo`,
    O: t`Objetivo`,
    A: t`Avaliação`,
    P: t`Plano`,
  }

  function aoTeclar(e: KeyboardEvent<HTMLDivElement>) {
    if (ehAtalhoAssinar(e)) {
      e.preventDefault()
      aoAssinar(nota)
    }
  }

  return (
    <div onKeyDown={aoTeclar}>
      {ORDEM_SECOES.map((secao) => {
        const frasesDaSecao = nota.frases.filter((frase) => frase.secao === secao)
        return (
          <section key={secao} aria-label={rotulos[secao]} className="mb-4">
            <h3 className="mb-2 font-semibold">{rotulos[secao]}</h3>
            {frasesDaSecao.map((frase, indice) => (
              <div key={frase.id} className="mb-3">
                <textarea
                  aria-label={`${rotulos[secao]} ${indice + 1}`}
                  value={frase.texto}
                  readOnly={assinada}
                  onChange={(event) => onChange(editarFrase(nota, frase.id, event.target.value))}
                  className="mb-1 w-full rounded-md border border-neutral-300 px-2 py-1 read-only:bg-neutral-100"
                />
                <div className="flex gap-1">
                  {frase.ancoras.map((ancora, indiceAncora) => (
                    <Citacao key={indiceAncora} ancora={ancora} aoTocar={aoTocar} />
                  ))}
                </div>
                {frase.referencias?.map(referencia => {
                  const pagina = referencia.pagina
                  const paragrafo = referencia.paragrafo
                  const revisao = referencia.revisaoTranscricao + 1
                  return <details key={`${referencia.trechoId}:${referencia.transcriptId}:${referencia.revisaoTranscricao}`} className="insight-source">
                    <summary>{t`Referência bibliográfica`} · {referencia.titulo}</summary>
                    <p>{referencia.autor} · {t`Página ${pagina}, parágrafo ${paragrafo}`}</p>
                    <blockquote>{referencia.citacaoLiteral}</blockquote>
                    <p>{t`Fala do paciente na revisão ${revisao}`}: {referencia.frasePaciente}</p>
                    <button type="button" disabled={!aoAbrirTranscricao} onClick={aoAbrirTranscricao ? () => aoAbrirTranscricao(referencia.transcriptId, referencia.revisaoTranscricao) : undefined}>{t`Ver fala da referência`}</button>
                  </details>
                })}
              </div>
            ))}
          </section>
        )
      })}
    </div>
  )
}
