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

// ponytail: sem sessão/keychain real nesta rota ainda -- mesma situação de CopilotKeyPage.
// Com estes valores, `appendPatientEntry`/`assinarNota` caem no caminho de "falha de rede",
// sem perda de dados. Quem ligar a sessão substitui-os por props, sem mexer em `aoAssinar`.
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
  // Obrigatória desde a ronda 1 do S08-07 -- mesmo padrão do `dek: CryptoKey | null` de
  // `BibliotecaPage`. `router.tsx` monta com `kek={null}` enquanto não há KeychainProvider;
  // os testes injetam uma chave real para exercitar o caminho pós-guarda.
  kek: CryptoKey | null
}

// ponytail: fila com um único item fixo -- a fila real continua fora desta fatia. `aoAssinar`
// já grava no prontuário e assina de facto, e marca só o item de `nota.id`.
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

  // Ordem que não inverte: grava a revisão no prontuário ANTES de assinar. Falhar a assinatura
  // depois de gravar é recuperável (novo ⌘↵ assina a mesma revisão); o inverso deixaria uma
  // assinatura a apontar para uma revisão que não existe no prontuário, e isso não se apaga.
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

  // Reprodutor real (fatia 3): o <audio> renderiza sempre com este componente, então a guarda
  // é só a fronteira de nulidade do ref, não um caminho alcançável. Ainda sem `src` -- carregar
  // o áudio da sessão é fatia futura, e tocar antes disso é um no-op honesto.
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
