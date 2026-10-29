import { randomUUID } from 'node:crypto';
import { ReadError } from '../domain/errors.js';
import { isActivityDeleteClient, isActivityWriteClient, type Activity, type ReadClient } from '../domain/projects.js';
import { activityInputSchema, deleteActivityInputSchema, isRealActivityPayload, payloadHash,
  type ActivityOperation, type ActivityPayload } from '../domain/activity-write.js';
import { StateStore } from './state.js';

const IDEMPOTENCY_WINDOW_MS = 10 * 60_000;

export interface WorkflowOptions {
  readonly enableWrite: boolean;
  readonly enableRealWrite?: boolean;
  readonly stateDirectory: string;
}

export class ActivityWorkflow {
  readonly store: StateStore;

  constructor(private readonly client: ReadClient, private readonly options: WorkflowOptions, private readonly now = Date.now) {
    this.store = new StateStore(options.stateDirectory);
  }

  async createDirect(input: unknown) {
    if (!this.options.enableWrite) throw new ReadError('WRITE_DISABLED');
    if (this.client.mode === 'real' && (!this.options.enableRealWrite || !isActivityWriteClient(this.client))) {
      throw new ReadError('REAL_WRITE_BLOCKED');
    }

    const checked = activityInputSchema.safeParse(input);
    if (!checked.success) throw new ReadError('INVALID_ARGUMENT');
    const { projectId, name, description, activityTypeId, statusId, creationDate, startDate, endDate } = checked.data;
    if (startDate !== undefined && endDate !== undefined && startDate > endDate) throw new ReadError('INVALID_ARGUMENT');
    const payload: ActivityPayload = { projectId, name, description: description ?? null,
      ...(activityTypeId === undefined ? {} : { activityTypeId }),
      ...(statusId === undefined ? {} : { statusId }),
      ...(this.client.mode === 'real' ? { activityPlanningModeId: checked.data.activityPlanningModeId ?? 1 } : {}),
      ...(creationDate === undefined ? {} : { creationDate }),
      ...(startDate === undefined ? {} : { startDate }),
      ...(endDate === undefined ? {} : { endDate }) };
    if (this.client.mode === 'real' && !isRealActivityPayload(payload)) throw new ReadError('INVALID_ARGUMENT');
    if (!(await this.client.getProject(projectId)).project) throw new ReadError('PROJECT_NOT_FOUND');

    if (this.client.mode === 'mock') return this.createMock(payload);
    if (!isRealActivityPayload(payload) || !isActivityWriteClient(this.client)) throw new ReadError('REAL_WRITE_BLOCKED');

    const hash = payloadHash('real', payload);
    const baselineActivityIds = (await this.client.readActivities(payload.projectId))
      .filter(item => matches(item, payload)).map(item => item.id);
    const createdAt = this.now();
    const candidate: ActivityOperation = { id: randomUUID(), mode: 'real', payload, payloadHash: hash,
      createdAt, status: 'submitting', baselineActivityIds, activityId: null };
    const operation = await this.store.update(state => {
      for (const [id, item] of Object.entries(state.operations)) {
        if (item.status === 'consumed' && item.createdAt < createdAt - IDEMPOTENCY_WINDOW_MS) delete state.operations[id];
      }
      const previous = Object.values(state.operations).find(item => item.mode === 'real' && item.payloadHash === hash);
      if (previous) return previous;
      if (Object.keys(state.operations).length >= 1000) throw new ReadError('STATE_LIMIT');
      state.operations[candidate.id] = candidate;
      return candidate;
    });

    if (operation.id !== candidate.id) return this.resolveExisting(operation, payload);

    try {
      const created = await this.client.createActivity(payload);
      await this.store.update(state => {
        const current = state.operations[operation.id];
        if (!current || current.status !== 'submitting' || current.payloadHash !== hash) throw new ReadError('STATE_INVALID');
        current.status = 'consumed';
        current.activityId = created.id;
      });
      return { mode: 'real' as const, activity: created, persisted: true, verified: true, operationId: operation.id };
    } catch (error) {
      if (error instanceof ReadError && error.code === 'UPSTREAM_WRITE_REJECTED') {
        await this.store.update(state => { delete state.operations[operation.id]; });
        throw error;
      }
      await this.store.update(state => {
        const current = state.operations[operation.id];
        if (current?.status === 'submitting') current.status = 'outcome_unknown';
      }).catch(() => {});
      const reason = error instanceof ReadError ? error.code : 'UPSTREAM_UNAVAILABLE';
      throw new ReadError('UPSTREAM_WRITE_UNCERTAIN', { operationId: operation.id, reason });
    }
  }

