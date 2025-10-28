/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Config,
  GeminiCLIExtension,
  MCPServerConfig,
} from '../config/config.js';
import type { ToolRegistry } from './tool-registry.js';
import {
  McpClient,
  MCPDiscoveryState,
  populateMcpServerCommand,
} from './mcp-client.js';
import { getErrorMessage } from '../utils/errors.js';
import type { EventEmitter } from 'node:events';
import { coreEvents } from '../utils/events.js';
import { debugLogger } from '../utils/debugLogger.js';

/**
 * Manages the lifecycle of multiple MCP clients, including local child processes.
 * This class is responsible for starting, stopping, and discovering tools from
 * a collection of MCP servers defined in the configuration.
 */
export class McpClientManager {
  private clients: Map<string, McpClient> = new Map();
  private readonly toolRegistry: ToolRegistry;
  private readonly cliConfig: Config;
  private discoveryState: MCPDiscoveryState = MCPDiscoveryState.NOT_STARTED;
  private readonly eventEmitter?: EventEmitter;

  constructor(
    toolRegistry: ToolRegistry,
    cliConfig: Config,
    eventEmitter?: EventEmitter,
  ) {
    this.toolRegistry = toolRegistry;
    this.cliConfig = cliConfig;
    this.eventEmitter = eventEmitter;
    this.eventEmitter = eventEmitter;
    this.cliConfig
      .getExtensionLoader()
      .extensionEvents()
      .on('extensionLoaded', (event) => this.loadExtension(event.extension))
      .on('extensionEnabled', (event) => this.loadExtension(event.extension))
      .on('extensionDisabled', (event) => this.unloadExtension(event.extension))
      .on('extensionUnloaded', (event) =>
        this.unloadExtension(event.extension),
      );
  }

  private async unloadExtension(extension: GeminiCLIExtension) {
    debugLogger.warn(`Unloading extension: ${extension.name}`);
    await Promise.all(
      Object.keys(extension.mcpServers ?? {}).map((name) =>
        this.disconnectClient(name),
      ),
    );
  }

  private async loadExtension(extension: GeminiCLIExtension) {
    debugLogger.warn(`Loading extension: ${extension.name}`);
    this.discoveryState = MCPDiscoveryState.IN_PROGRESS;
    await Promise.all(
      Object.entries(extension.mcpServers ?? {}).map(([name, config]) =>
        this.
      (name, config),
      ),
    );
    this.discoveryState = MCPDiscoveryState.COMPLETED;
  }

  private async disconnectClient(name: string) {
    const existing = this.clients.get(name);
    if (existing) {
      try {
        this.clients.delete(name);
        this.eventEmitter?.emit('mcp-client-update', this.clients);
        await existing.disconnect();
      } catch (error) {
        debugLogger.warn(
          `Error stopping client '${name}': ${getErrorMessage(error)}`,
        );
      }
    }
  }

  async discoverMcpTools(name: string, config: MCPServerConfig) {
    if (!this.cliConfig.isTrustedFolder()) {
      return;
    }
    if (config.extension && !config.extension.isActive) {
      return;
    }
    await this.disconnectClient(name);

    const client = new McpClient(
      name,
      config,
      this.toolRegistry,
      this.cliConfig.getPromptRegistry(),
      this.cliConfig.getWorkspaceContext(),
      this.cliConfig.getDebugMode(),
    );
    this.clients.set(name, client);
    this.eventEmitter?.emit('mcp-client-update', this.clients);
    try {
      await client.connect();
      await client.discover(this.cliConfig);
      this.eventEmitter?.emit('mcp-client-update', this.clients);
    } catch (error) {
      this.eventEmitter?.emit('mcp-client-update', this.clients);
      // Log the error but don't let a single failed server stop the others
      coreEvents.emitFeedback(
        'error',
        `Error during discovery for server '${name}': ${getErrorMessage(
          error,
        )}`,
        error,
      );
    }
  }

  /**
   * Initiates the tool discovery process for all configured MCP servers.
   * It connects to each server, discovers its available tools, and registers
   * them with the `ToolRegistry`.
   */
  async discoverAllMcpTools(): Promise<void> {
    if (!this.cliConfig.isTrustedFolder()) {
      return;
    }
    await this.stop();

    const servers = populateMcpServerCommand(
      this.cliConfig.getMcpServers() || {},
      this.cliConfig.getMcpServerCommand(),
    );

    this.discoveryState = MCPDiscoveryState.IN_PROGRESS;

    this.eventEmitter?.emit('mcp-client-update', this.clients);
    const discoveryPromises = Object.entries(servers).map(
      async ([name, config]) => this.discoverMcpTools(name, config),
    );

    await Promise.all(discoveryPromises);
    this.discoveryState = MCPDiscoveryState.COMPLETED;
  }

  /**
   * Stops all running local MCP servers and closes all client connections.
   * This is the cleanup method to be called on application exit.
   */
  async stop(): Promise<void> {
    const disconnectionPromises = Array.from(this.clients.entries()).map(
      async ([name, client]) => {
        try {
          await client.disconnect();
        } catch (error) {
          console.error(
            `Error stopping client '${name}': ${getErrorMessage(error)}`,
          );
        }
      },
    );

    await Promise.all(disconnectionPromises);
    this.clients.clear();
  }

  getDiscoveryState(): MCPDiscoveryState {
    return this.discoveryState;
  }
}
