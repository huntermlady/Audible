const BASE = import.meta.env.BASE_URL

export const dataUrl = (file: string) => `${BASE}data/${file}`
export const reportUrl = (path: string) => `${BASE}reports/${path.replace(/^\/+/, '')}`
