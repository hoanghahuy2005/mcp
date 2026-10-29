import type { Activity, Assignment, LookupValue, Project, Resource } from './projects.js';
import { ReadError } from './errors.js';

export function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return null;
  const number = Number(value.trim());
  return Number.isFinite(number) ? number : null;
}

export function optionalId(value: unknown): number | null {
  const number = numeric(value);
  return number !== null && Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function positiveId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new ReadError('INVALID_ARGUMENT');
  return value;
}

const text = (value: unknown): string | null => typeof value === 'string' ? value : null;
const name = (value: unknown): string => {
  if (typeof value !== 'string') throw new ReadError('UPSTREAM_INVALID_RESPONSE');
  return value;
};

export type Row = Record<string, unknown>;
export function record(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ReadError('UPSTREAM_INVALID_RESPONSE');
  return value as Row;
}
function id(row: Row): number {
  const value = optionalId(row.id);
  if (value === null) throw new ReadError('UPSTREAM_INVALID_RESPONSE');
  return value;
}

export const project = (row: Row): Project => ({ id: id(row), name: name(row.name), description: text(row.description), idStatus: optionalId(row.idStatus) });
export const activity = (row: Row): Activity => ({ id: id(row), name: name(row.name), description: text(row.description),
  idProject: optionalId(row.idProject), idStatus: optionalId(row.idStatus), idResource: optionalId(row.idResource),
  idActivityType: optionalId(row.idActivityType), creationDate: text(row.creationDate),
  startDate: text(row.initialStartDate) ?? text(row.startDate), endDate: text(row.initialEndDate) ?? text(row.endDate),
  plannedWork: numeric(row.plannedWork), realWork: numeric(row.realWork), leftWork: numeric(row.leftWork) });
export const resource = (row: Row): Resource => ({ id: id(row), name: text(row.name) });
export const lookupValue = (row: Row): LookupValue => ({ id: id(row), name: name(row.name) });
export const assignment = (row: Row): Assignment => ({ id: id(row), idProject: optionalId(row.idProject), refType: text(row.refType),
  refId: optionalId(row.refId), idResource: optionalId(row.idResource),
  plannedWork: numeric(row.plannedWork), realWork: numeric(row.realWork), leftWork: numeric(row.leftWork) });
