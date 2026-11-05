// Accepted pair (-> totp-challenge, not violate) plus a sibling outside the pair
// (-> nota-biblioteca, violates fsd-no-cross-slice-recovery).
import { TotpChallenge } from '../totp-challenge/TotpChallenge'
import { ehAtalhoAssinar } from '../nota-biblioteca/navegacao-teclado'

export const recoveryScreen = { TotpChallenge, ehAtalhoAssinar }
