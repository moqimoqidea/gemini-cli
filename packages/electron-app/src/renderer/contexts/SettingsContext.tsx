/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { createContext, useContext, useState, useEffect } from 'react';

interface SettingsContextType {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any;
  loading: boolean;
  refreshSettings: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [settings, setSettings] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [schema, setSchema] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const refreshSettings = async () => {
    setLoading(true);
    try {
      const [fetchedSettings, fetchedSchema] = await Promise.all([
        window.electron.settings.get(),
        window.electron.settings.getSchema(),
      ]);
      setSettings(fetchedSettings);
      setSchema(fetchedSchema);
    } catch (error) {
      console.error('Failed to load settings or schema:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshSettings();
  }, []);

  return (
    <SettingsContext.Provider
      value={{ settings, schema, loading, refreshSettings }}
    >
      {children}
    </SettingsContext.Provider>
  );
}
