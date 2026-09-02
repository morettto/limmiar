import { isLocale, type Locale } from './locale'
import type { LocaleStore, ProfileLocaleStore } from './locale-store'
import { negotiateLocale } from './negotiate'

export interface ResolveLocaleDeps {
  profileStore: ProfileLocaleStore
  deviceStore: LocaleStore
  preferences: string | readonly string[] | null | undefined
}

// ADR-S00.5-05's negotiation order: profile, device (localStorage), navigator,
// base. Levels 3 and 4 are negotiateLocale's (RFC 4647 lookup); this only puts
// the two higher-priority levels in front of it.
export async function resolveLocale(deps: ResolveLocaleDeps): Promise<Locale> {
  const profileLocale = await deps.profileStore.get()
  if (isLocale(profileLocale)) return profileLocale

  const deviceLocale = await deps.deviceStore.get()
  if (isLocale(deviceLocale)) return deviceLocale

  return negotiateLocale(deps.preferences)
}

export interface PersistLocaleDeps {
  profileStore: ProfileLocaleStore
  deviceStore: LocaleStore
}

// Writes the same locale to both stores in parallel — a switch should not
// leave one store stale while waiting on the other.
export async function persistLocale(locale: Locale, deps: PersistLocaleDeps): Promise<void> {
  await Promise.all([deps.deviceStore.set(locale), deps.profileStore.set(locale)])
}
