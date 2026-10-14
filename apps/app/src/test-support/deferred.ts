// Promise resolvida ou rejeitada de fora: prende uma chamada assíncrona para provar o que acontece enquanto ela está pendente.
export function deferred<T>() {
  let resolve!: (valor: T) => void
  let reject!: (motivo: unknown) => void
  const promise = new Promise<T>((feito, falhou) => { resolve = feito; reject = falhou })
  return { promise, resolve, reject }
}
