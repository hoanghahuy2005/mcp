// Independent synthetic data: never import Backend's fixtures into QA assertions.
export const apiEnvelope = (items) => ({ identifier: 'id', items });

export function sourceData() {
  return {
    Project: [
      { id: '9', name: 'QLDA_Nhom9', idle: '0' },
      { id: '10', name: 'Outside QA scope', idle: '0' },
    ],
    Activity: [
      { id: '101', idProject: '9', name: 'Shared activity', idResource: '11',
        idActivityType: '1', idStatus: '1', creationDate: '2026-10-22',
        plannedWork: '999', realWork: '999', leftWork: '999' },
      { id: '102', idProject: '9', name: 'Partial work', idResource: '12',
        idActivityType: '1', idStatus: '1', creationDate: '2026-10-22' },
      { id: '103', idProject: '9', name: 'Responsible is not assigned', idResource: '11',
        idActivityType: '1', idStatus: '1', creationDate: '2026-10-22' },
      { id: '104', idProject: '10', name: 'Other project', idResource: '11' },
    ],
    Resource: [
      { id: '11', name: 'Synthetic resource A', idle: '0' },
      { id: '12', name: 'Synthetic resource B', idle: '0' },
    ],
    ActivityType: [{ id: '1', name: 'Standard activity' }, { id: '2', name: 'Milestone preparation' }],
    Status: [{ id: '1', name: 'Recorded' }, { id: '2', name: 'In progress' }],
    Assignment: [
      { id: '201', idProject: '9', refType: 'Activity', refId: '101', idResource: '11',
        plannedWork: '2.5', realWork: '0.5', leftWork: '2' },
      { id: '202', idProject: '9', refType: 'Activity', refId: '101', idResource: '11',
        plannedWork: '1.5', realWork: '0.25', leftWork: '1.25' },
      { id: '203', idProject: '9', refType: 'Activity', refId: '102', idResource: '11',
        plannedWork: '', realWork: '0', leftWork: null },
      { id: '204', idProject: '9', refType: 'Activity', refId: '101', idResource: '12',
        plannedWork: '4', realWork: '1', leftWork: '3' },
      { id: '205', idProject: '10', refType: 'Activity', refId: '104', idResource: '11',
        plannedWork: '100', realWork: '40', leftWork: '60' },
      { id: '206', idProject: '9', refType: 'Meeting', refId: '101', idResource: '11',
        plannedWork: '100', realWork: '40', leftWork: '60' },
      { id: '207', idProject: '9', refType: 'Activity', refId: '999', idResource: '11',
        plannedWork: '100', realWork: '40', leftWork: '60' },
      { id: '208', idProject: '9', refType: 'Activity', refId: '102', idResource: '13',
        plannedWork: '', realWork: null },
      { id: '209', idProject: '9', refType: 'Activity', refId: '102', idResource: '13',
        plannedWork: 'not-a-number', realWork: '', leftWork: '' },
    ],
  };
}

// Hand-calculated acceptance values, not a reimplementation of workload aggregation.
export const workloadOracle = {
  projectId: 9,
  unit: 'raw upstream work units',
  unassignedActivityIds: [103],
  resources: {
    11: { activityCount: 2, assignmentCount: 3,
      plannedWork: { total: null, knownSubtotal: 4, missingCount: 1 },
      realWork: { total: 0.75, knownSubtotal: 0.75, missingCount: 0 },
      leftWork: { total: null, knownSubtotal: 3.25, missingCount: 1 } },
    12: { activityCount: 1, assignmentCount: 1,
      plannedWork: { total: 4, knownSubtotal: 4, missingCount: 0 },
      realWork: { total: 1, knownSubtotal: 1, missingCount: 0 },
      leftWork: { total: 3, knownSubtotal: 3, missingCount: 0 } },
    13: { activityCount: 1, assignmentCount: 2, unknownResource: true,
      plannedWork: { total: null, knownSubtotal: 0, missingCount: 2 },
      realWork: { total: null, knownSubtotal: 0, missingCount: 2 },
      leftWork: { total: null, knownSubtotal: 0, missingCount: 2 } },
  },
};

// api/index.php returnError wraps a JSON-encoded string in another pair of quotes.
export const malformedApiError = '{"error":"invalid API query", "message":""user disabled""}';
export const syntheticLeakCanary = 'QA_SYNTHETIC_SECRET_MUST_NOT_LEAK';