  async deleteDirect(input: unknown) {
    const checked = deleteActivityInputSchema.safeParse(input);
    if (!checked.success) throw new ReadError('INVALID_ARGUMENT');
    if (!this.options.enableWrite) throw new ReadError('DELETE_DISABLED');
    if (this.client.mode !== 'real' || !this.options.enableRealWrite || !isActivityDeleteClient(this.client)) {
      throw new ReadError('REAL_DELETE_BLOCKED');
    }

    const { activityId, confirmed } = checked.data;
    const activity = (await this.client.getActivity(activityId)).activity;
    if (!activity) throw new ReadError('ACTIVITY_NOT_FOUND');
    if (!confirmed) {
      return { mode: 'real' as const, confirmationRequired: true, activity,
        message: `Confirm deletion of Activity #${activity.id} (${activity.name}).`,
        confirmationArguments: { activityId, confirmed: true } };
    }

    try {
      await this.client.deleteActivity(activityId);
    } catch (error) {
      if (error instanceof ReadError && error.code === 'UPSTREAM_DELETE_REJECTED') throw error;
      const reason = error instanceof ReadError ? error.code : 'UPSTREAM_UNAVAILABLE';
      try {
        if (!(await this.client.getActivity(activityId)).activity) {
          return { mode: 'real' as const, activityId, name: activity.name,
            deleted: true, verified: true, reconciled: true };
        }
      } catch {
        // Preserve the original uncertain delete reason below.
      }
      throw new ReadError('UPSTREAM_DELETE_UNCERTAIN', { activityId: String(activityId), reason });
    }

    let remaining: Activity | null;
    try {
      remaining = (await this.client.getActivity(activityId)).activity;
    } catch (error) {
      const reason = error instanceof ReadError ? error.code : 'UPSTREAM_UNAVAILABLE';
      throw new ReadError('UPSTREAM_DELETE_UNCERTAIN', { activityId: String(activityId), reason });
    }
    if (remaining) throw new ReadError('UPSTREAM_DELETE_NOT_VERIFIED', { activityId: String(activityId) });
    return { mode: 'real' as const, activityId, name: activity.name, deleted: true, verified: true };
  }

  private async resolveExisting(operation: ActivityOperation, payload: ActivityPayload) {
    if (operation.status === 'consumed' && operation.activityId !== null) {
      const existing = (await this.client.getActivity(operation.activityId)).activity;
      if (matches(existing, payload)) {
        return { mode: 'real' as const, activity: existing, persisted: true, verified: true,
          deduplicated: true, operationId: operation.id };
      }
      throw new ReadError('OPERATION_OUTCOME_UNKNOWN', { operationId: operation.id });
    }

    if (operation.status === 'submitting' || operation.baselineActivityIds === null) {
      throw new ReadError('OPERATION_OUTCOME_UNKNOWN', { operationId: operation.id });
    }

    // A later identical request can reconcile an earlier uncertain response when
    // exactly one matching Activity appeared after the original pre-submit snapshot.
    const baseline = new Set(operation.baselineActivityIds);
    const matchesFound = (await this.client.readActivities(payload.projectId))
      .filter(item => !baseline.has(item.id) && matches(item, payload));
    if (matchesFound.length === 1) {
      const activity = matchesFound[0]!;
      await this.store.update(state => {
        const current = state.operations[operation.id];
        if (!current || current.payloadHash !== operation.payloadHash) throw new ReadError('STATE_INVALID');
        current.status = 'consumed';
        current.activityId = activity.id;
      });
      return { mode: 'real' as const, activity, persisted: true, verified: true,
        deduplicated: true, reconciled: true, operationId: operation.id };
    }
    throw new ReadError('OPERATION_OUTCOME_UNKNOWN', { operationId: operation.id });
  }

  private async createMock(payload: ActivityPayload) {
    const fixtureActivities = await this.client.readActivities();
    const initialId = Math.max(999_999, ...fixtureActivities.map(item => item.id));
    return this.store.update(state => {
      const activityId = Math.max(initialId, ...state.activities.map(item => item.id)) + 1;
      if (!Number.isSafeInteger(activityId) || state.activities.length >= 1000) throw new ReadError('STATE_LIMIT');
      const activity = { id: activityId, name: payload.name, description: payload.description,
        idProject: payload.projectId, idStatus: payload.statusId ?? null, idResource: null,
        idActivityType: payload.activityTypeId ?? null,
        creationDate: payload.creationDate ?? new Date(this.now()).toISOString(),
        startDate: payload.startDate ?? null, endDate: payload.endDate ?? null,
        plannedWork: null, realWork: null, leftWork: null };
      state.activities.push(activity);
      return { mode: 'mock' as const, activity, persisted: true };
    });
  }
}

function matches(activity: Activity | null, payload: ActivityPayload): activity is Activity {
  return activity !== null && activity.idProject === payload.projectId && activity.name === payload.name &&
    activity.idActivityType === payload.activityTypeId && activity.idStatus === payload.statusId &&
    activity.creationDate?.slice(0, 10) === payload.creationDate &&
    (payload.startDate === undefined || activity.startDate?.slice(0, 10) === payload.startDate) &&
    (payload.endDate === undefined || activity.endDate?.slice(0, 10) === payload.endDate);
}
