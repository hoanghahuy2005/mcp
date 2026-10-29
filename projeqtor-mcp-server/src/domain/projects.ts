export interface Project {
  readonly id: number;
  readonly name: string;
  readonly description: string | null;
  readonly idStatus: number | null;
}

export type Mode = 'mock' | 'real';

export interface Activity {
  readonly id: number;
  readonly name: string;
  readonly description: string | null;
  readonly idProject: number | null;
  readonly idStatus: number | null;
  readonly idResource: number | null;
  readonly idActivityType: number | null;
  readonly creationDate: string | null;
  readonly startDate?: string | null;
  readonly endDate?: string | null;
  readonly plannedWork: number | null;
  readonly realWork: number | null;
  readonly leftWork: number | null;
}

export interface Resource { readonly id: number; readonly name: string | null }
export interface LookupValue { readonly id: number; readonly name: string }
export interface Assignment {
  readonly id: number;
  readonly idProject: number | null;
  readonly refType: string | null;
  readonly refId: number | null;
  readonly idResource: number | null;
  readonly plannedWork: number | null;
  readonly realWork: number | null;
  readonly leftWork: number | null;
}

export interface Page {
  readonly mode: Mode;
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly truncated: boolean;
}

export interface ProjectPage extends Page { readonly projects: readonly Project[] }
export interface ActivityPage extends Page { readonly activities: readonly Activity[] }
export interface ResourcePage extends Page { readonly resources: readonly Resource[] }
export interface ActivityTypePage extends Page { readonly activityTypes: readonly LookupValue[] }
export interface StatusPage extends Page { readonly statuses: readonly LookupValue[] }

export interface ProjectClient {
  listProjects(limit: number, offset: number): Promise<ProjectPage>;
}

export interface ReadClient extends ProjectClient {
  readonly mode: Mode;
  getProject(id: number): Promise<{ mode: Mode; project: Project | null }>;
  listActivities(limit: number, offset: number, projectId?: number): Promise<ActivityPage>;
  getActivity(id: number): Promise<{ mode: Mode; activity: Activity | null }>;
  listResources(limit: number, offset: number): Promise<ResourcePage>;
  readActivities(projectId?: number): Promise<readonly Activity[]>;
  readResources(): Promise<readonly Resource[]>;
  listAssignments(projectId?: number): Promise<readonly Assignment[]>;
  listActivityTypes(limit: number, offset: number): Promise<ActivityTypePage>;
  listStatuses(limit: number, offset: number): Promise<StatusPage>;
}

export interface RealActivityCreate {
  readonly projectId: number;
  readonly name: string;
  readonly description: string | null;
  readonly activityTypeId: number;
  readonly statusId: number;
  readonly activityPlanningModeId: number;
  readonly creationDate: string;
  readonly startDate?: string | undefined;
  readonly endDate?: string | undefined;
}

export interface ActivityWriteClient extends ReadClient {
  createActivity(input: RealActivityCreate): Promise<Activity>;
}

export interface ActivityDeleteClient extends ReadClient {
  deleteActivity(activityId: number): Promise<void>;
}

export function isActivityWriteClient(client: ReadClient): client is ActivityWriteClient {
  return typeof (client as Partial<ActivityWriteClient>).createActivity === 'function';
}

export function isActivityDeleteClient(client: ReadClient): client is ActivityDeleteClient {
  return typeof (client as Partial<ActivityDeleteClient>).deleteActivity === 'function';
}
