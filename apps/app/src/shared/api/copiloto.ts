// Build constant, like VITE_API_BASE_URL: `pnpm dev` proxies /copiloto, a hosted app names the orchestrator's origin.
export const COPILOTO_BASE_URL = (import.meta.env.VITE_COPILOTO_BASE_URL ?? '/copiloto').replace(/\/+$/, '')
