import { captureResponse, validateReadCapture, type CaptureContext, type CaptureReceipt } from './captures.js';
import { ResponseCollector, type DeliveryObserver, type Delivery } from './responses.js';
import { configurationRequestInto, type ConfigurationWritePermit } from './configuration-policy.js';
import { recordMutationOutcome, type MutationAttempt } from './mutation-journal.js';
import { httpExit, type HttpRequest } from './transport.js';
import { CliError, Exit } from './output.js';

export type ConfigurationDispatch =
  | {kind: 'read'; capture: CaptureContext; proposed?: Record<string, unknown>}
  | {kind: 'write'; permit: ConfigurationWritePermit; attempt: MutationAttempt};
export interface ConfigurationResult {
  status: number; delivery: Extract<Delivery, {kind: 'file'}>; captured?: CaptureReceipt; attemptPath?: string;
}
// The only configuration network/response lifecycle, for public reads, ownership
// proofs, target reads and writes. No inline path, topic switch or capture bypass.
export async function exchangeConfiguration(input: HttpRequest, directory: string, dispatch: ConfigurationDispatch): Promise<ConfigurationResult> {
  if (!dispatch || (dispatch.kind !== 'read' && dispatch.kind !== 'write')) throw new CliError(Exit.usage, 'Configuration lifecycle context is required');
  if (dispatch.kind === 'read') validateReadCapture(input, dispatch.capture);
  else if (!dispatch.permit || !dispatch.attempt) throw new CliError(Exit.usage, 'Mutation permit and durable attempt are required');
  const collector = new ResponseCollector(directory, true), controller = new AbortController();
  const cancel = () => controller.abort(); process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal;
  let retained = false, dispatched = false;
  let delivery: Extract<Delivery, {kind: 'file'}> | undefined;
  try {
    signal.throwIfAborted();
    if (dispatch.kind === 'write') await recordMutationOutcome(dispatch.attempt, 'dispatching');
    dispatched = true;
    const response = await configurationRequestInto({...input, signal}, collector, dispatch.kind === 'write' ? dispatch.permit : undefined);
    const complete = await collector.complete();
    if (complete.kind !== 'file') throw new Error('Configuration delivery must be file-first');
    delivery = complete; retained = true;
    signal.throwIfAborted();
    let captured: CaptureReceipt | undefined;
    if (dispatch.kind === 'read' && response.status >= 200 && response.status < 300) {
      captured = await captureResponse(directory, delivery.path, dispatch.capture, dispatch.proposed);
    } else if (dispatch.kind === 'write') {
      await recordMutationOutcome(dispatch.attempt, 'http-response', {httpStatus: response.status, responsePath: delivery.path, responseSha256: delivery.sha256});
    }
    return {status: response.status, delivery, captured, ...(dispatch.kind === 'write' ? {attemptPath: dispatch.attempt.path} : {})};
  } catch (error) {
    let cleanupError: unknown;
    if (!retained) { try { await collector.discard(); } catch (failure) { cleanupError = failure; } }
    if (dispatch.kind === 'write' && dispatched) {
      await recordMutationOutcome(dispatch.attempt, 'uncertain', delivery ? {responsePath: delivery.path, responseSha256: delivery.sha256} : {}).catch(() => {});
      throw new CliError(Exit.state, 'CC write outcome may be uncertain. Do not blindly retry.', `Inspect durable attempt ${dispatch.attempt.path}. No retry or restoration performed.`);
    }
    if (cleanupError) throw cleanupError;
    if (error instanceof CliError) throw error;
    throw new CliError(Exit.network, 'CC configuration exchange failed or was cancelled; no retry performed');
  } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
export async function publishConfiguration(result: ConfigurationResult, operation: string, quiet = false, observer?: DeliveryObserver): Promise<number> {
  const {delivery, captured} = result;
  if (!quiet) process.stderr.write(`[cc ${operation}] HTTP ${result.status}\n`);
  const receipt = {delivery: 'file', path: delivery.path, uri: delivery.uri, bytes: delivery.bytes, lines: delivery.lines,
    sha256: delivery.sha256, httpStatus: result.status,
    ...(captured ? {captureId: captured.captureId, manifestPath: captured.manifestPath, historyStatus: captured.historyStatus, recordCount: captured.recordCount} : {}),
    ...(result.attemptPath ? {attemptPath: result.attemptPath, savedStateVerified: false} : {}),
    description: `Oracle CC response for ${operation}, saved verbatim.`,
    instructions: 'Inspect saved data selectively instead of loading it all into context. Keep it private; preserve evidence referenced by approvals.'};
  try { await new Promise<void>((resolve, reject) => process.stdout.write(JSON.stringify(receipt) + '\n', error => error ? reject(error) : resolve())); }
  catch { throw new CliError(Exit.state, result.attemptPath ? 'CC write outcome may be uncertain to the caller; inspect the saved response and attempt. Do not retry blindly.' : 'Cannot publish capture receipt', `Response retained at ${delivery.path}`); }
  if (observer && result.status >= 200 && result.status < 300) {
    try { await observer({status: result.status, delivery}); }
    catch { process.stderr.write('[cc catalogue] Metadata was not saved; response delivery and HTTP result are unchanged. Inspect the local catalogue before further learning.\n'); }
  }
  return httpExit(result.status);
}
