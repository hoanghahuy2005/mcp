import type { Config } from '../config.js';
import type { ReadClient } from '../domain/projects.js';
import { MockProjectClient } from './mock.js';
import { RestReadClient } from './rest.js';

export function createReadClient(config: Config): ReadClient {
  if (config.mode === 'mock') return new MockProjectClient(config.stateDirectory);
  if (!config.upstream) throw new Error('Real mode requires upstream configuration.');
  return new RestReadClient(config.upstream);
}
