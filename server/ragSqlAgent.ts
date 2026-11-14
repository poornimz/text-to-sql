import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { Database } from 'sql.js';
import {
  executeReadOnlySql,
  MaintenanceLogRow,
  queryAll,
  SafeSqlExecutionResult,
  SQL_SCHEMA_DDL,
} from './db.ts';

export interface RetrievedLogChunk extends MaintenanceLogRow {
  asset_name: string;
  plant_location: string;
  relevanceScore: number;
}

export interface AgentQueryResponse {
  question: string;
  intent: 'sql_only' | 'rag_only' | 'hybrid';
  reasoning: string;
  sqlQuery: string | null;
  sqlResult: SafeSqlExecutionResult | null;
  sqlError: string | null;
  sqlRepaired: boolean;
  retrievedLogs: RetrievedLogChunk[];
  answer: string;
  recommendedActions: string[];
  followUpQuestions: string[];
  latencyMs: number;
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured. Add your key in the Settings > Secrets panel.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_.\-]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

export function retrieveMaintenanceLogs(
  db: Database,
  query: string,
  extraTerms: string[] = [],
  topK = 5
): RetrievedLogChunk[] {
  const rows = queryAll<MaintenanceLogRow & { asset_name: string; plant_location: string }>(
    db,
    `SELECT l.*, a.name AS asset_name, a.plant_location
     FROM maintenance_logs l
     JOIN assets a ON a.asset_id = l.asset_id`
  );

  const queryTokens = tokenize([query, ...extraTerms].join(' '));
  if (queryTokens.length === 0) return [];

  const docs = rows.map((row) => {
    const content = [
      row.log_id,
      row.asset_id,
      row.asset_name,
      row.plant_location,
      row.severity,
      row.fault_code,
      row.summary,
      row.resolution_notes,
    ].join(' ');
    return {
      row,
      tokens: tokenize(content),
    };
  });

  const N = docs.length;
  const avgDl = docs.reduce((acc, d) => acc + d.tokens.length, 0) / Math.max(1, N);
  const k1 = 1.4;
  const b = 0.75;

  // Document frequency per unique query term
  const uniqueQuery = Array.from(new Set(queryTokens));
  const df = new Map<string, number>();
  for (const term of uniqueQuery) {
    let count = 0;
    for (const d of docs) {
      if (d.tokens.some((t) => t === term || t.includes(term) || term.includes(t))) {
        count++;
      }
    }
    df.set(term, count);
  }

  const scored: RetrievedLogChunk[] = docs.map((d) => {
    const dl = d.tokens.length;
    let score = 0;
    for (const term of uniqueQuery) {
      let tf = 0;
      for (const t of d.tokens) {
        if (t === term) tf += 1;
        else if (t.includes(term) || term.includes(t)) tf += 0.5;
      }
      if (tf === 0) continue;
      const docFreq = df.get(term) ?? 0;
      const idf = Math.log(1 + (N - docFreq + 0.5) / (docFreq + 0.5));
      const num = tf * (k1 + 1);
      const den = tf + k1 * (1 - b + (b * dl) / Math.max(1, avgDl));
      score += idf * (num / den);
    }

    // Slight boost for Critical severity logs or exact asset_id match
    if (query.toUpperCase().includes(d.row.asset_id)) {
      score += 2.5;
    }
    if (d.row.severity === 'Critical') {
      score += 0.2;
    }

    return {
      ...d.row,
      relevanceScore: Number(score.toFixed(3)),
    };
  });

  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return scored.filter((s) => s.relevanceScore > 0).slice(0, topK);
}

