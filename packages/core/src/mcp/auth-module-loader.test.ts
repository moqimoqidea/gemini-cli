/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { loadAuthProviderFromModule } from './auth-module-loader.js';
import type { MCPServerConfig } from '../config/config.js';

function createTempModule(content: string): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'auth-provider-'));
  const file = path.join(dir, 'provider.mjs');
  writeFileSync(file, content, { encoding: 'utf-8' });
  return { dir, file };
}

describe('loadAuthProviderFromModule', () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    while (cleanupDirs.length) {
      const dir = cleanupDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('loads a default-exported provider factory', async () => {
    const moduleSource = `export default function createProvider(options) {
  return {
    redirectUrl: '',
    clientMetadata: {
      client_name: 'Test',
      redirect_uris: [],
      grant_types: [],
      response_types: [],
      token_endpoint_auth_method: 'none',
    },
    clientInformation() {
      return undefined;
    },
    saveClientInformation() {},
    async tokens() {
      return { access_token: options.token, token_type: 'Bearer' };
    },
    saveTokens() {},
    redirectToAuthorization() {},
    saveCodeVerifier() {},
    codeVerifier() {
      return '';
    },
  };
}`;
    const { dir, file } = createTempModule(moduleSource);
    cleanupDirs.push(dir);

    const provider = await loadAuthProviderFromModule(
      'test-server',
      {} as MCPServerConfig,
      {
        module: file,
        options: { token: 'abc' },
      },
    );

    const tokens = await provider.tokens();
    expect(tokens?.access_token).toBe('abc');
  });

  it('loads a named export provider', async () => {
    const moduleSource = `export function createProvider(options, context) {
  return {
    redirectUrl: '',
    clientMetadata: {
      client_name: context.serverName,
      redirect_uris: [],
      grant_types: [],
      response_types: [],
      token_endpoint_auth_method: 'none',
    },
    clientInformation() {
      return undefined;
    },
    saveClientInformation() {},
    async tokens() {
      return { access_token: options.token, token_type: 'Bearer' };
    },
    saveTokens() {},
    redirectToAuthorization() {},
    saveCodeVerifier() {},
    codeVerifier() {
      return '';
    },
  };
}`;
    const { dir, file } = createTempModule(moduleSource);
    cleanupDirs.push(dir);

    const provider = await loadAuthProviderFromModule(
      'server-name',
      {} as MCPServerConfig,
      {
        module: file,
        export: 'createProvider',
        options: { token: 'xyz' },
      },
    );

    const tokens = await provider.tokens();
    expect(tokens?.access_token).toBe('xyz');
    expect(provider.clientMetadata.client_name).toBe('server-name');
  });

  it('throws when the requested export is missing', async () => {
    const moduleSource = 'export const value = 42;';
    const { dir, file } = createTempModule(moduleSource);
    cleanupDirs.push(dir);

    await expect(
      loadAuthProviderFromModule('broken-server', {} as MCPServerConfig, {
        module: file,
        export: 'createProvider',
      }),
    ).rejects.toThrow(
      "Auth provider module for 'broken-server' does not export 'createProvider'.",
    );
  });
});
