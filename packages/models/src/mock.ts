// SPDX-License-Identifier: Apache-2.0
import { WriterError, requireString, validateEdits, validateSnapshot } from '@writer-agent/core';
import type { ModelRequest, ModelResponse, ModelProvider } from './types.js';
export interface MockReplacement { readonly before: string; readonly after: string; readonly summary: string }

/** Scripted fixture, not an AI. No keys, network, learning or automatic tool execution. */
export class MockModelProvider implements ModelProvider {
  readonly id = 'mock/scripted-v1';
  private readonly replacements: readonly MockReplacement[];
  constructor(replacements: readonly MockReplacement[]) {
    this.replacements = structuredClone(replacements);
  }
  async propose(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse> {
    signal?.throwIfAborted();
    requireString(request.documentId, 'documentId');
    requireString(request.baseRevisionId, 'baseRevisionId');
    requireString(request.instruction, 'instruction', 10000);
    validateSnapshot(request.snapshot);
    const edits = this.replacements.map(replacement => {
      const matches = request.snapshot.blocks.filter(block => block.text === replacement.before);
      if (matches.length !== 1 || !matches[0]) {
        throw new WriterError('INVALID_INPUT', 'Mock replacement must match exactly one whole block; ambiguous matches are refused.');
      }
      return { blockId: matches[0].id, ...replacement };
    });
    validateEdits(edits);
    signal?.throwIfAborted();
    return { protocolVersion: 1, providerId: this.id, documentId: request.documentId, baseRevisionId: request.baseRevisionId, edits, notes: ['Scripted test response. No language model was called.'] };
  }
}