export async function runTextToSqlRagAgent(
  db: Database,
  question: string
): Promise<AgentQueryResponse> {
  const started = performance.now();
  const ai = getGeminiClient();

  // Step 1: Plan intent + generate SQLite SELECT query
  const plannerPrompt = `
You are an industrial reliability & Text-to-SQL AI engineering agent operating on a SQLite database.

SQLite Schema DDL:
${SQL_SCHEMA_DDL}

Domain notes:
- assets.asset_id examples: 'TURB-01', 'PUMP-204', 'CNC-108', 'GEAR-09', 'HYD-302', 'TURB-04'.
- assets.plant_location values: 'Austin Fab 1', 'Munich Assembly', 'Osaka Plant 3'.
- ml_predictions stores the latest neural-network failure_probability (0.0 to 1.0) and risk_tier ('Nominal', 'Elevated', 'Critical') per asset_id.
- sensor_telemetry stores 48-hour time-series readings (temp_c, vibration_rms, pressure_bar, rpm, current_amp, operating_hours, failure_within_48h). Use MAX(recorded_at) or ORDER BY recorded_at DESC to get the most recent reading per asset.
- maintenance_logs stores unstructured technician logs, fault_code, severity ('Info', 'Warning', 'Critical'), summary, and resolution_notes.

Task:
Analyze the user's question and decide:
1. intent:
   - "sql_only" if purely quantitative/tabular metrics or aggregations from sensor_telemetry, assets, or ml_predictions.
   - "rag_only" if purely asking about OEM threshold rules, technician repair procedures, or root-cause notes without needing telemetry aggregations.
   - "hybrid" if combining asset risk/sensor metrics with maintenance log root causes or diagnostics (prefer "hybrid" whenever both sensor telemetry/predictions and log context add value).
2. sqlQuery: Write a single, valid SQLite read-only SELECT (or WITH ... SELECT) query that answers the quantitative part of the question. Return an empty string ONLY if intent is strictly "rag_only". Always include helpful columns like asset_id, name, or relevant averages/latest values, and LIMIT results to <= 25 rows.
3. ragSearchTerms: 3 to 6 focused keywords to retrieve relevant maintenance_logs chunks.
4. reasoning: One concise sentence describing the query strategy.

User Question: "${question}"
`.trim();

  const planResponse = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: plannerPrompt,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          intent: {
            type: Type.STRING,
            description: 'Must be one of: sql_only, rag_only, hybrid',
          },
          sqlQuery: {
            type: Type.STRING,
            description: 'Valid SQLite read-only SELECT query, or empty string if rag_only.',
          },
          ragSearchTerms: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Keywords for retrieving maintenance logs.',
          },
          reasoning: {
            type: Type.STRING,
            description: 'One-sentence query plan explanation.',
          },
        },
        required: ['intent', 'sqlQuery', 'ragSearchTerms', 'reasoning'],
      },
    },
  });

  const planJson = JSON.parse((planResponse.text ?? '{}').trim()) as {
    intent?: string;
    sqlQuery?: string;
    ragSearchTerms?: string[];
    reasoning?: string;
  };

  const intent: 'sql_only' | 'rag_only' | 'hybrid' =
    planJson.intent === 'sql_only' || planJson.intent === 'rag_only'
      ? planJson.intent
      : 'hybrid';

  let sqlQuery = (planJson.sqlQuery ?? '').trim();
  const ragTerms = Array.isArray(planJson.ragSearchTerms) ? planJson.ragSearchTerms : [];
  const reasoning = planJson.reasoning ?? 'Combined SQL telemetry query and maintenance log retrieval.';

  // Step 2: Retrieve RAG maintenance logs
  const retrievedLogs =
    intent === 'sql_only'
      ? retrieveMaintenanceLogs(db, question, ragTerms, 2)
      : retrieveMaintenanceLogs(db, question, ragTerms, 5);

  // Step 3: Execute SQL (with 1-step self-repair on SQLite error)
  let sqlResult: SafeSqlExecutionResult | null = null;
  let sqlError: string | null = null;
  let sqlRepaired = false;

  if (sqlQuery.length > 0 && intent !== 'rag_only') {
    try {
      sqlResult = executeReadOnlySql(db, sqlQuery);
    } catch (err) {
      const initialErrMsg = err instanceof Error ? err.message : String(err);
      // Attempt 1-shot SQL self-repair via Gemini
      try {
        const repairResp = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Fix this SQLite read-only SELECT query based on the error and schema.\n\nSchema:\n${SQL_SCHEMA_DDL}\n\nFailed SQL:\n${sqlQuery}\n\nSQLite Error:\n${initialErrMsg}\n\nReturn only the corrected SQLite SELECT query.`,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                fixedSql: { type: Type.STRING },
              },
              required: ['fixedSql'],
            },
          },
        });
        const repairedJson = JSON.parse((repairResp.text ?? '{}').trim()) as { fixedSql?: string };
        if (repairedJson.fixedSql) {
          sqlQuery = repairedJson.fixedSql.trim();
          sqlResult = executeReadOnlySql(db, sqlQuery);
          sqlRepaired = true;
        }
      } catch (repairErr) {
        sqlError = repairErr instanceof Error ? repairErr.message : initialErrMsg;
      }
    }
  }

  // Step 4: Grounded Synthesis
  const synthesisPrompt = `
You are a senior industrial reliability engineer synthesizing a grounded response from live SQL query output and retrieved maintenance logs.

User Question: "${question}"

SQL Query Executed:
${sqlQuery || '(None — RAG retrieval only)'}

SQL Execution Result (${sqlResult ? `${sqlResult.rowCount} rows in ${sqlResult.executionMs}ms` : sqlError ? `Error: ${sqlError}` : 'Not run'}):
${sqlResult ? JSON.stringify(sqlResult.rows.slice(0, 20), null, 2) : 'No SQL rows returned.'}

Retrieved Maintenance & OEM Logs (RAG Context):
${
  retrievedLogs.length > 0
    ? retrievedLogs
        .map(
          (l) =>
            `[${l.log_id}] Asset: ${l.asset_id} (${l.asset_name}, ${l.plant_location}) | Severity: ${l.severity} | Fault: ${l.fault_code} | Date: ${l.logged_at}\nSummary: ${l.summary}\nResolution: ${l.resolution_notes}`
        )
        .join('\n\n')
    : 'No matching maintenance logs retrieved.'
}

Instructions:
- Provide a clear, concise, factual engineering answer directly grounded in the SQL numbers and log IDs above.
- Cite log IDs inline like [LOG-01] when referencing maintenance history or OEM thresholds.
- Never fabricate measurements or asset IDs that are not present in the SQL output or logs.
- Provide 2-3 concrete recommended maintenance actions and 2-3 smart follow-up questions the engineer might ask next.
`.trim();

  const synthResponse = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: synthesisPrompt,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          answer: {
            type: Type.STRING,
            description: 'Grounded engineering response with inline [LOG-XX] citations and exact SQL figures.',
          },
          recommendedActions: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '2-3 actionable next steps for reliability engineers.',
          },
          followUpQuestions: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '2-3 relevant follow-up natural language queries.',
          },
        },
        required: ['answer', 'recommendedActions', 'followUpQuestions'],
      },
    },
  });

  const synthJson = JSON.parse((synthResponse.text ?? '{}').trim()) as {
    answer?: string;
    recommendedActions?: string[];
    followUpQuestions?: string[];
  };

  return {
    question,
    intent,
    reasoning,
    sqlQuery: sqlQuery || null,
    sqlResult,
    sqlError,
    sqlRepaired,
    retrievedLogs,
    answer: synthJson.answer ?? 'Query completed.',
    recommendedActions: synthJson.recommendedActions ?? [],
    followUpQuestions: synthJson.followUpQuestions ?? [],
    latencyMs: Number((performance.now() - started).toFixed(0)),
  };
}
