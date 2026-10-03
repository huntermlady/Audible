/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public base URL of the audible-ai Worker (CONTRACT_CHANGES 20). Empty/undefined disables cloud mode. */
  readonly VITE_AI_CLOUD_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
