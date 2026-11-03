// Same target as the accepted pair, different importer (not recovery): must still violate --
// proves the exception is scoped to the exact pair, not to totp-challenge as a target.
import { TotpChallenge } from '../totp-challenge/TotpChallenge'

export const outroImportador = { TotpChallenge }
