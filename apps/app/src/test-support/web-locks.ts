export function fakeWebLocks() {
  const active = new Set<string>()
  const manager = {
    async request(name: string, _options: LockOptions, callback: (lock: Lock | null) => Promise<void>) {
      if (active.has(name)) return callback(null)
      active.add(name)
      try { return await callback({ name, mode: 'exclusive' } as Lock) }
      finally { active.delete(name) }
    },
  } as unknown as LockManager
  return { manager, active }
}
