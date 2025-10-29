/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Turn, GeminiEventType, type ServerGeminiStreamEvent } from './turn.js';
import {
  GeminiChat,
  InvalidStreamError,
  StreamEventType,
} from './geminiChat.js';
import type { GenerateContentResponse } from '@google/genai';
import { UnauthorizedError } from '../utils/errors.js';
import type { Config } from '../config/config.js';

// Mock dependencies
vi.mock('./geminiChat.js');
vi.mock('../utils/errorReporting.js', () => ({
  reportError: vi.fn(),
}));

describe('Turn', () => {
  let mockChat: GeminiChat;
  let turn: Turn;
  const promptId = 'test-prompt-id';

  beforeEach(() => {
    mockChat = new GeminiChat({} as Config);
    mockChat.getHistory = vi.fn().mockReturnValue([]);
    mockChat.sendMessageStream = vi.fn();
    turn = new Turn(mockChat, promptId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize pendingToolCalls and debugResponses as empty arrays', () => {
      expect(turn.pendingToolCalls).toEqual([]);
      expect(turn.getDebugResponses()).toEqual([]);
    });
  });

  describe('run', () => {
    it('should yield content events for text parts', async () => {
      const mockResponse = {
        candidates: [
          {
            content: { parts: [{ text: 'Hello world' }] },
          },
        ],
        responseId: 'trace-123',
      } as GenerateContentResponse;

      vi.mocked(mockChat.sendMessageStream).mockResolvedValue(
        (async function* () {
          yield { type: StreamEventType.CHUNK, value: mockResponse };
        })(),
      );

      const events: ServerGeminiStreamEvent[] = [];
      for await (const event of turn.run(
        'model',
        'hi',
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events).toContainEqual({
        type: GeminiEventType.Content,
        value: 'Hello world',
        traceId: 'trace-123',
      });
      expect(turn.getDebugResponses()).toContain(mockResponse);
    });

    it('should yield tool_call_request events for function calls', async () => {
      const mockResponse = {
        functionCalls: [
          { name: 'test_tool', args: { foo: 'bar' }, id: 'call-1' },
        ],
      } as unknown as GenerateContentResponse;

      vi.mocked(mockChat.sendMessageStream).mockResolvedValue(
        (async function* () {
          yield { type: StreamEventType.CHUNK, value: mockResponse };
        })(),
      );

      const events: ServerGeminiStreamEvent[] = [];
      for await (const event of turn.run(
        'model',
        'call tool',
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events).toContainEqual({
        type: GeminiEventType.ToolCallRequest,
        value: {
          callId: 'call-1',
          name: 'test_tool',
          args: { foo: 'bar' },
          isClientInitiated: false,
          prompt_id: promptId,
        },
      });
      expect(turn.pendingToolCalls).toHaveLength(1);
    });

    it('should yield UserCancelled event if signal is aborted', async () => {
      const controller = new AbortController();
      vi.mocked(mockChat.sendMessageStream).mockResolvedValue(
        (async function* () {
          controller.abort();
          yield {
            type: StreamEventType.CHUNK,
            value: {} as GenerateContentResponse,
          };
        })(),
      );

      const events: ServerGeminiStreamEvent[] = [];
      for await (const event of turn.run('model', 'hi', controller.signal)) {
        events.push(event);
      }

      expect(events).toEqual([{ type: GeminiEventType.UserCancelled }]);
    });

    it('should yield InvalidStream event if sendMessageStream throws InvalidStreamError', async () => {
      vi.mocked(mockChat.sendMessageStream).mockRejectedValue(
        new InvalidStreamError('test', 'NO_FINISH_REASON'),
      );

      const events: ServerGeminiStreamEvent[] = [];
      for await (const event of turn.run(
        'model',
        'hi',
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events).toEqual([{ type: GeminiEventType.InvalidStream }]);
    });

    it('should yield Error event and report if sendMessageStream throws other errors', async () => {
      const error = new Error('Something went wrong');
      vi.mocked(mockChat.sendMessageStream).mockRejectedValue(error);
      vi.mocked(mockChat.getHistory).mockReturnValue([]);

      const events: ServerGeminiStreamEvent[] = [];
      for await (const event of turn.run(
        'model',
        'hi',
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events).toEqual([
        {
          type: GeminiEventType.Error,
          value: {
            error: {
              message: 'Something went wrong',
              status: undefined,
            },
          },
        },
      ]);
    });

    it('should handle function calls with undefined name or args', async () => {
      const mockResponse = {
        functionCalls: [{ id: 'call-2' }], // Missing name and args
      } as GenerateContentResponse;

      vi.mocked(mockChat.sendMessageStream).mockResolvedValue(
        (async function* () {
          yield { type: StreamEventType.CHUNK, value: mockResponse };
        })(),
      );

      const events: ServerGeminiStreamEvent[] = [];
      for await (const event of turn.run(
        'model',
        'call tool',
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events).toContainEqual({
        type: GeminiEventType.ToolCallRequest,
        value: {
          callId: 'call-2',
          name: 'undefined_tool_name',
          args: {},
          isClientInitiated: false,
          prompt_id: promptId,
        },
      });
    });

    it('should yield finished event when response has finish reason', async () => {
      const mockResponse = {
        candidates: [
          {
            content: { parts: [{ text: 'Partial response' }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 17,
          candidatesTokenCount: 50,
          totalTokenCount: 67,
          cachedContentTokenCount: 10,
          thoughtsTokenCount: 5,
          toolUsePromptTokenCount: 2,
        },
      } as GenerateContentResponse;

      vi.mocked(mockChat.sendMessageStream).mockResolvedValue(
        (async function* () {
          yield { type: StreamEventType.CHUNK, value: mockResponse };
        })(),
      );

      const events: ServerGeminiStreamEvent[] = [];
      for await (const event of turn.run(
        'model',
        'hi',
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events).toEqual([
        {
          traceId: undefined,
          type: 'content',
          value: 'Partial response',
        },
        {
          type: 'finished',
          value: {
            reason: 'STOP',
            usageMetadata: {
              cachedContentTokenCount: 10,
              candidatesTokenCount: 50,
              promptTokenCount: 17,
              thoughtsTokenCount: 5,
              toolUsePromptTokenCount: 2,
              totalTokenCount: 67,
            },
          },
        },
      ]);
      expect(turn.finishReason).toBe('STOP');
    });

    it('should yield finished event for MAX_TOKENS finish reason', async () => {
      const mockResponse = {
        candidates: [
          {
            content: { parts: [{ text: 'Truncated response' }] },
            finishReason: 'MAX_TOKENS',
          },
        ],
      } as GenerateContentResponse;

      vi.mocked(mockChat.sendMessageStream).mockResolvedValue(
        (async function* () {
          yield { type: StreamEventType.CHUNK, value: mockResponse };
        })(),
      );

      const events: ServerGeminiStreamEvent[] = [];
      for await (const event of turn.run(
        'model',
        'hi',
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events).toContainEqual({
        type: GeminiEventType.Finished,
        value: {
          reason: 'MAX_TOKENS',
          usageMetadata: undefined,
        },
      });
      expect(turn.finishReason).toBe('MAX_TOKENS');
    });

    it('should yield finished event for SAFETY finish reason', async () => {
      const mockResponse = {
        candidates: [
          {
            finishReason: 'SAFETY',
          },
        ],
      } as GenerateContentResponse;

      vi.mocked(mockChat.sendMessageStream).mockResolvedValue(
        (async function* () {
          yield { type: StreamEventType.CHUNK, value: mockResponse };
        })(),
      );

      const events: ServerGeminiStreamEvent[] = [];
      for await (const event of turn.run(
        'model',
        'hi',
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events).toContainEqual({
        type: GeminiEventType.Finished,
        value: {
          reason: 'SAFETY',
          usageMetadata: undefined,
        },
      });
      expect(turn.finishReason).toBe('SAFETY');
    });

    it('should yield finished event with undefined reason when no finish reason is present', async () => {
      const mockResponse = {
        candidates: [
          {
            content: { parts: [{ text: 'Ongoing response' }] },
            // No finishReason
          },
        ],
      } as GenerateContentResponse;

      vi.mocked(mockChat.sendMessageStream).mockResolvedValue(
        (async function* () {
          yield { type: StreamEventType.CHUNK, value: mockResponse };
        })(),
      );

      const events: ServerGeminiStreamEvent[] = [];
      for await (const event of turn.run(
        'model',
        'hi',
        new AbortController().signal,
      )) {
        events.push(event);
      }

      // Should NOT yield a finished event
      expect(
        events.some((e) => e.type === GeminiEventType.Finished),
      ).toBeFalsy();
      expect(turn.finishReason).toBeUndefined();
    });

    it('should handle multiple responses with different finish reasons', async () => {
      const mockResponse1 = {
        candidates: [
          {
            content: { parts: [{ text: 'Part 1' }] },
            // No finishReason
          },
        ],
      } as GenerateContentResponse;

      const mockResponse2 = {
        candidates: [
          {
            content: { parts: [{ text: 'Part 2' }] },
            finishReason: 'STOP',
          },
        ],
      } as GenerateContentResponse;

      vi.mocked(mockChat.sendMessageStream).mockResolvedValue(
        (async function* () {
          yield { type: StreamEventType.CHUNK, value: mockResponse1 };
          yield { type: StreamEventType.CHUNK, value: mockResponse2 };
        })(),
      );

      const events: ServerGeminiStreamEvent[] = [];
      for await (const event of turn.run(
        'model',
        'hi',
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events).toContainEqual({
        type: GeminiEventType.Content,
        value: 'Part 1',
        traceId: undefined,
      });
      expect(events).toContainEqual({
        type: GeminiEventType.Content,
        value: 'Part 2',
        traceId: undefined,
      });
      expect(events).toContainEqual({
        type: GeminiEventType.Finished,
        value: {
          reason: 'STOP',
          usageMetadata: undefined,
        },
      });
      expect(turn.finishReason).toBe('STOP');
    });

    it('should yield citation and finished events when response has citations and finish reason', async () => {
      const mockResponse = {
        candidates: [
          {
            content: { parts: [{ text: 'Response with citation' }] },
            finishReason: 'STOP',
            citationMetadata: {
              citations: [
                {
                  uri: 'https://example.com',
                  title: 'Example',
                },
              ],
            },
          },
        ],
      } as GenerateContentResponse;

      vi.mocked(mockChat.sendMessageStream).mockResolvedValue(
        (async function* () {
          yield { type: StreamEventType.CHUNK, value: mockResponse };
        })(),
      );

      const events: ServerGeminiStreamEvent[] = [];
      for await (const event of turn.run(
        'model',
        'hi',
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events).toContainEqual({
        type: GeminiEventType.Citation,
        value: 'Citations:\n(Example) https://example.com',
      });
      expect(events).toContainEqual({
        type: GeminiEventType.Finished,
        value: {
          reason: 'STOP',
          usageMetadata: undefined,
        },
      });
    });

    it('should yield a single citation event for multiple citations across chunks', async () => {
      const mockResponse1 = {
        candidates: [
          {
            content: { parts: [{ text: 'Part 1' }] },
            citationMetadata: {
              citations: [{ uri: 'https://example.com/1' }],
            },
          },
        ],
      } as GenerateContentResponse;

      const mockResponse2 = {
        candidates: [
          {
            content: { parts: [{ text: 'Part 2' }] },
            finishReason: 'STOP',
            citationMetadata: {
              citations: [{ uri: 'https://example.com/2' }],
            },
          },
        ],
      } as GenerateContentResponse;

      vi.mocked(mockChat.sendMessageStream).mockResolvedValue(
        (async function* () {
          yield { type: StreamEventType.CHUNK, value: mockResponse1 };
          yield { type: StreamEventType.CHUNK, value: mockResponse2 };
        })(),
      );

      const events: ServerGeminiStreamEvent[] = [];
      for await (const event of turn.run(
        'model',
        'hi',
        new AbortController().signal,
      )) {
        events.push(event);
      }

      // Citations are sorted
      expect(events).toContainEqual({
        type: GeminiEventType.Citation,
        value: 'Citations:\nhttps://example.com/1\nhttps://example.com/2',
      });
    });

    it('should not yield citation event if there is no finish reason', async () => {
      const mockResponse = {
        candidates: [
          {
            content: { parts: [{ text: 'Response with citation' }] },
            // No finishReason
            citationMetadata: {
              citations: [{ uri: 'https://example.com' }],
            },
          },
        ],
      } as GenerateContentResponse;

      vi.mocked(mockChat.sendMessageStream).mockResolvedValue(
        (async function* () {
          yield { type: StreamEventType.CHUNK, value: mockResponse };
        })(),
      );

      const events: ServerGeminiStreamEvent[] = [];
      for await (const event of turn.run(
        'model',
        'hi',
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(
        events.some((e) => e.type === GeminiEventType.Citation),
      ).toBeFalsy();
    });

    it('should ignore citations without a URI', async () => {
      const mockResponse = {
        candidates: [
          {
            finishReason: 'STOP',
            citationMetadata: {
              citations: [{ title: 'No URI' }],
            },
          },
        ],
      } as GenerateContentResponse;

      vi.mocked(mockChat.sendMessageStream).mockResolvedValue(
        (async function* () {
          yield { type: StreamEventType.CHUNK, value: mockResponse };
        })(),
      );

      const events: ServerGeminiStreamEvent[] = [];
      for await (const event of turn.run(
        'model',
        'hi',
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(
        events.some((e) => e.type === GeminiEventType.Citation),
      ).toBeFalsy();
    });

    it('should not crash when cancelled request has malformed error', async () => {
      const error = {
        // Error object without message property
        code: 123,
      };
      vi.mocked(mockChat.sendMessageStream).mockRejectedValue(error);
      vi.mocked(mockChat.getHistory).mockReturnValue([]);

      const events: ServerGeminiStreamEvent[] = [];
      for await (const event of turn.run(
        'model',
        'hi',
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events).toEqual([
        {
          type: GeminiEventType.Error,
          value: {
            error: {
              message: '[object Object]',
              status: undefined,
            },
          },
        },
      ]);
    });

    it('should yield a Retry event when it receives one from sendMessageStream', async () => {
      vi.mocked(mockChat.sendMessageStream).mockResolvedValue(
        (async function* () {
          yield { type: StreamEventType.RETRY };
        })(),
      );

      const events: ServerGeminiStreamEvent[] = [];
      for await (const event of turn.run(
        'model',
        'hi',
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events).toEqual([{ type: GeminiEventType.Retry }]);
    });

    it('should yield content events with traceId', async () => {
      const mockResponse = {
        candidates: [
          {
            content: { parts: [{ text: 'Hello world' }] },
          },
        ],
        responseId: 'trace-123',
      } as GenerateContentResponse;

      vi.mocked(mockChat.sendMessageStream).mockResolvedValue(
        (async function* () {
          yield { type: StreamEventType.CHUNK, value: mockResponse };
        })(),
      );

      const events: ServerGeminiStreamEvent[] = [];
      for await (const event of turn.run(
        'model',
        'hi',
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events).toContainEqual({
        type: GeminiEventType.Content,
        value: 'Hello world',
        traceId: 'trace-123',
      });
    });

    it('should yield thought events with traceId', async () => {
      const mockResponse = {
        candidates: [
          {
            content: { parts: [{ thought: true, text: 'Thinking...' }] },
          },
        ],
        responseId: 'trace-123',
      } as GenerateContentResponse;

      vi.mocked(mockChat.sendMessageStream).mockResolvedValue(
        (async function* () {
          yield { type: StreamEventType.CHUNK, value: mockResponse };
        })(),
      );

      const events: ServerGeminiStreamEvent[] = [];
      for await (const event of turn.run(
        'model',
        'hi',
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events).toContainEqual({
        type: GeminiEventType.Thought,
        value: expect.anything(), // We don't need to test parseThought here
        traceId: 'trace-123',
      });
    });

    it('should throw UnauthorizedError if sendMessageStream throws it', async () => {
      const error = new UnauthorizedError('Unauthorized');
      vi.mocked(mockChat.sendMessageStream).mockRejectedValue(error);

      await expect(async () => {
        for await (const _ of turn.run(
          'model',
          'hi',
          new AbortController().signal,
        )) {
          // consume
        }
      }).rejects.toThrow(UnauthorizedError);
    });

    it('should throw UnauthorizedError if sendMessageStream throws ApiError with 401', async () => {
      const error = {
        response: {
          data: {
            error: {
              code: 401,
              message: 'Unauthorized',
            },
          },
        },
      };
      vi.mocked(mockChat.sendMessageStream).mockRejectedValue(error);

      await expect(async () => {
        for await (const _ of turn.run(
          'model',
          'hi',
          new AbortController().signal,
        )) {
          // consume
        }
      }).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('getDebugResponses', () => {
    it('should return collected debug responses', async () => {
      const mockResponse = {
        candidates: [],
      } as unknown as GenerateContentResponse;

      vi.mocked(mockChat.sendMessageStream).mockResolvedValue(
        (async function* () {
          yield { type: StreamEventType.CHUNK, value: mockResponse };
        })(),
      );

      for await (const _ of turn.run(
        'model',
        'hi',
        new AbortController().signal,
      )) {
        // consume
      }

      expect(turn.getDebugResponses()).toEqual([mockResponse]);
    });
  });
});
