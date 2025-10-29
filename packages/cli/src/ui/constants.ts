/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const SHELL_COMMAND_NAME = 'Shell Command';

export const SHELL_NAME = 'Shell';

// Tool status symbols used in ToolMessage component
export const TOOL_STATUS = {
  SUCCESS: '✓',
  PENDING: 'o',
  EXECUTING: '⊷',
  CONFIRMING: '?',
  CANCELED: '-',
  ERROR: 'x',
} as const;
