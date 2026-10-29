import { readFile } from 'node:fs/promises';
import { BaseReadClient, type ClassName, type Selection } from './read.js';
import { optionalId, record } from '../domain/normalize.js';
import { ReadError } from '../domain/errors.js';
import { StateStore } from '../services/state.js';

const files = { Project: 'projects', Activity: 'activities', Resource: 'resources', Assignment: 'assignments',
  ActivityType: 'activity-types', Status: 'statuses' } as const;

export class MockProjectClient extends BaseReadClient {
  readonly mode = 'mock' as const;
  constructor(private readonly stateDirectory?: string) { super(); }
  protected async readRows(className: ClassName, selection?: Selection): Promise<unknown[]> {
    try {
      const rows: unknown = JSON.parse(await readFile(new URL(`../../fixtures/${files[className]}.json`, import.meta.url), 'utf8'));
      if (!Array.isArray(rows)) throw new Error();
      if (className === 'Activity' && this.stateDirectory) rows.push(...(await new StateStore(this.stateDirectory).read()).activities);
      return selection === undefined ? rows : rows.filter(value => {
        const row = record(value);
        return 'id' in selection ? optionalId(row.id) === selection.id : optionalId(row.idProject) === selection.projectId;
      });
    } catch (error) {
      if (error instanceof ReadError) throw error;
      throw new ReadError('MOCK_DATA_ERROR');
    }
  }
}
