import NodeSqlite from 'node-sqlite3-wasm';
const { Database } = NodeSqlite;
import path from 'path';
import os from 'os';
import { existsSync } from 'fs';
import net from 'net';
import type { Provider, ProviderRow, AppType } from './types.js';
/**
 * Get the CC Switch database path
 * Priority:
 * 1. CC_SWITCH_DB_PATH environment variable (full path to database file)
 * 2. CC_SWITCH_HOME environment variable (custom config directory)
 * 3. Default: ~/.cc-switch/cc-switch.db
 */
function getDbPath(): string {
  // 1. Full path to database file
  const dbPathEnv = process.env.CC_SWITCH_DB_PATH;
  if (dbPathEnv) {
    return dbPathEnv;
  }

  // 2. Custom config directory
  const homeEnv = process.env.CC_SWITCH_HOME;
  if (homeEnv) {
    return path.join(homeEnv, 'cc-switch.db');
  }

  // 3. Default path
  const homeDir = os.homedir();
  return path.join(homeDir, '.cc-switch', 'cc-switch.db');
}

/**
 * Check if CC Switch database exists
 */
export function isDbAvailable(): boolean {
  const dbPath = getDbPath();
  return existsSync(dbPath);
}

/**
 * Get common config env from settings table
 */
function getCommonConfigEnv(appType: AppType = 'claude'): Record<string, string> {
  const dbPath = getDbPath();
  if (!existsSync(dbPath)) return {};

  const db = new Database(dbPath);
  try {
    const row = db.get(
      "SELECT value FROM settings WHERE key = ?",
      [`common_config_${appType}`]
    ) as { value: string } | undefined;

    if (!row) return {};

    const config = JSON.parse(row.value);
    return config.env || {};
  } catch {
    return {};
  } finally {
    db.close();
  }
}

/**
 * Get common config for a given app type (JSON-parsed)
 */
export function getCommonConfig(appType: string = 'claude'): Record<string, unknown> {
  const dbPath = getDbPath();
  if (!existsSync(dbPath)) return {};

  const db = new Database(dbPath);
  try {
    const row = db.get(
      "SELECT value FROM settings WHERE key = ?",
      [`common_config_${appType}`]
    ) as { value: string } | undefined;

    if (!row) return {};
    return JSON.parse(row.value);
  } catch {
    return {};
  } finally {
    db.close();
  }
}

/**
 * Get common config raw value for a given app type (as stored in DB)
 * Used for non-JSON formats like TOML (codex)
 */
export function getCommonConfigRaw(appType: string): string {
  const dbPath = getDbPath();
  if (!existsSync(dbPath)) return '';

  const db = new Database(dbPath);
  try {
    const row = db.get(
      "SELECT value FROM settings WHERE key = ?",
      [`common_config_${appType}`]
    ) as { value: string } | undefined;

    return row?.value || '';
  } catch {
    return '';
  } finally {
    db.close();
  }
}

/**
 * Get proxy config for a given app type
 * Returns {address, port} if proxy is enabled, null otherwise
 */
