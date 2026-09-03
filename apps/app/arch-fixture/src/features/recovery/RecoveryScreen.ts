// Accepted pair (-> totp-challenge, not violate) plus a sibling outside the pair
// (-> nota-fila, violates fsd-no-cross-slice-recovery).
import { TotpChallenge } from '../totp-challenge/TotpChallenge'
import { ehAtalhoAssinar } from '../nota-fila/navegacao-teclado'

export const recoveryScreen = { TotpChallenge, ehAtalhoAssinar }
