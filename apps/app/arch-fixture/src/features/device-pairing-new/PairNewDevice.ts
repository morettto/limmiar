// Accepted composition pair (device-pairing-new -> qr-scan, not violate) plus a sibling
// outside the pair (-> nota-fila, violates fsd-no-cross-slice-device-pairing-new).
import { Componente } from '../qr-scan/Componente'
import { ehAtalhoAssinar } from '../nota-fila/navegacao-teclado'

export const pairNewDevice = { Componente, ehAtalhoAssinar }
