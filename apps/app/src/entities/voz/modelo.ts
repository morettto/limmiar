export const MODELO_VOZ = 'd51abcf31717ef28162f26acb9d44dd4127c3d44c9b8624f699f3425daca8e77'
export const DIMENSOES_VOZ = 192

export function embeddingValido(embedding: unknown): embedding is number[] {
  return Array.isArray(embedding) && embedding.length === DIMENSOES_VOZ &&
    embedding.every((valor) => typeof valor === 'number' && Number.isFinite(Math.fround(valor))) &&
    Math.hypot(...embedding) > 0
}
