export interface PalavraAtribuida {
  texto: string
  inicioMs: number
  fimMs: number
  // Id opaco do falante dado pelo servidor de transcrição; null === indeterminado.
  locutor: string | null
}
