/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { AuthModuleConfig, MCPServerConfig } from '../config/config.js';
import { debugLogger } from '../utils/debugLogger.js';
import { getErrorMessage } from '../utils/errors.js';

export interface AuthModuleContext {
  serverName: string;
  mcpServerConfig: MCPServerConfig;
}

function isOAuthClientProvider(
  candidate: unknown,
): candidate is OAuthClientProvider {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }
  const maybeProvider = candidate as Record<string, unknown>;
  return (
    typeof maybeProvider['tokens'] === 'function' &&
    typeof maybeProvider['saveTokens'] === 'function' &&
    typeof maybeProvider['redirectUrl'] === 'string' &&
    typeof maybeProvider['clientMetadata'] === 'object' &&
    maybeProvider['clientMetadata'] !== null
  );
}

export async function loadAuthProviderFromModule(
  serverName: string,
  mcpServerConfig: MCPServerConfig,
  auth: AuthModuleConfig,
): Promise<OAuthClientProvider> {
  const modulePath = auth.module;

  try {
    await access(modulePath, fsConstants.R_OK);
  } catch (error) {
    throw new Error(
      `Auth provider module for server "${serverName}" is not readable: ${getErrorMessage(error)}`,
    );
  }

  const moduleUrl = pathToFileURL(modulePath).href;
  debugLogger.debug(
    `Loading auth provider for '${serverName}' from module ${moduleUrl}`,
  );

  let importedModule: Record<string, unknown>;
  try {
    importedModule = (await import(moduleUrl)) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Failed to import auth provider module for '${serverName}': ${getErrorMessage(error)}`,
    );
  }

  const exportName = auth.export ?? 'default';
  let exportedValue: unknown;
  if (exportName === 'default') {
    exportedValue = importedModule['default'];
  } else {
    exportedValue = importedModule[exportName];
  }

  if (exportedValue === undefined) {
    throw new Error(
      `Auth provider module for '${serverName}' does not export '${exportName}'.`,
    );
  }

  const context: AuthModuleContext = {
    serverName,
    mcpServerConfig,
  };

  let candidateProvider: unknown = exportedValue;
  if (typeof exportedValue === 'function') {
    const factory = exportedValue as (
      options: Record<string, unknown> | undefined,
      context: AuthModuleContext,
    ) => unknown;
    try {
      candidateProvider = await factory(auth.options, context);
    } catch (error) {
      throw new Error(
        `Auth provider factory threw for '${serverName}': ${getErrorMessage(error)}`,
      );
    }
  }

  if (candidateProvider instanceof Promise) {
    try {
      candidateProvider = await candidateProvider;
    } catch (error) {
      throw new Error(
        `Auth provider promise rejected for '${serverName}': ${getErrorMessage(error)}`,
      );
    }
  }

  if (!isOAuthClientProvider(candidateProvider)) {
    throw new Error(
      `Auth provider module for '${serverName}' did not return an OAuthClientProvider instance.`,
    );
  }

  return candidateProvider;
}
