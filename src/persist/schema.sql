-- Graph_Hockey match DB (v1). Applied on first open; PRAGMA user_version = 1.
-- events.id = `${match_id}:${seq}` (e.g. abc:42). Replay resimulates; frames are not stored.

CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  seed INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  home_playbook_version INTEGER NOT NULL,
  away_playbook_version INTEGER NOT NULL,
  final_home INTEGER,
  final_away INTEGER,
  result TEXT,
  config_json TEXT NOT NULL
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,          -- `${match_id}:${seq}` e.g. abc:42
  match_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  live_tick INTEGER NOT NULL,
  stoppage_seq INTEGER NOT NULL,
  t_period REAL NOT NULL,
  period INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE (match_id, seq)
);

CREATE TABLE epoch_invocations (
  match_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  side TEXT NOT NULL,
  reason TEXT NOT NULL,
  epoch_kind TEXT,              -- macro | micro
  model TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  reasoning_tokens INTEGER,
  latency_ms INTEGER,
  ok INTEGER NOT NULL,          -- 1 only if invoke returned a new directive
  billed INTEGER NOT NULL,      -- 1 if any xAI tokens were used (timeout still 1)
  directive_json TEXT,
  coach_intent TEXT,
  PRIMARY KEY (match_id, seq, side)
);

CREATE TABLE playbooks (
  team_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  body_json TEXT NOT NULL,
  parent_version INTEGER,
  aar_match_id TEXT,
  PRIMARY KEY (team_id, version)
);

CREATE TABLE aar_reports (
  match_id TEXT NOT NULL,
  side TEXT NOT NULL,
  body_json TEXT NOT NULL,
  applied INTEGER NOT NULL,
  PRIMARY KEY (match_id, side)
);

CREATE TABLE scout_notes (
  team_id TEXT NOT NULL,
  about_team TEXT NOT NULL,
  match_id TEXT,
  note_json TEXT NOT NULL
);

-- Review footage: every finished match is a recording. Frames are NOT stored;
-- playback resimulates. Clips are indexes into that recording.
CREATE TABLE recordings (
  match_id TEXT PRIMARY KEY,
  series_id TEXT,
  game_index INTEGER,
  recorded_at TEXT NOT NULL,
  duration_live_ticks INTEGER NOT NULL,
  FOREIGN KEY (match_id) REFERENCES matches(id)
);

CREATE TABLE clips (
  id TEXT PRIMARY KEY,              -- `${matchId}:clip:${n}`
  match_id TEXT NOT NULL,
  series_id TEXT,
  start_live_tick INTEGER NOT NULL,
  end_live_tick INTEGER NOT NULL,
  anchor_event_id TEXT NOT NULL,    -- `${matchId}:${seq}`
  related_event_ids_json TEXT NOT NULL, -- JSON string[]
  kind TEXT NOT NULL,               -- goal|shot|save|turnover|penalty|pp|pk|icing|zone_entry|aar_cite|user
  title TEXT NOT NULL,
  side TEXT,                        -- home|away|both
  play_id TEXT,                     -- inspected-side play; never the opponent's private id on the wire
  xg REAL,
  source TEXT NOT NULL,             -- auto|aar|user
  signature TEXT,                   -- playId|zone|typeBag for pairing
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE improvement_ledger (
  series_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  game_index INTEGER NOT NULL,
  match_id TEXT NOT NULL,
  playbook_version_before INTEGER NOT NULL,
  playbook_version_after INTEGER NOT NULL,
  result TEXT NOT NULL,             -- win|loss|tie
  metrics_json TEXT NOT NULL,       -- MatchAggregates + clipCounts
  aar_ops_json TEXT NOT NULL,       -- applied PlayMutation[] (ids + ops, not essays)
  paired_clip_ids_json TEXT,        -- clips paired with an earlier game
  PRIMARY KEY (series_id, team_id, game_index)
);
