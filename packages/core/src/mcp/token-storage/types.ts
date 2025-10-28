/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AuthModuleConfig } from '../../config/config.js';

/**
 * Interface for OAuth tokens.
 */
export interface OAuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType: string;
  scope?: string;
}

/**
 * Interface for stored OAuth credentials.
 */
export interface OAuthCredentials {
  serverName: string;
  token: OAuthToken;
  clientId?: string;
  tokenUrl?: string;
  mcpServerUrl?: string;
  authModule?: AuthModuleConfig;
  updatedAt: number;
}

export interface TokenStorage {
  getCredentials(serverName: string): Promise<OAuthCredentials | null>;
  setCredentials(credentials: OAuthCredentials): Promise<void>;
  deleteCredentials(serverName: string): Promise<void>;
  listServers(): Promise<string[]>;
  getAllCredentials(): Promise<Map<string, OAuthCredentials>>;
  clearAll(): Promise<void>;
}

export enum TokenStorageType {
  KEYCHAIN = 'keychain',
  ENCRYPTED_FILE = 'encrypted_file',
}