export function getProxyConfig(appType: AppType): { address: string; port: number } | null {
  const dbPath = getDbPath();
  if (!existsSync(dbPath)) return null;

  const db = new Database(dbPath);
  try {
    const row = db.get(
      "SELECT listen_address, listen_port, enabled FROM proxy_config WHERE app_type = ?",
      [appType]
    ) as { listen_address: string; listen_port: number; enabled: number } | undefined;

    if (!row || row.enabled !== 1) return null;
    return { address: row.listen_address, port: row.listen_port };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/**
 * Update the is_current flag for a provider so the cc-switch proxy routes correctly.
 * Sets all providers of the same app_type to is_current = 0, then sets the
 * selected provider to is_current = 1.
 */
export function setCurrentProvider(appType: AppType, providerId: string): void {
  const dbPath = getDbPath();
  if (!existsSync(dbPath)) return;

  const db = new Database(dbPath);
  try {
    db.run(
      'UPDATE providers SET is_current = 0 WHERE app_type = ?',
      [appType]
    );
    db.run(
      'UPDATE providers SET is_current = 1 WHERE id = ? AND app_type = ?',
      [providerId, appType]
    );
  } catch {
    // Silently ignore errors
  } finally {
    db.close();
  }
}

/**
 * Check if the cc-switch proxy is accepting connections on the given address:port
 */
export async function isProxyRunning(address: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 2000);

    socket.connect(port, address, () => {
      clearTimeout(timeout);
      socket.end();
      resolve(true);
    });

    socket.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

/**
 * Enable or disable auto-failover for a given app type in cc-switch proxy config
 */
export function setAutoFailover(appType: AppType, enabled: boolean): void {
  const dbPath = getDbPath();
  if (!existsSync(dbPath)) return;

  const db = new Database(dbPath);
  try {
    db.run(
      'UPDATE proxy_config SET auto_failover_enabled = ? WHERE app_type = ?',
      [enabled ? 1 : 0, appType]
    );
  } catch {
    // Silently ignore errors
  } finally {
    db.close();
  }
}

/**
 * Get the currently active provider ID for an app type (is_current = 1)
 */
export function getCurrentProviderId(appType: AppType): string | null {
  const dbPath = getDbPath();
  if (!existsSync(dbPath)) return null;

  const db = new Database(dbPath);
  try {
    const row = db.get(
      'SELECT id FROM providers WHERE app_type = ? AND is_current = 1 LIMIT 1',
      [appType]
    ) as { id: string } | undefined;
    return row?.id || null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/**
 * Get the current auto_failover_enabled value for an app type
 */
export function getAutoFailoverEnabled(appType: AppType): boolean {
  const dbPath = getDbPath();
  if (!existsSync(dbPath)) return false;

  const db = new Database(dbPath);
  try {
    const row = db.get(
      'SELECT auto_failover_enabled FROM proxy_config WHERE app_type = ?',
      [appType]
    ) as { auto_failover_enabled: number } | undefined;
    return row?.auto_failover_enabled === 1;
  } catch {
    return false;
  } finally {
    db.close();
  }
}

/**
 * Restore proxy state: set is_current back to a specific provider and
 * restore auto_failover_enabled. Used to clean up after CCSC finishes.
 */
export function restoreProxyState(
  appType: AppType,
  previousProviderId: string | null,
  previousAutoFailover: boolean
): void {
  const dbPath = getDbPath();
  if (!existsSync(dbPath)) return;

  const db = new Database(dbPath);
  try {
    // Restore is_current
    if (previousProviderId) {
      db.run('UPDATE providers SET is_current = 0 WHERE app_type = ?', [appType]);
      db.run(
        'UPDATE providers SET is_current = 1 WHERE id = ? AND app_type = ?',
        [previousProviderId, appType]
      );
    }

    // Restore auto_failover
    db.run(
      'UPDATE proxy_config SET auto_failover_enabled = ? WHERE app_type = ?',
      [previousAutoFailover ? 1 : 0, appType]
    );
  } catch {
    // Silently ignore errors
  } finally {
    db.close();
  }
}

/**
 * Get all providers for a given app type from CC Switch database
 */
export function getProviders(appType: AppType = 'claude'): Provider[] {
  const dbPath = getDbPath();

  if (!existsSync(dbPath)) {
    throw new Error(
      `CC Switch database not found at: ${dbPath}\n` +
        'Please ensure CC Switch is installed and has been run at least once.'
    );
  }

  const db = new Database(dbPath);
  const commonEnv = getCommonConfigEnv(appType);

  try {
    const rows = db.all(
      `SELECT id, name, settings_config, json_extract(meta, '$.apiFormat') as api_format
       FROM providers
       WHERE app_type = ?
       ORDER BY name`,
      [appType]
    ) as unknown as (ProviderRow & { api_format: string | null })[];

    return rows.map((row) => parseProvider(row, commonEnv, appType, row.api_format || undefined));
  } finally {
    db.close();
  }
}

/**
 * Parse a database row into a Provider object
 */
function parseProvider(
  row: ProviderRow,
  commonEnv: Record<string, string>,
  appType: AppType = 'claude',
  apiFormat?: string
): Provider {
  let config: { env?: Record<string, string>; [key: string]: unknown } = {};

  try {
    config = JSON.parse(row.settings_config || '{}');
  } catch {
    // Ignore parse errors
  }

  // Provider env overrides common config
  const mergedEnv = { ...commonEnv, ...(config.env || {}) };

  return {
    id: row.id,
    name: row.name,
    displayName: row.name,
    envVars: mergedEnv,
    settingsConfig: config,
    appType,
    apiFormat,
  };
}

/**
 * Get a provider by name
 */
export function getProviderByName(name: string, appType: AppType = 'claude'): Provider | undefined {
  const providers = getProviders(appType);
  return providers.find(
    (p) => p.name.toLowerCase() === name.toLowerCase()
  );
}
