import { BASE_LOCALE, isLocale, type Locale } from './locale'
import type { LocaleStore, ProfileLocaleStore } from './locale-store'

export interface ResolveLocaleDeps {
  profileStore: ProfileLocaleStore
  deviceStore: LocaleStore
}

// Order: profile, device (localStorage), base. The browser's language is deliberately absent: the
// product opens in pt-BR until the person picks another locale.
export async function resolveLocale(deps: ResolveLocaleDeps): Promise<Locale> {
  const profileLocale = await deps.profileStore.get()
  if (isLocale(profileLocale)) return profileLocale

  const deviceLocale = await deps.deviceStore.get()
  if (isLocale(deviceLocale)) return deviceLocale

  return BASE_LOCALE
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
