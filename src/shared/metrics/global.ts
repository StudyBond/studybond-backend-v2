import { MetricsRegistry } from './registry';

let globalMetricsRegistry: MetricsRegistry | null = null;

export function setGlobalMetricsRegistry(registry: MetricsRegistry): void {
  globalMetricsRegistry = registry;
}

export function getGlobalMetricsRegistry(): MetricsRegistry | null {
  return globalMetricsRegistry;
}
