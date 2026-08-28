import { useRef, useState } from 'react'
import type { Ancora } from '@limmiar/copilot'
import { ORDEM_SECOES, type Nota } from '../../entities/nota/nota'
import { ESTADO_ASSINADA, ESTADO_PENDENTE, type ItemFila } from '../../features/nota-fila/FilaAssinatura'
import { criarReprodutor } from '../../features/nota-audio/reprodutor'
import { FilaEEditor } from '../../widgets/soap-editor/FilaEEditor'

const NOTA_FIXTURE_ID = 'nota-fixture-1'
const PATIENT_FIXTURE_ID = 'paciente-fixture-1'

function notaFixture(): Nota {
  return {
    id: NOTA_FIXTURE_ID,
    patientId: PATIENT_FIXTURE_ID,
    revisao: 0,
    frases: ORDEM_SECOES.map((secao) => ({ id: `${secao}-0`, secao, texto: '', ancoras: [] })),
  }
}

// ponytail: fila e nota em memória, um único item fixo -- a fila real (fetch ao backend,
// múltiplas notas/pacientes) é a fatia 4. Isto existe só para a rota /notas montar de
// facto (em vez de um componente construído mas nunca ligado -- ver README deste módulo)
// e o e2e da fatia 5 ter algo real para bater. `aoAssinar` marca a única nota do fixture
// como assinada só na fila em memória, sem persistência nem assinatura criptográfica de
// facto -- isso é a fatia 4; com um único item na fila não há ambiguidade de qual nota
// marcar, então não há condicional aqui para testar.
export function NotaPage() {
  const [itens, setItens] = useState<readonly ItemFila[]>(() => [
    { id: NOTA_FIXTURE_ID, patientId: PATIENT_FIXTURE_ID, estado: ESTADO_PENDENTE },
  ])
  const [notas, setNotas] = useState<Record<string, Nota>>(() => ({ [NOTA_FIXTURE_ID]: notaFixture() }))
  const audioRef = useRef<HTMLAudioElement>(null)

  function aoAssinar() {
    setItens((atuais) => atuais.map((item) => ({ ...item, estado: ESTADO_ASSINADA })))
  }

  function onChangeNota(nota: Nota) {
    setNotas((atuais) => ({ ...atuais, [nota.id]: nota }))
  }

  // Reprodutor real (fatia 3, features/nota-audio/reprodutor.ts) -- o `<audio>` abaixo
  // renderiza sempre junto com este componente, então `audioRef.current` já está
  // atribuído em qualquer clique/hover/foco que chegue a chamar `aoTocar` (nenhum
  // caminho de UI o invoca antes do primeiro render commitar); a guarda abaixo é só a
  // fronteira de nulidade do próprio ref (mesmo espírito do ADR contra `!` na fronteira
  // api/store/service -- ver docs/adr/), não um caminho de facto alcançável. Ainda não
  // tem `src`: carregar o áudio de verdade da sessão (`abrirSessaoComoBlob`, precisa de
  // dir OPFS + dek + sessionId vindos do backend) é a fatia 4. Tocar antes disso é um
  // no-op honesto (elemento sem fonte), não um no-op escondido atrás de uma função vazia.
  function aoTocar(ancora: Ancora) {
    if (!audioRef.current) return
    criarReprodutor(audioRef.current).tocar(ancora.inicioMs)
  }

  return (
    <>
      <audio ref={audioRef} hidden />
      <FilaEEditor itens={itens} notas={notas} onChangeNota={onChangeNota} aoTocar={aoTocar} aoAssinar={aoAssinar} />
    </>
  )
}
