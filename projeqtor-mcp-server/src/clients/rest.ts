import type { UpstreamConfig } from '../config.js';
import { ReadError } from '../domain/errors.js';
import type { Activity, RealActivityCreate } from '../domain/projects.js';
import { record, positiveId, optionalId, numeric } from '../domain/normalize.js';
import { BaseReadClient, type ClassName, type Selection } from './read.js';
import { encryptProjeqtorData } from './projeqtor-crypto.js';

function safeApiResultMessage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const message = value.replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
  return message || undefined;
}

export class RestReadClient extends BaseReadClient {
  readonly mode = 'real' as const;
  constructor(private readonly config: UpstreamConfig) { super(); }

  private authorization(): string {
    return `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`, 'utf8').toString('base64')}`;
  }

  private async requestRows(url: URL, init: RequestInit): Promise<unknown[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let response: Response | undefined;
    try {
      response = await fetch(url, { ...init, redirect: 'manual', signal: controller.signal,
        headers: { Accept: 'application/json', Authorization: this.authorization(), ...init.headers } });
      if (response.status >= 300 && response.status < 400) throw new ReadError('UPSTREAM_REDIRECT');
      if (!response.ok) throw new ReadError('UPSTREAM_HTTP_ERROR');
      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
      if (contentType && contentType !== 'application/json') throw new ReadError('UPSTREAM_INVALID_RESPONSE');
      const length = Number(response.headers.get('content-length'));
      if (Number.isFinite(length) && length > this.config.maxResponseBytes) throw new ReadError('UPSTREAM_RESPONSE_LIMIT');
      if (!response.body) throw new ReadError('UPSTREAM_INVALID_RESPONSE');
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > this.config.maxResponseBytes) throw new ReadError('UPSTREAM_RESPONSE_LIMIT');
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      let parsed: unknown;
      try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
      catch { throw new ReadError('UPSTREAM_INVALID_RESPONSE'); }
      const envelope = record(parsed);
      if (typeof envelope.error === 'string') {
        const upstreamMessage = safeApiResultMessage(envelope.message);
        throw new ReadError('UPSTREAM_API_ERROR', upstreamMessage ? { upstreamMessage } : undefined);
      }
      if (envelope.identifier !== 'id' || !Array.isArray(envelope.items) ||
        Object.keys(envelope).some(key => !['identifier', 'items'].includes(key))) throw new ReadError('UPSTREAM_INVALID_RESPONSE');
      return envelope.items;
    } catch (error) {
      if (controller.signal.aborted) throw new ReadError('UPSTREAM_TIMEOUT');
      if (error instanceof ReadError) throw error;
      throw new ReadError('UPSTREAM_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
    }
  }

  protected async readRows(className: ClassName, selection?: Selection): Promise<unknown[]> {
    if (!['Project', 'Activity', 'Resource', 'Assignment', 'ActivityType', 'Status'].includes(className)) throw new ReadError('INVALID_ARGUMENT');
    const selector = selection === undefined ? 'all' : 'id' in selection ? String(positiveId(selection.id)) :
      `search/idProject=${positiveId(selection.projectId)}`;
    return this.requestRows(new URL(`${className}/${selector}`, this.config.baseUrl), { method: 'GET' });
  }

  async createActivity(input: RealActivityCreate): Promise<Activity> {
    if (!this.config.apiKey || !this.config.aesKeyLength) throw new ReadError('REAL_WRITE_BLOCKED');
    const data = encryptProjeqtorData(JSON.stringify({ name: input.name, idProject: input.projectId,
      idActivityType: input.activityTypeId, idStatus: input.statusId,
      idActivityPlanningMode: input.activityPlanningModeId, creationDate: input.creationDate,
      ...(input.startDate === undefined ? {} : { initialStartDate: input.startDate }),
      ...(input.endDate === undefined ? {} : { initialEndDate: input.endDate }),
      description: input.description }), this.config.apiKey, this.config.aesKeyLength);
    const body = new URLSearchParams({ data });
    let rows: unknown[];
    try {
      rows = await this.requestRows(new URL('Activity', this.config.baseUrl), {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body
      });
    } catch (error) {
      // ProjeQtOr top-level API errors occur before the object transaction starts
      // (for example wrong API key/AES decryption), so a retry cannot duplicate a write.
      if (error instanceof ReadError && error.code === 'UPSTREAM_API_ERROR') {
        throw new ReadError('UPSTREAM_WRITE_REJECTED', error.details);
      }
      throw error;
    }
    if (rows.length !== 1) throw new ReadError('UPSTREAM_INVALID_RESPONSE');
    const row = record(rows[0]);
    if (row.apiResult !== 'OK') {
      const upstreamMessage = safeApiResultMessage(row.apiResultMessage);
      throw new ReadError('UPSTREAM_WRITE_REJECTED', upstreamMessage ? { upstreamMessage } : undefined);
    }
    const id = optionalId(row.id);
    if (id === null) throw new ReadError('UPSTREAM_INVALID_RESPONSE');
    // ProjeQtOr commits the transaction before emitting apiResult="OK" and
    // returns the refreshed object in the same response. That response is the
    // write acknowledgement; a second GET is not required to prove success.
    return {
      id,
      name: typeof row.name === 'string' ? row.name : input.name,
      description: typeof row.description === 'string' ? row.description : input.description,
      idProject: optionalId(row.idProject) ?? input.projectId,
      idStatus: optionalId(row.idStatus) ?? input.statusId,
      idResource: optionalId(row.idResource),
      idActivityType: optionalId(row.idActivityType) ?? input.activityTypeId,
      creationDate: typeof row.creationDate === 'string' ? row.creationDate : input.creationDate,
      startDate: typeof row.initialStartDate === 'string' ? row.initialStartDate : input.startDate ?? null,
      endDate: typeof row.initialEndDate === 'string' ? row.initialEndDate : input.endDate ?? null,
      plannedWork: numeric(row.plannedWork),
      realWork: numeric(row.realWork),
      leftWork: numeric(row.leftWork)
    };
  }

  async deleteActivity(activityId: number): Promise<void> {
    if (!this.config.apiKey || !this.config.aesKeyLength) throw new ReadError('REAL_DELETE_BLOCKED');
    const data = encryptProjeqtorData(JSON.stringify({ id: activityId }), this.config.apiKey, this.config.aesKeyLength);
    const body = new URLSearchParams({ data });
    let rows: unknown[];
    try {
      rows = await this.requestRows(new URL('Activity', this.config.baseUrl), {
        method: 'DELETE', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body
      });
    } catch (error) {
      if (error instanceof ReadError && error.code === 'UPSTREAM_API_ERROR') {
        throw new ReadError('UPSTREAM_DELETE_REJECTED', error.details);
      }
      throw error;
    }
    if (rows.length !== 1) throw new ReadError('UPSTREAM_INVALID_RESPONSE');
    const row = record(rows[0]);
    if (row.apiResult !== 'OK') {
      const upstreamMessage = safeApiResultMessage(row.apiResultMessage);
      throw new ReadError('UPSTREAM_DELETE_REJECTED', upstreamMessage ? { upstreamMessage } : undefined);
    }
  }
}
