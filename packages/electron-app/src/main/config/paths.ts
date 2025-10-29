/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import { join } from 'node:path';
import process from 'node:process';

export const isPackaged = app.isPackaged;

export const ICON_PATH = isPackaged
  ? join(process.resourcesPath, 'resources', 'icon.png')
  : join(__dirname, '..', '..', 'src', 'resources', 'icon.png');

// TODO: Ensure 'bundle' is copied to resources in package.json for production build.
export const CLI_PATH = isPackaged
  ? join(process.resourcesPath, 'bundle', 'gemini.js')
  : join(__dirname, '..', '..', '..', '..', 'bundle', 'gemini.js');

export const PRELOAD_PATH = join(__dirname, '../preload/index.cjs');

export const RENDERER_INDEX_PATH = join(__dirname, '../renderer/index.html');
