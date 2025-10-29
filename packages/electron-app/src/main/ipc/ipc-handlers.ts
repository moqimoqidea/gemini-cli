/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcMain } from 'electron';
import { z } from 'zod';
import Store from 'electron-store';
import os from 'node:os';
import fs from 'node:fs';
import { join, extname } from 'node:path';
import type { WindowManager } from '../managers/window-manager';
import type { CliSettings } from '../config/types';
import { deepMerge } from '../utils/utils';
import type { Settings } from '@google/gemini-cli/dist/src/config/settings.js';

const store = new Store();

// Validation Schemas
const resizeSchema = z.object({
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});

const resolveSchema = z.object({
  diffPath: z.string().min(1),
  status: z.string(),
  content: z.string().optional(),
});

const settingsSetSchema = z.object({
  changes: z.record(z.unknown()),
  scope: z.enum(['User', 'System', 'Workspace']).optional(),
});

const themeSetSchema = z.enum(['light', 'dark']);

const languageMapSetSchema = z.record(z.string());

export function registerIpcHandlers(windowManager: WindowManager) {
  let prevResize = [0, 0];

  ipcMain.on('terminal.keystroke', (_event, key) => {
    windowManager.getPtyManager()?.write(key);
  });

  ipcMain.on('terminal.resize', (_event, payload) => {
    const parseResult = resizeSchema.safeParse(payload);
    if (!parseResult.success) {
      console.warn('[IPC] Invalid terminal.resize payload:', parseResult.error);
      return;
    }
    const { cols, rows } = parseResult.data;

    if (cols !== prevResize[0] || rows !== prevResize[1]) {
      windowManager.getPtyManager()?.resize(cols, rows);
      prevResize = [cols, rows];
    }
  });

  ipcMain.handle('settings:restart-terminal', async () => {
    await windowManager.getPtyManager()?.start();
  });

  ipcMain.on('theme:set', (_event, payload) => {
    const parseResult = themeSetSchema.safeParse(payload);
    if (!parseResult.success) {
      console.warn('[IPC] Invalid theme:set payload:', parseResult.error);
      return;
    }
    const theme = parseResult.data;
    const backgroundColor = theme === 'dark' ? '#282a36' : '#ffffff';
    windowManager.getMainWindow()?.setBackgroundColor(backgroundColor);
  });

  ipcMain.handle('gemini-editor:resolve', async (_event, payload) => {
    const parseResult = resolveSchema.safeParse(payload);
    if (!parseResult.success) {
      console.error(
        '[IPC] Invalid gemini-editor:resolve payload:',
        parseResult.error,
      );
      return { success: false, error: 'Invalid payload' };
    }
    const { diffPath, status, content } = parseResult.data;

    try {
      const metaPath = join(diffPath, 'meta.json');
      const meta = JSON.parse(await fs.promises.readFile(metaPath, 'utf-8'));
      const fileType = extname(meta.filePath);
      const newFilePath = join(diffPath, `new${fileType}`);
      const responsePath = join(diffPath, 'response.json');

      if (status === 'approve') {
        await fs.promises.writeFile(newFilePath, content || '');
      }
      await fs.promises.writeFile(responsePath, JSON.stringify({ status }));
      return { success: true };
    } catch (e) {
      console.error('Error resolving gemini-editor request:', e);
      return { success: false, error: (e as Error).message };
    }
  });

  ipcMain.handle('settings:get', async () => {
    const { loadSettings } = await import(
      '@google/gemini-cli/dist/src/config/settings.js'
    );
    const settings = await loadSettings(os.homedir());
    const merged = settings.merged as CliSettings;

    if (typeof merged.env === 'object' && merged.env !== null) {
      merged.env = Object.entries(merged.env)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
    }

    return {
      system: settings.system,
      user: settings.user,
      workspace: settings.workspace,
      merged,
    };
  });

  ipcMain.handle('settings:get-schema', async () => {
    try {
      const mod = await import(
        '@google/gemini-cli/dist/src/config/settingsSchema.js'
      );
      if (mod.getSettingsSchema) {
        return mod.getSettingsSchema();
      }
      // Fallback if it was exported directly
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((mod as any).SETTINGS_SCHEMA) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (mod as any).SETTINGS_SCHEMA;
      }
      throw new Error('Schema not found in module');
    } catch (error) {
      console.error('[IPC] Failed to load settings schema:', error);
      throw error;
    }
  });

  ipcMain.handle('themes:get', async () => {
    const { loadSettings } = await import(
      '@google/gemini-cli/dist/src/config/settings.js'
    );
    const { themeManager } = await import(
      '@google/gemini-cli/dist/src/ui/themes/theme-manager.js'
    );
    const { merged } = await loadSettings(os.homedir());
    const settings = merged as CliSettings;
    themeManager.loadCustomThemes(settings.customThemes);
    return themeManager.getAvailableThemes();
  });

  ipcMain.handle('settings:set', async (_event, payload) => {
    const parseResult = settingsSetSchema.safeParse(payload);
    if (!parseResult.success) {
      return { success: false, error: 'Invalid payload' };
    }
    const { changes, scope = 'User' } = parseResult.data;

    const { loadSettings, saveSettings, SettingScope } = await import(
      '@google/gemini-cli/dist/src/config/settings.js'
    );
    try {
      const loadedSettings = await loadSettings(os.homedir());

      let scopeEnum: (typeof SettingScope)[keyof typeof SettingScope];
      if (scope === 'Workspace') {
        scopeEnum = SettingScope.Workspace;
      } else if (scope === 'System') {
        scopeEnum = SettingScope.System;
      } else {
        scopeEnum = SettingScope.User;
      }

      const settingsFile = loadedSettings.forScope(scopeEnum);

      const newSettings = { ...settingsFile.settings } as CliSettings;
      const typedChanges = changes as CliSettings;

      if (typedChanges.mcpServers) {
        newSettings.mcpServers = typedChanges.mcpServers;
        delete typedChanges.mcpServers;
      }

      if (typedChanges.env) {
        newSettings.env = typedChanges.env;
        delete typedChanges.env;
      }

      const mergedSettings = deepMerge(newSettings, typedChanges);

      saveSettings({
        path: settingsFile.path,
        settings: mergedSettings as unknown as Settings,
        originalSettings: mergedSettings as unknown as Settings,
      });

      const newTheme = await windowManager.getThemeFromSettings();
      if (newTheme) {
        const mainWindow = windowManager.getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('theme:init', newTheme);
          mainWindow.setBackgroundColor(newTheme.colors.Background);
        }
      }
      return { success: true };
    } catch (error) {
      console.error('Error writing settings.json:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('language-map:get', async () => store.get('languageMap', {}));

  ipcMain.handle('language-map:set', async (_event, payload) => {
    const parseResult = languageMapSetSchema.safeParse(payload);
    if (parseResult.success) {
      store.set('languageMap', parseResult.data);
    }
  });
}
