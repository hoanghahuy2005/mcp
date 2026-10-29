import { McpServer, requireScopes } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { MockProjectClient } from './clients/mock.js';
import type { ReadClient } from './domain/projects.js';
import { publicError } from './domain/errors.js';
import { log } from './logging.js';
import { analyzeWorkload } from './services/workload.js';
import { ActivityWorkflow } from './services/activity-workflow.js';
import { activityInputSchema, deleteActivityInputSchema } from './domain/activity-write.js';
import type { ValidatedAuthContext } from './oauth/resource-auth.js';
import { createHash } from 'node:crypto';

export function createMcpServer(client: ReadClient = new MockProjectClient(), workflow?: ActivityWorkflow, auth?: ValidatedAuthContext): McpServer {
  const server = new McpServer({ name: 'projeqtor-mcp-server', version: '0.1.0' });
  const pagination = { limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).max(100000).default(0) };
  const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
  const createActivityInput = client.mode === 'real'
    ? activityInputSchema.extend({ activityTypeId: id, statusId: id, creationDate: activityInputSchema.shape.creationDate.unwrap() })
    : activityInputSchema;
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: client.mode === 'real' };
  const readAuth = { scopeChallenge: requireScopes('mcp:read'), _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['mcp:read'] }] } };
  const writeAuth = { scopeChallenge: requireScopes('mcp:write'), _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['mcp:write'] }] } };
  const respond = async (read: () => Promise<object>, requiredScope = 'mcp:read') => {
    if (auth && !auth.scopes.includes(requiredScope)) {
      const structuredContent = { mode: client.mode, error: { code: 'INSUFFICIENT_SCOPE' } };
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }], structuredContent };
    }
    try {
      const structuredContent = { ...await read() };
      return { content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }], structuredContent };
    } catch (error) {
      log('tool_failed');
      const structuredContent = { mode: client.mode, error: publicError(error, client.mode) };
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }], structuredContent };
    }
  };
  const source = client.mode === 'mock' ? 'synthetic mock fixtures' : 'the configured ProjeQtOr read API';
  server.registerTool('list_projects', {
    description: `List visible projects from ${source}.`,
    inputSchema: z.strictObject(pagination), annotations, ...readAuth
  }, ({ limit, offset }) => respond(() => client.listProjects(limit, offset)));
  server.registerTool('get_project', {
    description: `Get one visible project from ${source}; null if not found.`,
    inputSchema: z.strictObject({ id }), annotations, ...readAuth
  }, ({ id }) => respond(() => client.getProject(id)));
  server.registerTool('list_activities', {
    description: `List visible activities from ${source}, optionally within one project. Work values are raw upstream units.`,
    inputSchema: z.strictObject({ ...pagination, projectId: id.optional() }), annotations, ...readAuth
  }, ({ limit, offset, projectId }) => respond(() => client.listActivities(limit, offset, projectId)));
  server.registerTool('get_activity', {
    description: `Get one visible activity from ${source}; null if not found. Work values are raw upstream units.`,
    inputSchema: z.strictObject({ id }), annotations, ...readAuth
  }, ({ id }) => respond(() => client.getActivity(id)));
  server.registerTool('list_resources', {
    description: `List visible resource identities from ${source}.`,
    inputSchema: z.strictObject(pagination), annotations, ...readAuth
  }, ({ limit, offset }) => respond(() => client.listResources(limit, offset)));
  server.registerTool('list_activity_types', {
    description: `List visible Activity Type IDs and names from ${source}; use a returned ID for real Activity creation.`,
    inputSchema: z.strictObject(pagination), annotations, ...readAuth
  }, ({ limit, offset }) => respond(() => client.listActivityTypes(limit, offset)));
  server.registerTool('list_statuses', {
    description: `List visible Status IDs and names from ${source}; use a returned ID for real Activity creation.`,
    inputSchema: z.strictObject(pagination), annotations, ...readAuth
  }, ({ limit, offset }) => respond(() => client.listStatuses(limit, offset)));
  server.registerTool('analyze_workload', {
    description: 'Aggregate visible Activity assignments per resource for one project. Counts distinct activities; sums assignment work in raw upstream units. Missing values remain unknown. No capacity or overload inference.',
    inputSchema: z.strictObject({ projectId: id }), annotations, ...readAuth
  }, ({ projectId }) => respond(() => analyzeWorkload(client, projectId)));
  if (auth?.method === 'oauth') {
    const profileId = `prf_${createHash('sha256').update(`projeqtor-profile\0${auth.subject}`).digest('base64url')}`;
    server.registerTool('get_profile', {
      description: 'Get the authenticated profile identity.',
      inputSchema: z.strictObject({}), outputSchema: z.strictObject({ id: z.string().min(1) }), annotations,
      scopeChallenge: requireScopes('mcp:read'), _meta: { 'openai/profile': true, securitySchemes: [{ type: 'oauth2', scopes: ['mcp:read'] }] }
    }, () => respond(async () => ({ id: profileId })));
  }
  if (workflow) {
    server.registerTool('create_activity', {
      description: 'Create an Activity directly in ProjeQtOr in one call. Optional startDate/endDate are requested planning dates in YYYY-MM-DD format. Do not create a preview or proposal. Requires mcp:write plus local write gates. In Real Mode, look up valid IDs with list_activity_types/list_statuses; if the user omitted type, status or creation date, choose a suitable visible type/status and today’s date. The default planning mode is as soon as possible (ID 1). Exact repeated requests are deduplicated.',
      inputSchema: createActivityInput,
      annotations: { readOnlyHint: false, destructiveHint: client.mode === 'real', idempotentHint: client.mode === 'real', openWorldHint: client.mode === 'real' }, ...writeAuth
    }, (input: z.infer<typeof createActivityInput>) => respond(() => workflow.createDirect(input), 'mcp:write'));
    if (client.mode === 'real') {
      server.registerTool('delete_activity', {
        description: 'Permanently delete one ProjeQtOr Activity by activityId. The confirmed argument is required: always call first with confirmed=false to verify the Activity and show its details to the user. After the user explicitly confirms deletion, call again using the returned confirmationArguments, which contain confirmed=true. The confirmed call checks existence again, performs a real DELETE, then verifies the Activity is no longer visible. Never use this tool in Mock Mode.',
        inputSchema: deleteActivityInputSchema,
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }, ...writeAuth
      }, (input: z.infer<typeof deleteActivityInputSchema>) => respond(() => workflow.deleteDirect(input), 'mcp:write'));
    }
  }
  return server;
}
