/**
 * Task dependency cycle detection (Build 27 — Roadmap Module 21) —
 * pure, isomorphic graph logic. Full DB-level DAG cycle prevention
 * (e.g. a recursive-CTE CHECK/trigger firing on every insert) is
 * disproportionate for this build's own scope — see
 * project-management.md "Dependency cycle prevention" for the full
 * boundary writeup. This function is the actual enforcement: the
 * service layer locks the owning `Project` row (`SELECT ... FOR
 * UPDATE`) to serialize concurrent dependency mutations for the same
 * project, loads every existing edge for that project inside the SAME
 * transaction, and calls this function BEFORE inserting a new edge.
 * The unique index on `(taskId, dependsOnTaskId)` and the
 * `taskId != dependsOnTaskId` CHECK constraint are real, additional
 * DB-level guards for the two narrower cases they can cheaply express
 * (duplicate edge, self-dependency) — this function is what closes the
 * general cycle case those can't.
 */

export interface DependencyEdge {
  taskId: string;
  dependsOnTaskId: string;
}

/**
 * "B depends on A" (`{taskId: B, dependsOnTaskId: A}`) means A must
 * complete before B — a directed edge B → A in dependency-order terms,
 * or equivalently A → B in "must happen before" terms. This function
 * answers: given the EXISTING edges, would inserting a new edge
 * `newEdge` create a cycle? Implemented as "is `newEdge.taskId`
 * reachable FROM `newEdge.dependsOnTaskId` by walking existing
 * dependency edges" — if A (the new prerequisite) already
 * (transitively) depends on B (the new dependent), adding "B depends
 * on A" would close a loop.
 */
export function wouldCreateCycle(existingEdges: DependencyEdge[], newEdge: DependencyEdge): boolean {
  if (existingEdges.some((e) => e.taskId === newEdge.taskId && e.dependsOnTaskId === newEdge.dependsOnTaskId)) {
    // An exact duplicate is handled by the caller/unique index, not a cycle per se — but walking from here would just find itself trivially; treat as non-cycle so the duplicate-edge error (a clearer message) is what the caller actually surfaces.
    return false;
  }

  const adjacency = new Map<string, string[]>();
  for (const edge of existingEdges) {
    const list = adjacency.get(edge.taskId) ?? [];
    list.push(edge.dependsOnTaskId);
    adjacency.set(edge.taskId, list);
  }

  // BFS from the new edge's own prerequisite (dependsOnTaskId) — if we
  // can reach the new edge's own dependent (taskId), the new edge would
  // close a cycle back to where it started.
  const visited = new Set<string>();
  const queue: string[] = [newEdge.dependsOnTaskId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === newEdge.taskId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of adjacency.get(current) ?? []) queue.push(next);
  }
  return false;
}
