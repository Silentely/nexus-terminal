// Basic application configuration
// In a real application, consider using a more robust config library like 'dotenv' or 'convict'

interface AppConfig {
  appName: string;
  rpId: string; // Relying Party ID for WebAuthn
  rpOrigin: string; // Relying Party Origin for WebAuthn
  port: number;
  // Add other application-wide configurations here
}

export const config: AppConfig = {
  appName: process.env.APP_NAME || 'Nexus Terminal',
  rpId: process.env.RP_ID || 'localhost', // IMPORTANT: This MUST match your domain in production
  rpOrigin: process.env.RP_ORIGIN || 'http://localhost:5173', // IMPORTANT: This MUST match your frontend origin in production
  port: parseInt(process.env.PORT || '3000', 10),
};

// Function to get a config value, though direct access is also possible
export function getConfigValue<K extends keyof AppConfig>(key: K): AppConfig[K] {
  return config[key];
}
