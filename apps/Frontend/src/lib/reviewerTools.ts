// UI convenience only; the API independently authorises reviewer endpoints.
export const reviewerToolsEnabled = import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === 'true';
