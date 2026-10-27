import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { privateSubdirectory, persistPrivateJson } from './private-files.js';
import { type CaptureReference } from './captures.js';
import { requireConfigurationOperation, type ConfigurationEffect } from './configuration-policy.js';
import { type HttpRequest } from './transport.js';

export interface MutationAttempt {
  readonly path: string;
  readonly manifest: Readonly<Record<string, unknown>>;
}
// Created by the guarded lifecycle before approval consumption; never saves tokens,
// cookies or arbitrary request headers. Exact proposed bytes are in the capture.
export async function prepareMutationAttempt(directory: string, input: HttpRequest,
  action: Exclude<ConfigurationEffect, 'read'>, company: string, approvalId: string,
  preparedCapture: CaptureReference, executionCapture: CaptureReference): Promise<MutationAttempt> {
  const operation = requireConfigurationOperation(input, action);
  const attemptId = randomUUID();
  const folder = await privateSubdirectory(directory, ['write-attempts', attemptId], true);
  const file = path.join(folder, 'manifest.json');
  const manifest = Object.freeze({schemaVersion: 1, product: 'cc-mutation-attempt', attemptId,
    operationId: operation.id, action, company, approvalId, preparedCapture, executionCapture,
    preparedAt: new Date().toISOString(), status: 'prepared', method: input.method, url: input.url,
    auditReference: input.headers?.['Simphony-AuditTrailRef']});
  await persistPrivateJson(file, manifest);
  return {path: file, manifest};
}
export async function recordMutationOutcome(attempt: MutationAttempt, status: 'dispatching' | 'http-response' | 'uncertain',
  outcome: {httpStatus?: number; responsePath?: string; responseSha256?: string} = {}): Promise<void> {
  await persistPrivateJson(attempt.path, {...attempt.manifest, status, updatedAt: new Date().toISOString(), ...outcome,
    savedStateVerified: false});
}
