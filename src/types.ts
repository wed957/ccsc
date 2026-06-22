export type AppType = 'claude' | 'codex';

export interface Provider {
  id: string;
  name: string;
  displayName: string;
  envVars: Record<string, string>;
  settingsConfig: Record<string, unknown>;
  appType: AppType;
  apiFormat?: string;
  selectionDisabledReason?: string;
}

export interface ProviderRow {
  id: string;
  name: string;
  settings_config: string;
}

export interface HistoryEntry {
  name: string;
  timestamp: number;
  appType: AppType;
}
