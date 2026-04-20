/**
 * lib/oracle-queries.mjs — Fixed parameterized query library for test-oracle
 *
 * v1 ships 12 named queries. No LLM-generated SQL. Every query is auditable
 * by code review. Add new queries as code changes within v1 if AC demand it.
 *
 * Usage:
 *   import { getQuery, QUERY_NAMES, buildOracleQuery } from './oracle-queries.mjs';
 *   const { sql, params } = buildOracleQuery('last_verdict_for_scenario', { scenario_name: 'foo' });
 *   const row = db.prepare(sql).get(...params);
 *
 * Routing:
 *   import { routeQuestion } from './oracle-queries.mjs';
 *   const queryName = routeQuestion("what scenarios exist for my project?");
 */

// --- Named query definitions ---
export const QUERIES = {
  scenarios_for_project: {
    description: "What scenarios exist for project X?",
    params: ["project_name"],
    sql: `
      SELECT s.id, s.name, s.format_version, s.source_path, s.created_at
      FROM scenarios s
      JOIN projects p ON s.project_id = p.id
      WHERE p.name = ?
        AND s.deleted = 0
      ORDER BY s.created_at DESC
    `,
    keywords: ["scenario", "scenarios", "exist", "project"],
  },

  last_verdict_for_scenario: {
    description: "What is the last verdict for scenario Y?",
    params: ["scenario_name"],
    sql: `
      SELECT v.verdict, v.created_at, v.reason, v.reviewer,
             r.started_at, r.finished_at, s.name as scenario_name
      FROM verdicts v
      JOIN runs r ON v.run_id = r.id
      JOIN scenarios s ON r.scenario_id = s.id
      WHERE s.name = ?
        AND v.deleted = 0
      ORDER BY v.created_at DESC
      LIMIT 1
    `,
    keywords: ["verdict", "last", "result", "pass", "fail", "scenario"],
  },

  runs_by_status: {
    description: "What runs have a given status? (optionally since a date)",
    params: ["status", "since?"],
    sql: `
      SELECT r.id, r.status, r.started_at, r.finished_at,
             s.name as scenario_name, p.name as project_name
      FROM runs r
      JOIN scenarios s ON r.scenario_id = s.id
      JOIN projects p ON r.project_id = p.id
      WHERE r.status = ?
        AND r.deleted = 0
        {{SINCE_CLAUSE}}
      ORDER BY r.started_at DESC
    `,
    keywords: ["runs", "status", "running", "passed", "failed", "error"],
  },

  failed_runs_since: {
    description: "What failed since date D?",
    params: ["since"],
    sql: `
      SELECT r.id, r.status, r.started_at, r.finished_at,
             s.name as scenario_name, p.name as project_name
      FROM runs r
      JOIN scenarios s ON r.scenario_id = s.id
      JOIN projects p ON r.project_id = p.id
      WHERE r.status = 'failed'
        AND r.started_at >= ?
        AND r.deleted = 0
      ORDER BY r.started_at DESC
    `,
    keywords: ["failed", "since", "date", "failure"],
  },

  tasks_by_status: {
    description: "What tasks are in a given status? (open, in_progress, done, blocked)",
    params: ["status"],
    sql: `
      SELECT t.id, t.title, t.status, t.assignee_skill,
             p.name as project_name, t.updated_at
      FROM tasks t
      JOIN projects p ON t.project_id = p.id
      WHERE t.status = ?
        AND t.deleted = 0
      ORDER BY t.updated_at DESC
    `,
    keywords: ["tasks", "task", "open", "in_progress", "in progress", "done", "blocked"],
  },

  tasks_for_project: {
    description: "What tasks exist for project X?",
    params: ["project_name"],
    sql: `
      SELECT t.id, t.title, t.status, t.assignee_skill, t.updated_at
      FROM tasks t
      JOIN projects p ON t.project_id = p.id
      WHERE p.name = ?
        AND t.deleted = 0
      ORDER BY t.updated_at DESC
    `,
    keywords: ["tasks", "task", "project"],
  },

  current_strategy_for_project: {
    description: "What is the current test strategy for project X?",
    params: ["project_name"],
    sql: `
      SELECT st.id, st.name, st.body, st.created_at, st.updated_at
      FROM strategies st
      JOIN projects p ON st.project_id = p.id
      WHERE p.name = ?
        AND st.deleted = 0
      ORDER BY st.created_at DESC
      LIMIT 1
    `,
    keywords: ["strategy", "strategies", "plan", "planning", "project"],
  },

  recent_runs: {
    description: "Show the last N runs (optionally filtered by project)",
    params: ["limit", "project?"],
    sql: `
      SELECT r.id, r.status, r.started_at, r.finished_at,
             s.name as scenario_name, p.name as project_name
      FROM runs r
      JOIN scenarios s ON r.scenario_id = s.id
      JOIN projects p ON r.project_id = p.id
      WHERE r.deleted = 0
        {{PROJECT_CLAUSE}}
      ORDER BY r.started_at DESC
      LIMIT ?
    `,
    keywords: ["recent", "last", "runs", "latest", "show"],
  },

  verdicts_since: {
    description: "What verdicts have been issued since date D?",
    params: ["since"],
    sql: `
      SELECT v.id, v.verdict, v.created_at, v.reviewer, v.reason,
             s.name as scenario_name, p.name as project_name
      FROM verdicts v
      JOIN runs r ON v.run_id = r.id
      JOIN scenarios s ON r.scenario_id = s.id
      JOIN projects p ON r.project_id = p.id
      WHERE v.created_at >= ?
        AND v.deleted = 0
      ORDER BY v.created_at DESC
    `,
    keywords: ["verdicts", "verdict", "since", "issued", "date"],
  },

  row_counts: {
    description: "Count of rows in all tables (for /wicked-testing:stats)",
    params: [],
    sql: `
      SELECT
        (SELECT COUNT(*) FROM projects WHERE deleted = 0) as projects,
        (SELECT COUNT(*) FROM strategies WHERE deleted = 0) as strategies,
        (SELECT COUNT(*) FROM scenarios WHERE deleted = 0) as scenarios,
        (SELECT COUNT(*) FROM runs WHERE deleted = 0) as runs,
        (SELECT COUNT(*) FROM verdicts WHERE deleted = 0) as verdicts,
        (SELECT COUNT(*) FROM tasks WHERE deleted = 0) as tasks,
        (SELECT COUNT(*) FROM schema_migrations) as schema_migrations
    `,
    keywords: ["count", "counts", "stats", "statistics", "total"],
  },

  schema_version: {
    description: "Current schema version",
    params: [],
    sql: `
      SELECT version, applied_at, description
      FROM schema_migrations
      ORDER BY version DESC
      LIMIT 1
    `,
    keywords: ["schema", "version", "migration"],
  },

  most_recent_project: {
    description: "Most recently updated project",
    params: [],
    sql: `
      SELECT id, name, description, updated_at
      FROM projects
      WHERE deleted = 0
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    keywords: ["recent", "project", "latest", "newest", "last project"],
  },
};

export const QUERY_NAMES = Object.keys(QUERIES);

/**
 * Route a natural-language question to a named query by keyword matching.
 * Returns the query name or null if no match.
 */
export function routeQuestion(question, filters = {}) {
  const lower = question.toLowerCase();

  // Explicit filter overrides
  if (filters.status && (lower.includes("task") || lower.includes("work"))) {
    return "tasks_by_status";
  }
  if (filters.since && lower.includes("verdict")) {
    return "verdicts_since";
  }
  if (filters.since && (lower.includes("fail") || lower.includes("failed"))) {
    return "failed_runs_since";
  }
  if (filters.project && lower.includes("scenario")) {
    return "scenarios_for_project";
  }
  if (filters.project && lower.includes("task")) {
    return "tasks_for_project";
  }
  if (filters.project && lower.includes("strateg")) {
    return "current_strategy_for_project";
  }

  // Keyword-based routing with priority scoring
  const scores = {};
  for (const [name, query] of Object.entries(QUERIES)) {
    scores[name] = 0;
    for (const kw of query.keywords) {
      if (lower.includes(kw)) scores[name]++;
    }
  }

  // Special-case disambiguation
  if (lower.includes("last verdict") || lower.includes("latest verdict") || lower.includes("most recent verdict")) {
    return "last_verdict_for_scenario";
  }
  if (lower.includes("bootstrap")) {
    return "last_verdict_for_scenario";
  }
  if (lower.includes("row count") || lower.includes("how many") || lower.includes("counts")) {
    return "row_counts";
  }
  if (lower.includes("schema version") || lower.includes("current version")) {
    return "schema_version";
  }
  if (lower.includes("recent run") || lower.includes("last run") || lower.includes("latest run")) {
    return "recent_runs";
  }

  // Pick the highest-scored query
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  if (best && best[1] > 0) return best[0];

  return null;
}

/**
 * Build a query with filter substitution.
 * Returns { sql, params }.
 */
export function buildOracleQuery(queryName, filterArgs = {}) {
  const query = QUERIES[queryName];
  if (!query) return null;

  let sql = query.sql;
  const params = [];

  // Substitute template clauses
  if (sql.includes("{{SINCE_CLAUSE}}")) {
    if (filterArgs.since) {
      sql = sql.replace("{{SINCE_CLAUSE}}", "AND r.started_at >= ?");
      params.push(filterArgs.since);
    } else {
      sql = sql.replace("{{SINCE_CLAUSE}}", "");
    }
  }

  if (sql.includes("{{PROJECT_CLAUSE}}")) {
    if (filterArgs.project) {
      sql = sql.replace("{{PROJECT_CLAUSE}}", "AND p.name = ?");
      params.push(filterArgs.project);
    } else {
      sql = sql.replace("{{PROJECT_CLAUSE}}", "");
    }
  }

  // Add positional params for required query params
  for (const param of query.params) {
    const isOptional = param.endsWith("?");
    const key = isOptional ? param.slice(0, -1) : param;

    if (key === "since" && sql.includes("{{SINCE_CLAUSE}}")) continue;
    if (key === "project" && sql.includes("{{PROJECT_CLAUSE}}")) continue;

    if (filterArgs[key] !== undefined) {
      params.push(filterArgs[key]);
    } else if (!isOptional) {
      // Required param missing — caller should check
      params.push(null);
    }
  }

  return { sql: sql.trim(), params };
}

/**
 * Return a human-readable list of supported question patterns.
 */
export function supportedPatterns() {
  return Object.entries(QUERIES).map(([name, q]) => `  ${name}: "${q.description}"`).join("\n");
}

export default { QUERIES, QUERY_NAMES, routeQuestion, buildOracleQuery, supportedPatterns };
