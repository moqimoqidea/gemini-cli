/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserWindow } from 'electron';
import { dialog } from 'electron';
import * as pty from 'node-pty';
import os from 'node:os';
import fs from 'node:fs';
import { join, extname, basename, dirname } from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import chokidar from 'chokidar';
import type { CliSettings } from '../config/types';
import { CLI_PATH } from '../config/paths';

export class PtyManager {
  private ptyProcess: pty.IPty | null = null;
  private onDataDisposable: pty.IDisposable | null = null;
  private fileWatcher: chokidar.FSWatcher | null = null;

  constructor(private mainWindow: BrowserWindow) {}

  async start(retryCount = 0) {
    await this.dispose();

    // Add a small delay to allow OS to clean up process if needed
    await new Promise((resolve) => setTimeout(resolve, 250));

    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }

    this.mainWindow.webContents.send('terminal.reset');
    const sessionId = crypto.randomUUID();
    await this.setupFileWatcher();

    console.log(`[PTY] Starting PTY process with CLI path: ${CLI_PATH}`);

    if (!fs.existsSync(CLI_PATH)) {
      const errorMsg = `[PTY] CLI path not found: ${CLI_PATH}`;
      console.error(errorMsg);
      dialog.showErrorBox('Fatal Error', errorMsg);
      return;
    }

    const terminalCwd = await this.getTerminalCwd();
    const env = await this.getEnv();

    try {
      const ptyProcess = pty.spawn(CLI_PATH, [], {
        name: 'xterm-color',
        cols: 80,
        rows: 30,
        cwd: terminalCwd,
        env: {
          ...process.env,
          ...env,
          ELECTRON_RUN_AS_NODE: '1',
          GEMINI_CLI_CONTEXT: 'electron',
          GEMINI_SESSION_ID: sessionId,
          NODE_NO_WARNINGS: '1',
          DEV: 'false',
        },
      });
      this.ptyProcess = ptyProcess;

      const outputBuffer: string[] = [];
      const startTime = Date.now();

      ptyProcess.onExit(({ exitCode, signal }) => {
        // Only clear if it's the current process
        if (this.ptyProcess === ptyProcess) {
          this.ptyProcess = null;
        }
        console.log(
          `[PTY] Process exited with code ${exitCode} and signal ${signal}`,
        );

        const output = outputBuffer.join('').trim();
        const baseMessage = `Exit Code: ${exitCode}, Signal: ${signal}`;
        const fullMessage = output
          ? `${baseMessage}\n\nOutput:\n${output}`
          : baseMessage;

        const duration = Date.now() - startTime;

        if (exitCode !== 0) {
          dialog.showErrorBox('PTY Process Exited Unexpectedly', fullMessage);
        } else if (duration < 2000) {
          // Only show "exited too quickly" if it wasn't intentionally killed
        } else {
          if (!this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send(
              'terminal.incomingData',
              '\r\n[Process completed]\r\n',
            );
          }
        }
      });

      this.onDataDisposable = ptyProcess.onData((data) => {
        outputBuffer.push(data);
        if (!this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('terminal.incomingData', data);
        }
      });
    } catch (e) {
      const error = e as Error;
      console.error(
        `[PTY] Failed to start PTY process (attempt ${retryCount + 1}):`,
        error,
      );

      if (retryCount < 3) {
        setTimeout(() => this.start(retryCount + 1), 1000 * (retryCount + 1));
        return;
      }

      dialog.showErrorBox(
        'Failed to Start PTY Process',
        `Message: ${error.message}\nStack: ${error.stack}`,
      );
    }
  }

  resize(cols: number, rows: number) {
    if (this.ptyProcess) {
      try {
        this.ptyProcess.resize(cols, rows);
      } catch (error) {
        console.warn('[PTY] Failed to resize PTY:', error);
      }
    }
  }

  write(data: string) {
    if (this.ptyProcess) {
      try {
        this.ptyProcess.write(data);
      } catch (error) {
        console.warn('[PTY] Failed to write to PTY:', error);
      }
    } else {
      console.warn('[PTY] Cannot write, ptyProcess is null');
    }
  }

  async dispose() {
    if (this.onDataDisposable) {
      this.onDataDisposable.dispose();
      this.onDataDisposable = null;
    }
    if (this.ptyProcess) {
      this.ptyProcess.kill();
      this.ptyProcess = null;
    }
    if (this.fileWatcher) {
      await this.fileWatcher.close();
      this.fileWatcher = null;
    }
  }

  private async getTerminalCwd() {
    const { loadSettings } = await import(
      '@google/gemini-cli/dist/src/config/settings.js'
    );
    const { merged } = await loadSettings(os.homedir());
    const settings = merged as CliSettings;
    if (settings.terminalCwd && typeof settings.terminalCwd === 'string') {
      return settings.terminalCwd;
    }
    return join(os.homedir(), 'Documents');
  }

  private async getEnv() {
    const { loadSettings } = await import(
      '@google/gemini-cli/dist/src/config/settings.js'
    );
    const { merged } = await loadSettings(os.homedir());
    const settings = merged as CliSettings;

    const env: Record<string, string> = {};
    if (typeof settings.env === 'string') {
      for (const line of settings.env.split('\n')) {
        const parts = line.split('=');
        const key = parts.shift();
        const value = parts.join('=');
        if (key) {
          env[key] = value;
        }
      }
    }
    return env;
  }

  private async setupFileWatcher() {
    const diffDir = join(os.homedir(), '.gemini', 'tmp', 'diff');
    try {
      await fs.promises.mkdir(diffDir, { recursive: true });
    } catch (e) {
      console.error('Error creating diff directory:', e);
      return;
    }

    if (this.fileWatcher) {
      await this.fileWatcher.close();
    }

    this.fileWatcher = chokidar.watch(diffDir, {
      ignoreInitial: true,
      depth: 2,
      persistent: true,
    });

    this.fileWatcher.on('add', async (filePath) => {
      if (basename(filePath) === 'meta.json') {
        const fullPath = dirname(filePath);
        const responsePath = join(fullPath, 'response.json');

        try {
          if (fs.existsSync(responsePath)) {
            return;
          }

          // Give a tiny bit more time for other files to be written
          await new Promise((resolve) => setTimeout(resolve, 100));

          const meta = JSON.parse(
            await fs.promises.readFile(filePath, 'utf-8'),
          );
          const fileType = extname(meta.filePath);

          const oldPath = join(fullPath, `old${fileType}`);
          const newPath = join(fullPath, `new${fileType}`);

          if (!fs.existsSync(oldPath) || !fs.existsSync(newPath)) {
            console.warn(`Missing old or new file in ${fullPath}`);
            return;
          }

          const oldContent = await fs.promises.readFile(oldPath, 'utf-8');
          const newContent = await fs.promises.readFile(newPath, 'utf-8');

          if (!this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('gemini-editor:show', {
              diffPath: fullPath,
              oldContent,
              newContent,
              meta,
            });
          }
        } catch (e) {
          console.error('Error processing new diff:', e);
        }
      }
    });
  }
}
