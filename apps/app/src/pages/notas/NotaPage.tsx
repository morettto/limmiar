import { useRef, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import type { Ancora } from '@limmiar/copilot'
import type { CryptoKey } from '@limmiar/crypto'
import { assinarNota } from '../../entities/nota/api'
import { notaParaEntrada, selarAssinatura } from '../../entities/nota/nota-crypto'
import { ORDEM_SECOES, type Nota } from '../../entities/nota/nota'
import { appendPatientEntry } from '../../entities/patient/api'
import { openRecord, sealEntry } from '../../entities/patient/patient-crypto'
import { translateProblemCode } from '../../shared/api'
import { ESTADO_ASSINADA, ESTADO_PENDENTE, type ItemFila } from '../../features/nota-fila/FilaAssinatura'
import { criarReprodutor } from '../../features/nota-audio/reprodutor'
import { FilaEEditor } from '../../widgets/soap-editor/FilaEEditor'

const NOTA_FIXTURE_ID = 'nota-fixture-1'
const PATIENT_FIXTURE_ID = 'paciente-fixture-1'

// ponytail: sem sessão/keychain real nesta rota ainda, tal como CopilotKeyPage. Com estes valores,
// `appendPatientEntry`/`assinarNota` caem no caminho de falha de rede — sem perda de dados, só um
// fluxo que não completa. Quem ligar a sessão troca os quatro por props; aoAssinar não muda.
const BASE_URL_FIXTURE = ''
const ACCOUNT_ID_FIXTURE = ''
const ACCESS_TOKEN_FIXTURE = ''
const KEK_FIXTURE = {} as CryptoKey
const RECORD_FIXTURE = { wrappedDek: new Uint8Array(0), entries: [] as { sequence: number; ciphertext: Uint8Array<ArrayBuffer> }[] }

function notaFixture(): Nota {
  return {
    id: NOTA_FIXTURE_ID,
    patientId: PATIENT_FIXTURE_ID,
    revisao: 0,
    frases: ORDEM_SECOES.map((secao) => ({ id: `${secao}-0`, secao, texto: '', ancoras: [] })),
  }
}

type Mensagem = { status: 'sucesso' | 'erro'; texto: string }

// ponytail: fila com um único item fixo — a fila real (fetch ao backend, várias notas) fica fora
// desta fatia. `aoAssinar` já grava no prontuário e assina, e marca só o item de `nota.id`.
export function NotaPage() {
  const { t, i18n } = useLingui()
  const [itens, setItens] = useState<readonly ItemFila[]>(() => [
    { id: NOTA_FIXTURE_ID, patientId: PATIENT_FIXTURE_ID, estado: ESTADO_PENDENTE },
  ])
  const [notas, setNotas] = useState<Record<string, Nota>>(() => ({ [NOTA_FIXTURE_ID]: notaFixture() }))
  const [mensagem, setMensagem] = useState<Mensagem | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  // Revisão da última gravação bem-sucedida no prontuário, por nota -- guarda contra
  // repetir `appendPatientEntry` da mesma revisão quando `assinarNota` falha depois de
  // `appendPatientEntry` já ter sido gravado (ver comentário em `aoAssinar`).
  const ultimaRevisaoGravadaRef = useRef<Record<string, number>>({})
  const proximaSequenciaRef = useRef(RECORD_FIXTURE.entries.length + 1)

  function marcarAssinada(notaId: string) {
    setItens((atuais) => atuais.map((item) => (item.id === notaId ? { ...item, estado: ESTADO_ASSINADA } : item)))
  }

  // Foca a listbox da fila (sem forwardRef através de FilaEEditor/FilaAssinatura -- é a
  // única instância de `role="listbox"` na página) para o `j`/`k` seguinte continuar de
  // onde a assinatura parou.
  function focarListbox() {
    document.querySelector<HTMLElement>('[role="listbox"]')?.focus()
  }

  // Ordem que não inverte: gravar a revisão no prontuário ANTES de assinar. Falhar a assinatura
  // depois de gravar é recuperável (novo `⌘↵` assina a mesma revisão). O inverso deixaria uma
  // assinatura a apontar para uma revisão que não existe — essa linha não se apaga depois.
  async function aoAssinar(nota: Nota) {
    try {
      const { dek } = await openRecord(KEK_FIXTURE, RECORD_FIXTURE, nota.patientId)

      if (ultimaRevisaoGravadaRef.current[nota.id] !== nota.revisao) {
        const sequence = proximaSequenciaRef.current
        const ciphertext = await sealEntry(dek, nota.patientId, sequence, notaParaEntrada(nota))
        const gravado = await appendPatientEntry(BASE_URL_FIXTURE, ACCOUNT_ID_FIXTURE, ACCESS_TOKEN_FIXTURE, nota.patientId, {
          sequence,
          ciphertext,
        })
        if (!gravado.ok) {
          setMensagem({ status: 'erro', texto: translateProblemCode(gravado.code, gravado.params, i18n) })
          return
        }
        proximaSequenciaRef.current = sequence + 1
        ultimaRevisaoGravadaRef.current[nota.id] = nota.revisao
      }

      const signature = await selarAssinatura(dek, nota.id, nota)
      const resultado = await assinarNota(BASE_URL_FIXTURE, ACCOUNT_ID_FIXTURE, ACCESS_TOKEN_FIXTURE, nota.id, {
        revisao: nota.revisao,
        signature,
      })

      marcarAssinada(nota.id)
      if (resultado.ok) {
        const dataAssinatura = new Date(resultado.signedAt).toLocaleString(i18n.locale)
        setMensagem({ status: 'sucesso', texto: t`Nota assinada em ${dataAssinatura}.` })
      } else {
        // O único desfecho não-ok coberto por esta fatia é 409 notes.already_signed: o
        // servidor é a verdade (a nota já estava assinada), então marca assinada também --
        // mas as alterações feitas depois dessa assinatura não estão cobertas por ela.
        setMensagem({
          status: 'erro',
          texto: t`Esta nota já tinha sido assinada. As alterações feitas depois não estão cobertas por essa assinatura.`,
        })
      }
      focarListbox()
    } catch {
      setMensagem({ status: 'erro', texto: t`Falha ao assinar a nota. Tente novamente.` })
    }
  }

  function onChangeNota(nota: Nota) {
    setNotas((atuais) => ({ ...atuais, [nota.id]: nota }))
  }

  // O <audio> renderiza sempre com este componente, logo `audioRef.current` já está atribuído em
  // qualquer clique que chegue aqui; a guarda é só a fronteira de nulidade do ref (ADR contra `!`).
  // Sem `src` ainda: carregar o áudio da sessão é fatia futura, e tocar antes disso é um no-op.
  function aoTocar(ancora: Ancora) {
    if (!audioRef.current) return
    criarReprodutor(audioRef.current).tocar(ancora.inicioMs)
  }

  return (
    <>
      <audio ref={audioRef} hidden />
      {mensagem?.status === 'sucesso' && <p role="status">{mensagem.texto}</p>}
      {mensagem?.status === 'erro' && <p role="alert">{mensagem.texto}</p>}
      <FilaEEditor itens={itens} notas={notas} onChangeNota={onChangeNota} aoTocar={aoTocar} aoAssinar={aoAssinar} />
    </>
  )
}
