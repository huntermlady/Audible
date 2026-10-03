// Track 2 → Track 4 AI API (docs/CONTRACTS.md §8).
export { buildFactSheet, factSheetInputs, serializeFactSheet, factIndex, derive } from './factsheet'
export { checkGrounding, type GroundingResult, type UngroundedToken } from './grounding'
export { validateCall } from './validate'
export { runCoordinatorCall, isAbortError, type CoordinatorResult, type RunCoordinatorArgs } from './coordinator'
export { buildChatSystem, chatFactSheetContext } from './chat'
export { AIStatusProvider, useAIStatus, type AIStatus, type AIMode, type AISource, type AISettings, type AIStatusValue } from './status'
export { createOllamaProvider, type Provider, type Message, type GenerateResult, ProviderError } from './providers'
