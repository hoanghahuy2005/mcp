import { createHash } from 'node:crypto';
import { z } from 'zod';

export const positiveIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const operationIdSchema = z.uuid();
export const payloadHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
});

export const activityInputSchema = z.strictObject({
  projectId: positiveIdSchema,
  name: z.string().trim().min(1).max(200).refine(value => !/[\x00-\x1f\x7f]/.test(value)),
  description: z.string().max(4000).refine(value => !value.includes('\0')).optional(),
  activityTypeId: positiveIdSchema.optional(),
  statusId: positiveIdSchema.optional(),
  activityPlanningModeId: positiveIdSchema.optional(),
  creationDate: dateSchema.optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional()
});

export const deleteActivityInputSchema = z.strictObject({
  activityId: positiveIdSchema,
  confirmed: z.boolean()
});

export const activityPayloadSchema = z.strictObject({
  projectId: positiveIdSchema,
  name: activityInputSchema.shape.name,
  description: activityInputSchema.shape.description.unwrap().nullable(),
  activityTypeId: positiveIdSchema.optional(),
  statusId: positiveIdSchema.optional(),
  activityPlanningModeId: positiveIdSchema.optional(),
  creationDate: activityInputSchema.shape.creationDate.optional(),
  startDate: activityInputSchema.shape.startDate.optional(),
  endDate: activityInputSchema.shape.endDate.optional()
});

export type ActivityPayload = z.infer<typeof activityPayloadSchema>;
export type RealActivityPayload = ActivityPayload & { activityTypeId: number; statusId: number; activityPlanningModeId: number; creationDate: string };

export function isRealActivityPayload(payload: ActivityPayload): payload is RealActivityPayload {
  return payload.activityTypeId !== undefined && payload.statusId !== undefined &&
    payload.activityPlanningModeId !== undefined && payload.creationDate !== undefined;
}

export function payloadHash(mode: 'mock' | 'real', payload: ActivityPayload): string {
  return createHash('sha256').update(JSON.stringify({ version: 2, mode,
    projectId: payload.projectId, name: payload.name, description: payload.description,
    activityTypeId: payload.activityTypeId, statusId: payload.statusId,
    activityPlanningModeId: payload.activityPlanningModeId, creationDate: payload.creationDate,
    startDate: payload.startDate, endDate: payload.endDate })).digest('hex');
}

const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const operationSchema = z.strictObject({
  id: operationIdSchema,
  mode: z.enum(['mock', 'real']),
  payload: activityPayloadSchema,
  payloadHash: payloadHashSchema,
  createdAt: time,
  status: z.enum(['submitting', 'outcome_unknown', 'consumed']),
  baselineActivityIds: z.array(positiveIdSchema).max(10_000).nullable().default(null),
  activityId: positiveIdSchema.nullable()
});
export type ActivityOperation = z.infer<typeof operationSchema>;

const mockActivitySchema = z.strictObject({
  id: positiveIdSchema, name: z.string(), description: z.string().nullable(), idProject: positiveIdSchema,
  idStatus: positiveIdSchema.nullable(), idResource: z.null(), idActivityType: positiveIdSchema.nullable(), creationDate: z.string(),
  startDate: z.string().nullable().optional(), endDate: z.string().nullable().optional(),
  plannedWork: z.null(), realWork: z.null(), leftWork: z.null()
});

export const stateSchema = z.strictObject({
  version: z.literal(2),
  operations: z.record(operationIdSchema, operationSchema).refine(value => Object.keys(value).length <= 1000),
  activities: z.array(mockActivitySchema).max(1000)
});
export type ActivityState = z.infer<typeof stateSchema>;

// Read-only migration schema for state written by releases that exposed proposals.
export const legacyStateSchema = z.object({
  version: z.literal(1),
  proposals: z.record(z.string(), z.object({
    id: z.string(), mode: z.enum(['mock', 'real']), payload: activityPayloadSchema, payloadHash: payloadHashSchema,
    createdAt: time, status: z.enum(['pending', 'approved', 'submitting', 'outcome_unknown', 'consumed']),
    consumedActivityId: positiveIdSchema.nullable()
  })),
  activities: z.array(mockActivitySchema).max(1000)
});
