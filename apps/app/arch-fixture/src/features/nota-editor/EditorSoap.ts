// Mirrors the real imports S08-08 deleted: a sibling-slice import (must violate), an
// intra-slice import (must not) and a lower-layer import (must not, different layer).
import { ehAtalhoAssinar } from '../nota-fila/navegacao-teclado'
import { citacao } from './citacao'
import { nota } from '../../entities/nota/nota'

export const editorSoap = { ehAtalhoAssinar, citacao, nota }
