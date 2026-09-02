import { useRef, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import type { Ancora } from '@limmiar/copilot'
import type { CryptoKey } from '@limmiar/crypto'
import { assinarNota } from '../../entities/nota/api'
import { notaParaEntrada, selarAssinatura } from '../../entities/nota/nota-crypto'
import { ESTADO_ASSINADA, ESTADO_PENDENTE, ORDEM_SECOES, type Nota } from '../../entities/nota/nota'
import { appendPatientEntry } from '../../entities/patient/api'
import { openRecord, sealEntry } from '../../entities/patient/patient-crypto'
import { translateProblemCode } from '../../shared/api'
import { criarReprodutor } from '../../features/nota-audio/reprodutor'
import { FilaEEditor } from '../../widgets/soap-editor/FilaEEditor'

const NOTA_FIXTURE_ID = 'nota-fixture-1'
const PATIENT_FIXTURE_ID = 'paciente-fixture-1'

// ponytail: sem sessão/keychain real montada nesta rota ainda -- mesma situação, mesmo
// motivo, que CopilotKeyPage's `kek={null}, accountId=""`. `appendPatientEntry`/
// `assinarNota` abaixo com estes valores falham contra um backend real (o mesmo caminho
// de "falha de rede" que um apagão de rede genuíno cairia -- sem perda de dados, sem
// estado inconsistente, só um fluxo que não completa até a sessão real existir). Quem
// ligar Keychain/sessão substitui estes três valores por props (o quarto, `kek`, já é
// prop obrigatória desde a ronda 1 de correção do S08-07 -- `router.tsx` monta
// `NotaRouteComponent` com `kek={null}`, mesmo padrão de `BibliotecaRouteComponent`/
// `dek={null}`); a lógica de aoAssinar abaixo não muda.
const BASE_URL_FIXTURE = ''
const ACCOUNT_ID_FIXTURE = ''
const ACCESS_TOKEN_FIXTURE = ''
const RECORD_FIXTURE = { wrappedDek: new Uint8Array(0), entries: [] as { sequence: number; ciphertext: Uint8Array<ArrayBuffer> }[] }

function notaFixture(): Nota {
  return {
    id: NOTA_FIXTURE_ID,
    patientId: PATIENT_FIXTURE_ID,
    revisao: 0,
    frases: ORDEM_SECOES.map((secao) => ({ id: `${secao}-0`, secao, texto: '', ancoras: [] })),
    estado: ESTADO_PENDENTE,
  }
}

type Mensagem = { status: 'sucesso' | 'erro'; texto: string }

export interface NotaPageProps {
  // Obrigatória desde a ronda 1 de correção do S08-07 -- mesmo padrão de `BibliotecaPage`'s
  // `dek: CryptoKey | null`. `router.tsx` monta via `NotaRouteComponent` com `kek={null}`
  // enquanto não há KeychainProvider real; testes injetam uma chave real para exercitar o
  // caminho pós-guarda.
  kek: CryptoKey | null
}

// ponytail: fila com um único item fixo -- a fila real (fetch ao backend, múltiplas
// notas/pacientes) continua fora desta fatia. `aoAssinar` agora grava no prontuário e
// assina de facto (fatia 5), e marca só o item de `nota.id` -- a dívida da fatia 3 (que
// marcava todos os itens, e só funcionava por a fixture ter um único item) está paga.
export function NotaPage({ kek }: NotaPageProps) {
  const { t, i18n } = useLingui()
  const [notas, setNotas] = useState<Record<string, Nota>>(() => ({ [NOTA_FIXTURE_ID]: notaFixture() }))
  const [mensagem, setMensagem] = useState<Mensagem | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  // Revisão da última gravação bem-sucedida no prontuário, por nota -- guarda contra
  // repetir `appendPatientEntry` da mesma revisão quando `assinarNota` falha depois de
  // `appendPatientEntry` já ter sido gravado (ver comentário em `aoAssinar`).
  const ultimaRevisaoGravadaRef = useRef<Record<string, number>>({})
  const proximaSequenciaRef = useRef(RECORD_FIXTURE.entries.length + 1)

  function marcarAssinada(notaId: string) {
    setNotas((atuais) =>
      atuais[notaId] ? { ...atuais, [notaId]: { ...atuais[notaId], estado: ESTADO_ASSINADA } } : atuais,
    )
  }

  // Foca a listbox da fila (sem forwardRef através de FilaEEditor/FilaAssinatura -- é a
  // única instância de `role="listbox"` na página) para o `j`/`k` seguinte continuar de
  // onde a assinatura parou.
  function focarListbox() {
    document.querySelector<HTMLElement>('[role="listbox"]')?.focus()
  }

  // Ordem que não inverte: grava a revisão no prontuário ANTES de assinar. Falhar a
  // assinatura depois de gravar deixa uma revisão por assinar no prontuário -- recuperável,
  // um novo `⌘↵` assina a mesma revisão de novo (guarda abaixo evita repetir a gravação).
  // O inverso (assinar antes de gravar) deixaria, numa falha entre as duas chamadas, uma
  // assinatura a apontar para uma revisão que não existe em lado nenhum do prontuário --
  // essa linha não se pode apagar depois.
  async function aoAssinar(nota: Nota) {
    if (kek === null) {
      setMensagem({ status: 'erro', texto: t`Sem sessão ativa. Não é possível assinar.` })
      return
    }
    try {
      const { dek } = await openRecord(kek, RECORD_FIXTURE, nota.patientId)

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

      if (resultado.ok) {
        marcarAssinada(nota.id)
        const dataAssinatura = new Date(resultado.signedAt).toLocaleString(i18n.locale)
        setMensagem({ status: 'sucesso', texto: t`Nota assinada em ${dataAssinatura}.` })
      } else if (resultado.code === 'notes.already_signed') {
        // O servidor é a verdade (a nota já estava assinada), então marca assinada também --
        // mas as alterações feitas depois dessa assinatura não estão cobertas por ela.
        marcarAssinada(nota.id)
        setMensagem({
          status: 'erro',
          texto: t`Esta nota já tinha sido assinada. As alterações feitas depois não estão cobertas por essa assinatura.`,
        })
      } else {
        setMensagem({ status: 'erro', texto: translateProblemCode(resultado.code, resultado.params, i18n) })
      }
      focarListbox()
    } catch {
      setMensagem({ status: 'erro', texto: t`Falha ao assinar a nota. Tente novamente.` })
    }
  }

  function onChangeNota(nota: Nota) {
    setNotas((atuais) => ({ ...atuais, [nota.id]: nota }))
  }

  // Reprodutor real (fatia 3, features/nota-audio/reprodutor.ts) -- o <audio> abaixo
  // renderiza sempre junto com este componente, então `audioRef.current` já está
  // atribuído em qualquer clique/hover/foco que chegue a chamar `aoTocar` (nenhum
  // caminho de UI o invoca antes do primeiro render commitar); a guarda abaixo é só a
  // fronteira de nulidade do próprio ref (mesmo espírito do ADR contra `!` na fronteira
  // api/store/service -- ver docs/adr/), não um caminho de facto alcançável. Ainda não
  // tem `src`: carregar o áudio de verdade da sessão (`abrirSessaoComoBlob`, precisa de
  // dir OPFS + dek + sessionId vindos do backend) é fatia futura. Tocar antes disso é um
  // no-op honesto (elemento sem fonte), não um no-op escondido atrás de uma função vazia.
  function aoTocar(ancora: Ancora) {
    if (!audioRef.current) return
    criarReprodutor(audioRef.current).tocar(ancora.inicioMs)
  }

  return (
    <>
      <audio ref={audioRef} hidden />
      {mensagem?.status === 'sucesso' && <p role="status">{mensagem.texto}</p>}
      {mensagem?.status === 'erro' && <p role="alert">{mensagem.texto}</p>}
      <FilaEEditor notas={Object.values(notas)} onChangeNota={onChangeNota} aoTocar={aoTocar} aoAssinar={aoAssinar} />
    </>
  )
}
