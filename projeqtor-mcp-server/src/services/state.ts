import { mkdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { ReadError } from '../domain/errors.js';
import { legacyStateSchema, operationSchema, payloadHash, stateSchema, type ActivityState } from '../domain/activity-write.js';

const MAX_STATE_BYTES = 16_777_216;
export class StateStore {
  readonly directory: string;
  constructor(directory: string) { this.directory = resolve(directory); }

  async read(): Promise<ActivityState> {
    const path = join(this.directory, 'state.json');
    for (let attempt = 0; ; attempt++) {
      try {
        if ((await stat(path)).size > MAX_STATE_BYTES) throw new ReadError('STATE_LIMIT');
        const raw: unknown = JSON.parse(await readFile(path, 'utf8'));
        const current = stateSchema.safeParse(raw);
        const state = current.success ? current.data : migrateLegacyState(raw);
        for (const [id, operation] of Object.entries(state.operations)) {
          if (operation.id !== id || operation.payloadHash !== payloadHash(operation.mode, operation.payload) ||
            (operation.status === 'consumed') !== (operation.activityId !== null)) throw new ReadError('STATE_INVALID');
        }
        if (new Set(state.activities.map(item => item.id)).size !== state.activities.length) throw new ReadError('STATE_INVALID');
        return state;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // Windows can briefly deny readers while another process atomically
        // replaces state.json. Retry only those transient filesystem errors;
        // malformed or missing state still fails/initializes deterministically.
        if (attempt < 20 && (code === 'EACCES' || code === 'EBUSY' || code === 'EPERM')) { await pause(10); continue; }
        if (code === 'ENOENT') return { version: 2, operations: {}, activities: [] };
        if (error instanceof ReadError) throw error;
        if (error instanceof SyntaxError) throw new ReadError('STATE_INVALID');
        throw new ReadError('STATE_UNAVAILABLE');
      }
    }
  }

  // mkdir serializes across processes. One atomic replacement commits both the
  // mock activity and consumed approval, so a crash cannot commit only one.
  // A lock left by a killed process is deliberately never stolen automatically.
  async update<T>(change: (state: ActivityState) => T): Promise<T> {
    const lockPath = join(this.directory, '.lock');
    let locked = false;
    let temporary: string | undefined;
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const deadline = Date.now() + 5000;
      while (!locked) {
        try { await mkdir(lockPath, { mode: 0o700 }); locked = true; }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          if (Date.now() >= deadline) throw new ReadError('STATE_BUSY');
          await pause(20);
        }
      }
      const state = await this.read();
      const result = change(state);
      if (!stateSchema.safeParse(state).success) throw new ReadError('STATE_LIMIT');
      const json = JSON.stringify(state);
      if (Buffer.byteLength(json) > MAX_STATE_BYTES) throw new ReadError('STATE_LIMIT');
      temporary = join(this.directory, `.state-${randomUUID()}.tmp`);
      await writeFile(temporary, json, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      const destination = join(this.directory, 'state.json');
      for (let attempt = 0; ; attempt++) {
        try { await rename(temporary, destination); break; }
        catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          // A concurrent Windows reader may briefly prevent replacement even
          // though the lock correctly serializes writers. Retrying the same
          // completed temp file preserves the atomic commit contract.
          if (attempt < 50 && (code === 'EACCES' || code === 'EBUSY' || code === 'EPERM')) { await pause(10); continue; }
          throw error;
        }
      }
      temporary = undefined;
      return result;
    } catch (error) {
      if (error instanceof ReadError) throw error;
      throw new ReadError('STATE_UNAVAILABLE');
    } finally {
      if (temporary) await rm(temporary, { force: true }).catch(() => {});
      if (locked) await rmdir(lockPath).catch(() => {});
    }
  }
}

function migrateLegacyState(raw: unknown): ActivityState {
  const legacy = legacyStateSchema.safeParse(raw);
  if (!legacy.success) throw new ReadError('STATE_INVALID');
  const operations: ActivityState['operations'] = {};
  for (const old of Object.values(legacy.data.proposals)) {
    // Pending and approved records represented the removed approval workflow and
    // are intentionally discarded. In-flight records are retained conservatively
    // so a restart cannot cause an uncertain real write to be submitted twice.
    if (old.mode !== 'real' || !['submitting', 'outcome_unknown', 'consumed'].includes(old.status)) continue;
    const operation = {
      id: old.id,
      mode: old.mode,
      payload: old.payload,
      payloadHash: payloadHash(old.mode, old.payload),
      createdAt: old.createdAt,
      status: old.status === 'consumed' ? 'consumed' as const : 'outcome_unknown' as const,
      baselineActivityIds: null,
      activityId: old.status === 'consumed' ? old.consumedActivityId : null
    };
    if (!operationSchema.safeParse(operation).success || operation.payloadHash !== payloadHash(operation.mode, operation.payload)) {
      throw new ReadError('STATE_INVALID');
    }
    operations[operation.id] = operation;
  }
  return { version: 2, operations, activities: legacy.data.activities };
}
