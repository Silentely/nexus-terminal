// Basic application configuration
// In a real application, consider using a more robust config library like 'dotenv' or 'convict'
import { getHostnameFromOrigin, normalizeOrigin } from '../utils/url';

export interface PasskeyRpConfig {
  rpId: string;
  rpOrigin: string;
  normalizedRpOrigin: string;
  rpOriginHostname: string;
}

interface AppConfig {
  appName: string;
  rpId: string; // Relying Party ID for WebAuthn (primary)
  rpOrigin: string; // Relying Party Origin for WebAuthn (primary)
  passkeyRpConfigs: PasskeyRpConfig[]; // Multi-domain Passkey configurations
  port: number;
  // Add other application-wide configurations here
}

const DEFAULT_RP_ID = 'localhost';
const DEFAULT_RP_ORIGIN = 'http://localhost:5173';

const parseCsvEnvValue = (value: string | undefined): string[] => {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const originMatchesRpId = (originHost: string, rpId: string): boolean => {
  const normalizedRpId = rpId.toLowerCase();
  return originHost === normalizedRpId || originHost.endsWith(`.${normalizedRpId}`);
};

const buildPasskeyRpConfigs = (): PasskeyRpConfig[] => {
  const configuredRpIds = parseCsvEnvValue(process.env.RP_ID);
  const configuredRpOrigins = parseCsvEnvValue(process.env.RP_ORIGIN);
  const hasConfiguredOrigins = configuredRpOrigins.length > 0;

  if (
    configuredRpIds.length > 1 &&
    (!hasConfiguredOrigins || configuredRpIds.length !== configuredRpOrigins.length)
  ) {
    throw new Error(
      `Invalid WebAuthn config: RP_ID and RP_ORIGIN must have the same number of entries when RP_ID provides multiple values (got RP_ID=${configuredRpIds.length}, RP_ORIGIN=${configuredRpOrigins.length}).`,
    );
  }

  const rpOrigins = hasConfiguredOrigins ? configuredRpOrigins : [DEFAULT_RP_ORIGIN];
  const fallbackRpId = configuredRpIds[0] || DEFAULT_RP_ID;
  const useSingleRpIdForAllOrigins = configuredRpIds.length === 1;

  return rpOrigins.map((rpOrigin, index) => {
    const normalizedRpOrigin = normalizeOrigin(rpOrigin);
    const rpOriginHostname = getHostnameFromOrigin(rpOrigin);
    if (!normalizedRpOrigin || !rpOriginHostname) {
      throw new Error(`Invalid WebAuthn RP_ORIGIN value: "${rpOrigin}"`);
    }

    const rpIdCandidate = useSingleRpIdForAllOrigins
      ? configuredRpIds[0]
      : configuredRpIds[index] || rpOriginHostname || fallbackRpId;
    const rpId = (rpIdCandidate || fallbackRpId).toLowerCase();

    return {
      rpId,
      rpOrigin: normalizedRpOrigin,
      normalizedRpOrigin,
      rpOriginHostname,
    };
  });
};

const passkeyRpConfigs = buildPasskeyRpConfigs();

export const config: AppConfig = {
  appName: process.env.APP_NAME || 'Nexus Terminal',
  rpId: passkeyRpConfigs[0]?.rpId || DEFAULT_RP_ID,
  rpOrigin: passkeyRpConfigs[0]?.rpOrigin || DEFAULT_RP_ORIGIN,
  passkeyRpConfigs,
  port: parseInt(process.env.PORT || '3000', 10),
};

export function getPasskeyRelatedOriginsForRpId(rpId: string): string[] {
  if (!rpId) {
    return [];
  }

  const normalizedRpId = rpId.toLowerCase();
  const dedupedOrigins = new Set<string>();

  config.passkeyRpConfigs.forEach((item) => {
    if (item.rpId.toLowerCase() !== normalizedRpId) {
      return;
    }

    if (originMatchesRpId(item.rpOriginHostname, normalizedRpId)) {
      return;
    }

    dedupedOrigins.add(item.normalizedRpOrigin);
  });

  return Array.from(dedupedOrigins);
}

// Function to get a config value, though direct access is also possible
export function getConfigValue<K extends keyof AppConfig>(key: K): AppConfig[K] {
  return config[key];
}
