import type { Mode, ReadClient } from '../domain/projects.js';
import { ReadError } from '../domain/errors.js';
import { activity, assignment, lookupValue, project, resource, record, positiveId, type Row } from '../domain/normalize.js';

export type ClassName = 'Project' | 'Activity' | 'Resource' | 'Assignment' | 'ActivityType' | 'Status';
export type Selection = { id: number } | { projectId: number };
export const MAX_COLLECTION_ROWS = 10_000;

export abstract class BaseReadClient implements ReadClient {
  abstract readonly mode: Mode;
  protected abstract readRows(className: ClassName, selection?: Selection): Promise<unknown[]>;

  private async rows<T extends { id: number }>(className: ClassName, normalize: (row: Row) => T, selection?: Selection): Promise<T[]> {
    const rows = await this.readRows(className, selection);
    if (rows.length > MAX_COLLECTION_ROWS) throw new ReadError('UPSTREAM_COLLECTION_LIMIT');
    const items = rows.map(row => normalize(record(row)));
    if (new Set(items.map(item => item.id)).size !== items.length) throw new ReadError('UPSTREAM_INVALID_RESPONSE');
    return items;
  }

  private page<T>(items: T[], limit: number, offset: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 100000) {
      throw new ReadError('INVALID_ARGUMENT');
    }
    return { mode: this.mode, total: items.length, limit, offset, truncated: offset + limit < items.length };
  }

  async listProjects(limit: number, offset: number) {
    const items = await this.rows('Project', project);
    return { ...this.page(items, limit, offset), projects: items.slice(offset, offset + limit) };
  }

  async getProject(id: number) {
    const items = await this.rows('Project', project, { id: positiveId(id) });
    if (items.length > 1 || items.some(item => item.id !== id)) throw new ReadError('UPSTREAM_INVALID_RESPONSE');
    return { mode: this.mode, project: items[0] ?? null };
  }

  async listActivities(limit: number, offset: number, projectId?: number) {
    const items = await this.readActivities(projectId);
    return { ...this.page(items, limit, offset), activities: items.slice(offset, offset + limit) };
  }

  async readActivities(projectId?: number) {
    const selection = projectId === undefined ? undefined : { projectId: positiveId(projectId) };
    const rows = await this.rows('Activity', activity, selection);
    return projectId === undefined ? rows : rows.filter(item => item.idProject === projectId);
  }

  async getActivity(id: number) {
    const items = await this.rows('Activity', activity, { id: positiveId(id) });
    if (items.length > 1 || items.some(item => item.id !== id)) throw new ReadError('UPSTREAM_INVALID_RESPONSE');
    return { mode: this.mode, activity: items[0] ?? null };
  }

  async listResources(limit: number, offset: number) {
    const items = await this.readResources();
    return { ...this.page(items, limit, offset), resources: items.slice(offset, offset + limit) };
  }

  async readResources() { return this.rows('Resource', resource); }

  async listAssignments(projectId?: number) {
    const rows = await this.rows('Assignment', assignment, projectId === undefined ? undefined : { projectId: positiveId(projectId) });
    return projectId === undefined ? rows : rows.filter(item => item.idProject === projectId);
  }

  async listActivityTypes(limit: number, offset: number) {
    const items = await this.rows('ActivityType', lookupValue);
    return { ...this.page(items, limit, offset), activityTypes: items.slice(offset, offset + limit) };
  }

  async listStatuses(limit: number, offset: number) {
    const items = await this.rows('Status', lookupValue);
    return { ...this.page(items, limit, offset), statuses: items.slice(offset, offset + limit) };
  }
}
