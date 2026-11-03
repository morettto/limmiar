// A sibling-slice import (prontuario -> live-session): must violate fsd-no-cross-slice.
import { abrirChunk } from '../live-session/audio-crypto'

export const reprodutor = { abrirChunk }
