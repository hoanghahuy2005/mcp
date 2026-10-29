import type { Assignment, ReadClient } from '../domain/projects.js';
import { ReadError } from '../domain/errors.js';
import { positiveId } from '../domain/normalize.js';

type WorkField = 'plannedWork' | 'realWork' | 'leftWork';

// Sum decimal representations exactly before converting the final public value.
// This preserves 0.1 + 0.2 = 0.3 and detects overflow instead of emitting null JSON.
function decimalSum(values: readonly number[]): number {
  let sum = 0n;
  let scale = 0;
  for (const value of values) {
    const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
    const [whole = '0', fraction = ''] = mantissa!.split('.');
    let coefficient = BigInt(whole + fraction);
    let valueScale = fraction.length - Number(exponent);
    if (valueScale < 0) { coefficient *= 10n ** BigInt(-valueScale); valueScale = 0; }
    const nextScale = Math.max(scale, valueScale);
    sum = sum * 10n ** BigInt(nextScale - scale) + coefficient * 10n ** BigInt(nextScale - valueScale);
    scale = nextScale;
  }
  const result = Number(`${sum}e-${scale}`);
  if (!Number.isFinite(result)) throw new ReadError('WORK_TOTAL_OVERFLOW');
  return result;
}

function summarize(assignments: readonly Assignment[], field: WorkField) {
  const values = assignments.map(item => item[field]).filter((value): value is number => value !== null);
  const missingCount = assignments.length - values.length;
  const knownSubtotal = decimalSum(values);
  return { total: missingCount ? null : knownSubtotal, knownSubtotal, missingCount };
}

export async function analyzeWorkload(client: ReadClient, projectId: number) {
  positiveId(projectId);
  if (!(await client.getProject(projectId)).project) throw new ReadError('PROJECT_NOT_FOUND');
  const [activities, assignments, identities] = await Promise.all([
    client.readActivities(projectId), client.listAssignments(projectId), client.readResources()
  ]);
  const activityIds = new Set(activities.map(item => item.id));
  const names = new Map(identities.map(item => [item.id, item.name]));
  const grouped = new Map<number, Assignment[]>();
  const assigned = new Set<number>();
  let ignoredAssignmentCount = 0;
  let assignmentsWithoutResource = 0;
  for (const item of assignments) {
    if (item.idProject !== projectId || item.refType !== 'Activity' || item.refId === null || !activityIds.has(item.refId)) {
      ignoredAssignmentCount++; continue;
    }
    if (item.idResource === null) { assignmentsWithoutResource++; continue; }
    const group = grouped.get(item.idResource) ?? [];
    group.push(item);
    grouped.set(item.idResource, group);
    assigned.add(item.refId);
  }
  const resources = [...grouped].sort(([a], [b]) => a - b).map(([resourceId, items]) => ({
    resourceId, name: names.get(resourceId) ?? null, unknownResource: !names.has(resourceId),
    activityIds: [...new Set(items.map(item => item.refId!))].sort((a, b) => a - b),
    activityCount: new Set(items.map(item => item.refId)).size, assignmentCount: items.length,
    plannedWork: summarize(items, 'plannedWork'), realWork: summarize(items, 'realWork'), leftWork: summarize(items, 'leftWork')
  }));
  const unassignedActivityIds = activities.filter(item => !assigned.has(item.id)).map(item => item.id).sort((a, b) => a - b);
  const warnings: string[] = [];
  if (resources.some(item => [item.plannedWork, item.realWork, item.leftWork].some(work => work.missingCount > 0))) warnings.push('PARTIAL_WORK_DATA');
  if (resources.some(item => item.unknownResource || item.name === null)) warnings.push('UNKNOWN_RESOURCE');
  if (unassignedActivityIds.length) warnings.push('UNASSIGNED_ACTIVITIES');
  if (ignoredAssignmentCount) warnings.push('IGNORED_ASSIGNMENTS');
  if (assignmentsWithoutResource) warnings.push('ASSIGNMENTS_WITHOUT_RESOURCE');
  return { mode: client.mode, projectId, unit: 'raw upstream work units', activityCount: activities.length,
    resources, unassignedActivityIds, ignoredAssignmentCount, assignmentsWithoutResource, warnings,
    coverage: 'Visible activities and returned assignments only; missing or inaccessible assignments cannot be inferred.' };
}
