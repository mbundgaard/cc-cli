import { Command, Option } from 'commander';
import { readFile } from 'node:fs/promises';
import { CatalogueStore, compareFields, contractKey, importSpecification, observeFields, releaseVersions, targetFor } from './catalogue.js';
import { StateStore, activeState, type State } from './state.js';
import { CliError, Exit, localResult } from './output.js';
import type { DeliveryObserver } from './responses.js';
import { readOperationById } from './configuration-policy.js';

export async function prepareLearning(directory: string, state: State, operation: string, apiVersion: string, projection = 'default'): Promise<DeliveryObserver> {
  const catalogue = new CatalogueStore(directory), target = targetFor(state);
  const contract = contractKey(operation, apiVersion), before = await catalogue.view(target);
  const establishesRelease = readOperationById(`${operation}:${apiVersion}`).catalogueRole === 'release';
  if (!establishesRelease && !before.environment) throw new CliError(Exit.state, 'Run cc server-version explicitly before record reads to establish the catalogue version');
  return async ({ delivery }) => {
    if (establishesRelease) {
      if (delivery.kind === 'file' && delivery.bytes > 16 * 1024) throw new Error('Unexpected version response size');
      const bytes = delivery.kind === 'inline' ? delivery.body : await readFile(delivery.path);
      await catalogue.detect(target, releaseVersions(JSON.parse(bytes.toString('utf8'))));
    }
    const view = establishesRelease ? await catalogue.view(target) : before;
    const fields = await observeFields(delivery, view.document?.contracts[contract]?.response);
    await catalogue.observe(target, view.environment!.current.id, contract, fields, projection, view.document?.sha256);
  };
}
export function registerCatalogue(root: Command, store: StateStore, definitions: readonly { id: string; paths: { v1?: string; v2?: string } }[]): void {
  const catalogue = new CatalogueStore(store.directory);
  const group = root.command('catalogue').description('[local] Versioned documented/observed field metadata; never record values or write permission');
  group.addHelpText('after', '\nAll catalogue commands stay offline. Import a locally supplied Swagger 2 file explicitly.\nOnly hardcoded implemented calls are imported; schemas never create executable endpoints.\nRun server-version explicitly to detect release changes and archive old observations.\nUnobserved is not absent. Null alone establishes no type. No writability is inferred.\n');
  group.command('import').description('[writes-state][local] Pin local Swagger field definitions and source SHA-256')
    .requiredOption('--file <path>', 'Public Oracle Swagger 2 specification, not credentials or data')
    .action(async options => {
      let source;
      try { source = await importSpecification(options.file, definitions); }
      catch { throw new CliError(Exit.usage, 'Cannot import this specification; no catalogue changes made. Expected local Swagger 2 with resolvable references.'); }
      await catalogue.import(source);
      localResult('catalogue import', { sha256: source.sha256, version: source.version, contracts: Object.keys(source.contracts), deploymentMatch: 'not-established' });
    });
  const view = async () => {
    const registry = await store.loadCompanies();
    return catalogue.view(registry.activeCompany ? targetFor(activeState(registry)) : undefined);
  };
  group.command('show').description('[read-only][local] Pinned documentation and active environment generations, including archives')
    .action(async () => localResult('catalogue show', await view()));
  for (const command of ['compare', 'changes']) {
    const item = group.command(`${command} <operation>`).description(command === 'compare' ? '[read-only][local] Documented versus observed fields' : '[read-only][local] Archived versus current observed fields; absence is not removal')
      .addOption(new Option('--api-version <version>', 'Contract version, never merged').choices(['v1', 'v2']).default('v2'))
      .option('--archive <id>', 'Exact archived generation ID from catalogue show');
    item.action(async (operation, options) => {
      if (!definitions.some(definition => definition.id === operation)) throw new CliError(Exit.usage, 'Unknown implemented read operation');
      const { document, environment } = await view(), key = contractKey(operation, options.apiVersion);
      const archive = options.archive ? environment?.archives.find(generation => generation.id === options.archive) : undefined;
      if (options.archive && !archive) throw new CliError(Exit.usage, 'Archive ID not found for this environment');
      if (command === 'changes' && !archive) throw new CliError(Exit.usage, 'changes requires an explicit --archive ID');
      const observation = (command === 'compare' ? archive ?? environment?.current : environment?.current)?.observations[key];
      const reference = command === 'compare' ? document?.contracts[key]?.response : archive?.observations[key]?.fields;
      localResult(`catalogue ${command}`, { contract: key, documentHash: document?.sha256, documentedDeploymentMatch: 'not-established',
        versions: environment?.current.versions, referenceAvailable: !!reference, observationAvailable: !!observation,
        ...compareFields(reference ?? {}, observation?.fields ?? {}), observation });
    });
  }
}
