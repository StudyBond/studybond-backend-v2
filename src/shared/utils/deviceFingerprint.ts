import { createHash, randomUUID } from 'crypto';

export interface DeviceFingerprintInput {
  installationId?: string;
  deviceId?: string;
  deviceName?: string;
  platform?: string;
  platformVersion?: string;
  osName?: string;
  osVersion?: string;
  browserName?: string;
  browserVersion?: string;
  model?: string;
  manufacturer?: string;
  appVersion?: string;
  language?: string;
  timezone?: string;
  vendor?: string;
  fingerprintSeed?: string;
  userAgent?: string;
  screenWidth?: number;
  screenHeight?: number;
  colorDepth?: number;
  pixelRatio?: number;
  deviceMemory?: number;
  hardwareConcurrency?: number;
  maxTouchPoints?: number;
}

export interface DeviceContextInput {
  deviceId?: string;
  deviceName?: string;
  device?: DeviceFingerprintInput;
}

export interface DeviceRequestContext {
  userAgent?: string;
  ipAddress?: string;
}

export interface ResolvedDeviceFingerprint {
  deviceKey: string;
  fingerprintHash: string;
  deviceBindingHash?: string;
  deviceName: string;
  userAgent: string;
  fingerprintData: Record<string, unknown>;
  ipAddress?: string;
}

const DEVICE_FINGERPRINT_VERSION = 2;

function sanitizeString(value: string | undefined, lowerCase = false): string | undefined {
  const candidate = value?.trim();
  if (!candidate) return undefined;
  return lowerCase ? candidate.toLowerCase() : candidate;
}

function sanitizeNumber(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined;
  return value;
}

function stableStringify(input: unknown): string {
  if (input === null || input === undefined) return 'null';

  if (Array.isArray(input)) {
    return `[${input.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (typeof input === 'object') {
    const object = input as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`);
    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(input);
}

function pruneEmpty(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

function hashFingerprintMaterial(input: Record<string, unknown>): string {
  return createHash('sha256')
    .update(stableStringify(input))
    .digest('hex');
}

function buildDeviceBindingMaterial(device: Record<string, unknown>): Record<string, unknown> {
  return pruneEmpty({
    platform: sanitizeString(device.platform as string | undefined, true),
    platformVersion: sanitizeString(device.platformVersion as string | undefined),
    osName: sanitizeString(device.osName as string | undefined, true),
    osVersion: sanitizeString(device.osVersion as string | undefined),
    model: sanitizeString(device.model as string | undefined),
    manufacturer: sanitizeString(device.manufacturer as string | undefined),
    vendor: sanitizeString(device.vendor as string | undefined),
    screenWidth: sanitizeNumber(device.screenWidth as number | undefined),
    screenHeight: sanitizeNumber(device.screenHeight as number | undefined),
    colorDepth: sanitizeNumber(device.colorDepth as number | undefined),
    pixelRatio: sanitizeNumber(device.pixelRatio as number | undefined),
    deviceMemory: sanitizeNumber(device.deviceMemory as number | undefined),
    hardwareConcurrency: sanitizeNumber(device.hardwareConcurrency as number | undefined),
    maxTouchPoints: sanitizeNumber(device.maxTouchPoints as number | undefined),
  });
}

function buildFallbackDeviceName(device: Record<string, unknown>): string {
  const explicit = sanitizeString(device.deviceName as string | undefined);
  if (explicit) return explicit;

  const browserName = sanitizeString(device.browserName as string | undefined);
  const osName = sanitizeString(device.osName as string | undefined);
  const model = sanitizeString(device.model as string | undefined);
  const platform = sanitizeString(device.platform as string | undefined);

  if (model && osName) return `${model} (${osName})`;
  if (browserName && osName) return `${browserName} on ${osName}`;
  if (browserName && platform) return `${browserName} on ${platform}`;
  if (osName) return osName;
  if (platform) return platform;

  return 'Unknown Device';
}

export function normalizeDeviceId(rawDeviceId: string): string {
  return rawDeviceId.trim().toLowerCase();
}

export function normalizeDeviceName(rawDeviceName?: string): string {
  const candidate = sanitizeString(rawDeviceName);
  return candidate || 'Unknown Device';
}

export function resolveStoredDeviceBindingHash(input: unknown): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }

  const candidate = input as Record<string, unknown>;
  const existingHash = sanitizeString(candidate.deviceBindingHash as string | undefined, true);
  if (existingHash) {
    return existingHash;
  }

  const material = buildDeviceBindingMaterial(candidate);
  if (Object.keys(material).length === 0) {
    return undefined;
  }

  return hashFingerprintMaterial(material);
}

export function resolveDeviceFingerprint(
  input: DeviceContextInput | undefined,
  context: DeviceRequestContext = {}
): ResolvedDeviceFingerprint | null {
  const device = input?.device || {};
  const userAgent = sanitizeString(device.userAgent, false) || sanitizeString(context.userAgent, false) || 'Unknown User Agent';
  const deviceId =
    sanitizeString(device.installationId, true) ||
    sanitizeString(device.deviceId, true) ||
    sanitizeString(input?.deviceId, true) ||
    sanitizeString(device.fingerprintSeed, true);

  const normalizedDeviceBase = pruneEmpty({
    installationId: sanitizeString(device.installationId, true),
    deviceId: sanitizeString(device.deviceId, true) || sanitizeString(input?.deviceId, true),
    deviceName: sanitizeString(device.deviceName) || sanitizeString(input?.deviceName),
    platform: sanitizeString(device.platform, true),
    platformVersion: sanitizeString(device.platformVersion),
    osName: sanitizeString(device.osName, true),
    osVersion: sanitizeString(device.osVersion),
    browserName: sanitizeString(device.browserName, true),
    browserVersion: sanitizeString(device.browserVersion),
    model: sanitizeString(device.model),
    manufacturer: sanitizeString(device.manufacturer),
    appVersion: sanitizeString(device.appVersion),
    language: sanitizeString(device.language, true),
    timezone: sanitizeString(device.timezone),
    vendor: sanitizeString(device.vendor),
    screenWidth: sanitizeNumber(device.screenWidth),
    screenHeight: sanitizeNumber(device.screenHeight),
    colorDepth: sanitizeNumber(device.colorDepth),
    pixelRatio: sanitizeNumber(device.pixelRatio),
    deviceMemory: sanitizeNumber(device.deviceMemory),
    hardwareConcurrency: sanitizeNumber(device.hardwareConcurrency),
    maxTouchPoints: sanitizeNumber(device.maxTouchPoints),
    userAgent
  });

  if (Object.keys(normalizedDeviceBase).length === 0 && !deviceId) {
    return null;
  }

  const deviceBindingHash = resolveStoredDeviceBindingHash(normalizedDeviceBase);
  const fingerprintHash = hashFingerprintMaterial(normalizedDeviceBase);
  const normalizedDevice = pruneEmpty({
    ...normalizedDeviceBase,
    deviceBindingHash,
    fingerprintVersion: DEVICE_FINGERPRINT_VERSION
  });

  return {
    deviceKey: deviceId || `fp:${deviceBindingHash ?? fingerprintHash}`,
    fingerprintHash,
    deviceBindingHash,
    deviceName: buildFallbackDeviceName(normalizedDevice),
    userAgent,
    fingerprintData: normalizedDevice,
    ipAddress: sanitizeString(context.ipAddress)
  };
}

export function createEphemeralSessionDeviceKey(): string {
  return `free:${randomUUID()}`;
}
