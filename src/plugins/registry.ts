import type { ForumConfig } from "@/lib/types";

const registry = new Map<number, ForumConfig>();

export function registerPlugin(config: ForumConfig): void {
  registry.set(config.fid, config);
}

export function getPlugin(fid: number): ForumConfig | undefined {
  return registry.get(fid);
}

export function getAllPlugins(): ForumConfig[] {
  return Array.from(registry.values());
}

export function isPluginRegistered(fid: number): boolean {
  return registry.has(fid);
}
