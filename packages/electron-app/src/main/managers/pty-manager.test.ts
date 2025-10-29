/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PtyManager } from './pty-manager.js';
import type { BrowserWindow } from 'electron';
import * as pty from 'node-pty';
import chokidar from 'chokidar';
import fs from 'node:fs';

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  dialog: {
    showErrorBox: vi.fn(),
  },
}));

vi.mock('node-pty', () => ({
  spawn: vi.fn(),
}));

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(),
  },
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const mocked = {
    ...actual,
    existsSync: vi.fn(),
    promises: {
      mkdir: vi.fn(),
      stat: vi.fn(),
      readFile: vi.fn(),
      access: vi.fn(),
    },
    watch: vi.fn(),
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue('/mock/home'),
  };
});

vi.mock('../config/paths', () => ({
  CLI_PATH: '/mock/cli/path',
}));

// Mock settings
vi.mock('@google/gemini-cli/dist/src/config/settings.js', () => ({
  loadSettings: vi.fn().mockResolvedValue({
    merged: {},
  }),
}));

describe('PtyManager', () => {
  let ptyManager: PtyManager;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockMainWindow: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockPtyProcess: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockFileWatcher: any;

  beforeEach(() => {
    mockMainWindow = {
      webContents: {
        send: vi.fn(),
      },
      isDestroyed: vi.fn().mockReturnValue(false),
    };

    mockPtyProcess = {
      onExit: vi.fn(),
      onData: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      kill: vi.fn(),
      resize: vi.fn(),
      write: vi.fn(),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pty.spawn as any).mockReturnValue(mockPtyProcess);

    mockFileWatcher = {
      on: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (chokidar.watch as any).mockReturnValue(mockFileWatcher);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fs.existsSync as any).mockReturnValue(true);

    ptyManager = new PtyManager(mockMainWindow as unknown as BrowserWindow);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should start pty process', async () => {
    await ptyManager.start();
    expect(pty.spawn).toHaveBeenCalledWith(
      '/mock/cli/path',
      [],
      expect.objectContaining({
        name: 'xterm-color',
        cols: 80,
        rows: 30,
        cwd: expect.stringContaining('Documents'), // Default CWD
      }),
    );
    expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
      'terminal.reset',
    );
  });

  it('should handle pty data', async () => {
    await ptyManager.start();
    const onDataCallback = mockPtyProcess.onData.mock.calls[0][0];
    onDataCallback('test data');
    expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
      'terminal.incomingData',
      'test data',
    );
  });

  it('should resize pty', async () => {
    await ptyManager.start();
    ptyManager.resize(100, 50);
    expect(mockPtyProcess.resize).toHaveBeenCalledWith(100, 50);
  });

  it('should write to pty', async () => {
    await ptyManager.start();
    ptyManager.write('test input');
    expect(mockPtyProcess.write).toHaveBeenCalledWith('test input');
  });

  it('should dispose pty and file watcher', async () => {
    await ptyManager.start();
    await ptyManager.dispose();
    expect(mockPtyProcess.kill).toHaveBeenCalled();
    expect(mockFileWatcher.close).toHaveBeenCalled();
  });
});
