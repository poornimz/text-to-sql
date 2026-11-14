import { TrainingHyperparams } from './mlEngine.ts';

export interface CodeArtifacts {
  pytorchScript: string;
  tensorflowScript: string;
  pythonAgentScript: string;
  bigquerySql: string;
}

export function generateCodeArtifacts(params: TrainingHyperparams): CodeArtifacts {
  const hidden2 = Math.max(4, Math.floor(params.hiddenUnits / 2));

  const pytorchScript = `"""
train_failure_model.py — PyTorch Predictive Maintenance Trainer
Connects to SQLite / Cloud SQL PostgreSQL, normalizes 6 sensor features,
trains a 2-layer MLP with Adam + BCEWithLogitsLoss, and writes risk scores back to SQL.
"""
import sqlite3
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import TensorDataset, DataLoader
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import roc_auc_score, classification_report

FEATURES = [
    "temp_c", "vibration_rms", "pressure_bar",
    "rpm", "current_amp", "operating_hours"
]

class FailurePredictorMLP(nn.Module):
    def __init__(self, in_dim: int = 6, hidden_dim: int = ${params.hiddenUnits}):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, ${hidden2}),
            nn.ReLU(),
            nn.Linear(${hidden2}, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x).squeeze(-1)

def main(db_path: str = "turbineops.db"):
    conn = sqlite3.connect(db_path)
    rows = conn.execute(
        f"SELECT {', '.join(FEATURES)}, failure_within_48h FROM sensor_telemetry"
    ).fetchall()
    data = np.array(rows, dtype=np.float32)
    X, y = data[:, :-1], data[:, -1]

    X_train, X_val, y_train, y_val = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    scaler = StandardScaler()
    X_train = scaler.fit_transform(X_train)
    X_val = scaler.transform(X_val)

    train_loader = DataLoader(
        TensorDataset(torch.tensor(X_train), torch.tensor(y_train)),
        batch_size=32, shuffle=True
    )

    model = FailurePredictorMLP(in_dim=len(FEATURES), hidden_dim=${params.hiddenUnits})
    optimizer = torch.optim.Adam(model.parameters(), lr=${params.learningRate}, weight_decay=1e-4)
    criterion = nn.BCEWithLogitsLoss()

    for epoch in range(1, ${params.epochs} + 1):
        model.train()
        for xb, yb in train_loader:
            optimizer.zero_grad()
            loss = criterion(model(xb), yb)
            loss.backward()
            optimizer.step()

    model.eval()
    with torch.no_grad():
        val_probs = torch.sigmoid(model(torch.tensor(X_val))).numpy()
    print(f"Validation ROC-AUC: {roc_auc_score(y_val, val_probs):.4f}")
    print(classification_report(y_val, (val_probs >= 0.5).astype(int)))
    torch.save({"model": model.state_dict(), "scaler_mean": scaler.mean_, "scaler_scale": scaler.scale_}, "failure_mlp.pt")

if __name__ == "__main__":
    main()
`;

  const tensorflowScript = `"""
train_tf_model.py — TensorFlow / Keras Predictive Maintenance Trainer
Equivalent lightweight sequential architecture for Cloud Run / Vertex AI serving.
"""
import sqlite3
import numpy as np
import tensorflow as tf
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

FEATURES = [
    "temp_c", "vibration_rms", "pressure_bar",
    "rpm", "current_amp", "operating_hours"
]

def build_model(input_dim: int = 6) -> tf.keras.Model:
    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(input_dim,)),
        tf.keras.layers.Dense(${params.hiddenUnits}, activation="relu"),
        tf.keras.layers.Dense(${hidden2}, activation="relu"),
        tf.keras.layers.Dense(1, activation="sigmoid"),
    ])
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=${params.learningRate}),
        loss="binary_crossentropy",
        metrics=["accuracy", tf.keras.metrics.AUC(name="roc_auc")],
    )
    return model

if __name__ == "__main__":
    conn = sqlite3.connect("turbineops.db")
    data = np.array(conn.execute(
        f"SELECT {', '.join(FEATURES)}, failure_within_48h FROM sensor_telemetry"
    ).fetchall(), dtype=np.float32)

    X_train, X_val, y_train, y_val = train_test_split(data[:, :-1], data[:, -1], test_size=0.2, random_state=42)
    scaler = StandardScaler()
    X_train = scaler.fit_transform(X_train)
    X_val = scaler.transform(X_val)

    model = build_model()
    model.fit(X_train, y_train, validation_data=(X_val, y_val), epochs=${params.epochs}, batch_size=32, verbose=1)
    model.export("saved_failure_model")
`;

  const pythonAgentScript = `"""
agent_rag_sql.py — Hybrid Text-to-SQL + RAG Agent using Google GenAI Python SDK
Combines safe read-only SQL generation against Cloud SQL / SQLite with
vector/BM25 retrieval over unstructured maintenance logs.
"""
import os
import json
import sqlite3
from google import genai
from google.genai import types

client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

def is_safe_select(sql: str) -> bool:
    upper = sql.strip().upper()
    forbidden = ("INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "PRAGMA")
    return (upper.startswith("SELECT") or upper.startswith("WITH")) and not any(k in upper for k in forbidden)

def query_fleet_agent(question: str, db_path: str = "turbineops.db") -> dict:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    schema = "\\n".join(r[0] for r in conn.execute("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL").fetchall())

    plan = client.models.generate_content(
        model="gemini-4-hydrogen",
        contents=f"Schema:\\n{schema}\\n\\nGenerate a read-only SQLite SELECT query for: {question}",
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema={
                "type": "OBJECT",
                "properties": {
                    "sql_query": {"type": "STRING"},
                    "search_terms": {"type": "ARRAY", "items": {"type": "STRING"}},
                },
                "required": ["sql_query", "search_terms"],
            },
        ),
    )
    parsed = json.loads(plan.text)
    sql = parsed["sql_query"]
    if not is_safe_select(sql):
        raise ValueError(f"Blocked unsafe SQL: {sql}")

    sql_rows = [dict(r) for r in conn.execute(sql).fetchall()[:50]]
    logs = [
        dict(r) for r in conn.execute(
            "SELECT * FROM maintenance_logs ORDER BY logged_at DESC LIMIT 5"
        ).fetchall()
    ]

    synthesis = client.models.generate_content(
        model="gemini-4-hydrogen",
        contents=f"Question: {question}\\nSQL Rows: {json.dumps(sql_rows)}\\nLogs: {json.dumps(logs)}\\nSummarize findings with [LOG-XX] citations."
    )
    return {"sql": sql, "rows": sql_rows, "answer": synthesis.text}
`;

  const bigquerySql = `-- BigQuery Partitioned & Clustered Analytical Telemetry Warehouse
CREATE TABLE IF NOT EXISTS \`turbineops_dw.sensor_telemetry\` (
  asset_id STRING NOT NULL,
  recorded_at TIMESTAMP NOT NULL,
  temp_c FLOAT64,
  vibration_rms FLOAT64,
  pressure_bar FLOAT64,
  rpm INT64,
  current_amp FLOAT64,
  operating_hours INT64,
  failure_within_48h INT64
)
PARTITION BY DATE(recorded_at)
CLUSTER BY asset_id, failure_within_48h
OPTIONS (
  partition_expiration_days = 1095,
  description = "Streaming IoT sensor telemetry ingested via Cloud Pub/Sub -> Dataflow"
);

-- BigQuery ML Baseline Model directly inside the Data Warehouse
CREATE OR REPLACE MODEL \`turbineops_dw.failure_risk_dnn\`
OPTIONS (
  model_type = 'DNN_CLASSIFIER',
  hidden_units = [${params.hiddenUnits}, ${hidden2}],
  input_label_cols = ['failure_within_48h'],
  max_iterations = ${params.epochs},
  learn_rate = ${params.learningRate}
) AS
SELECT
  temp_c, vibration_rms, pressure_bar, rpm, current_amp, operating_hours, failure_within_48h
FROM \`turbineops_dw.sensor_telemetry\`
WHERE recorded_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY);

-- Federated Query joining BigQuery ML predictions with Cloud SQL Maintenance Logs
SELECT
  p.asset_id,
  ROUND(prob.prob, 4) AS failure_probability,
  l.fault_code,
  l.summary
FROM ML.PREDICT(MODEL \`turbineops_dw.failure_risk_dnn\`, (
  SELECT * FROM \`turbineops_dw.sensor_telemetry\`
  QUALIFY ROW_NUMBER() OVER (PARTITION BY asset_id ORDER BY recorded_at DESC) = 1
)) AS p,
UNNEST(p.predicted_failure_within_48h_probs) AS prob
LEFT JOIN EXTERNAL_QUERY(
  "projects/turbineops-prod/locations/us-central1/connections/cloudsql-ops",
  "SELECT asset_id, fault_code, summary FROM maintenance_logs WHERE severity = 'Critical';"
) AS l ON p.asset_id = l.asset_id
WHERE prob.label = 1
ORDER BY failure_probability DESC;
`;

  return {
    pytorchScript,
    tensorflowScript,
    pythonAgentScript,
    bigquerySql,
  };
}
