import type { PlayParams, SpecialistMemo, SpecialistParams, TeamDirective } from "../../types/directive.ts";
import { DEFAULT_PLAY_ID, type Playbook } from "../../types/play.ts";
import { defaultDirective } from "../../engine/world.ts";
import { asPlayStrength, isLeadProtectPlay } from "../../playbook/retrieve.ts";
import { defaultPlayIdForBook, resolvePlay } from "../../playbook/store.ts";
import type { TeamGraphNode, TeamGraphStateType } from "../state.ts";
import { scoreStateFromObservation, type SpecialistId } from "./situation.ts";

function lastMemo(memos: readonly SpecialistMemo[], id: SpecialistId): SpecialistMemo | undefined {
  for (let i = memos.length - 1; i >= 0; i--) {
    const m = memos[i];
    if (m?.specialist === id) return m;
  }
  return undefined;
}

function applyOcParams(playParams: PlayParams, params: SpecialistParams): void {
  if (params.forecheck !== undefined) playParams.forecheck = params.forecheck;
  if (params.shotPolicy !== undefined) playParams.shotPolicy = params.shotPolicy;
}

function applyDcParams(playParams: PlayParams, params: SpecialistParams, zone: "DZ" | "NZ" | "OZ"): void {
  if (zone === "NZ" && params.nz !== undefined) playParams.nz = params.nz;
  if (zone === "DZ" && params.dz !== undefined) playParams.dz = params.dz;
}

function stUnit(playStr: string, last: TeamDirective): "PP1" | "PP2" | "PK1" | "PK2" {
  if (last.specialTeams?.unit) return last.specialTeams.unit;
  return playStr === "PK" ? "PK1" : "PP1";
}

/**
 * §10.4 merge table. HC owns playId/pressure/bench on macro. Micro: drop leftover
 * lead-protect when not leading; else captain playId if retrieved, else lastDirective.
 * Specialist playIdSuggestion is advisory.
 */
export function mergeAssembleDirective(state: TeamGraphStateType, playbook: Playbook): TeamDirective {
  const last = state.lastDirective ?? defaultDirective(DEFAULT_PLAY_ID);
  const intent = state.coachIntent;
  const memos = state.specialistMemos ?? [];
  const retrieved = state.retrievedPlays ?? [];
  const retrievedIds = new Set(retrieved.map((p) => p.id));
  const isMicro = state.epochKind === "micro";
  const zone = state.observation.zone;
  const playStr = asPlayStrength(state.observation.strength);
  const isPk = playStr === "PK";
  const isSpecial = playStr === "PP" || playStr === "PK";

  const oc = lastMemo(memos, "oc");
  const dc = lastMemo(memos, "dc");
  const st = lastMemo(memos, "st");
  const goalie = lastMemo(memos, "goalie");
  const captain = lastMemo(memos, "captain");

  let playId: string;
  if (isMicro) {
    const lastPlay = resolvePlay(last.playId, playbook);
    if (isLeadProtectPlay(lastPlay) && scoreStateFromObservation(state.observation) !== "leading") {
      playId = retrieved.find((p) => !isLeadProtectPlay(p))?.id ?? defaultPlayIdForBook(playbook);
    } else {
      const sug = captain?.playIdSuggestion;
      playId = sug && (retrievedIds.has(sug) || sug === DEFAULT_PLAY_ID) ? sug : last.playId;
    }
  } else {
    playId = intent?.playId ?? defaultPlayIdForBook(playbook);
  }

  const directive: TeamDirective = {
    ...defaultDirective(playId),
    ...last,
    playId,
  };

  if (isMicro) {
    directive.pressure = last.pressure;
    directive.lineChange = last.lineChange;
    directive.pullGoalie = last.pullGoalie;
    directive.timeout = last.timeout;
    directive.lockLines = last.lockLines;
  } else if (intent) {
    directive.pressure = intent.pressure;
    if (intent.matchingNotes) {
      directive.notesForCaptain = intent.matchingNotes.slice(0, 240);
    }
  }

  const playParams: PlayParams = { ...last.playParams };

  if (!isPk && oc?.params && (zone === "OZ" || zone === "NZ")) {
    applyOcParams(playParams, oc.params);
  }
  if (!isMicro && !isPk && intent?.shotPolicy) {
    playParams.shotPolicy = intent.shotPolicy;
  }
  if (dc?.params) {
    applyDcParams(playParams, dc.params, zone);
  }
  if (isSpecial && st) {
    if (st.params) {
      applyOcParams(playParams, st.params);
      applyDcParams(playParams, st.params, zone);
      if (st.params.nz !== undefined) playParams.nz = st.params.nz;
      if (st.params.dz !== undefined) playParams.dz = st.params.dz;
    }
    directive.specialTeams = {
      unit: stUnit(playStr, last),
      umbrella: st.params?.umbrella ?? last.specialTeams?.umbrella,
    };
  }

  if (Object.keys(playParams).length > 0) {
    directive.playParams = playParams;
  }

  if (goalie?.params) {
    directive.goalie = {
      playPuck: goalie.params.playPuck ?? last.goalie?.playPuck ?? "stay",
      creaseDepth: goalie.params.creaseDepth ?? last.goalie?.creaseDepth ?? "mid",
    };
  }

  return directive;
}

export function makeAssembleDirective(playbook: Playbook): TeamGraphNode {
  return (state) => ({ directive: mergeAssembleDirective(state, playbook) });
}
