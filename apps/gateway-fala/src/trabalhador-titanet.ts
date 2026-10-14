import { Worker } from 'node:worker_threads'
import type { TrabalhadorDeVoz } from './extrator.ts'

export const criarTrabalhadorTitanet = (modelo: string, modeloSegmentacao: string): TrabalhadorDeVoz =>
  new Worker(new URL('./extrator.worker.ts', import.meta.url), { workerData: { modelo, modeloSegmentacao } })
