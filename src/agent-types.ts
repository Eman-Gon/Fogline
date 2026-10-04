import type { Profile } from './planner';

export type AgentSettings = { enabled: boolean; timezone: string; wakeStart: number; wakeEnd: number; line: string; headsign: string };
export type ServerPlan = { start: number; leave: number; trip: number; arrive: number; odds: number; buffer: number };
export type Briefing = { speech: string; plan: ServerPlan | null; source: 'live' | 'sample'; checkedAt: string; sourceAt: string | null; reason: string; alerts: string[] };
export type Ride = { date: string; started: string | null; left: string | null; arrived: string | null; measured: number | null; nextReady: number | null; acknowledged: boolean; alertDue?: number | null };
export type AgentEvent = { id: string; at: string; kind: 'decision' | 'push' | 'call'; text: string; dryRun: boolean; delivery?: { status: 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled'; at?: string; providerId?: string; error?: string } };
export type AccountState = { version: 1; revision: number; readyOverride?: { date: string; minutes: number }; learningAppliedThrough: string | null; profile: Profile; settings: AgentSettings; briefing: Briefing | null; rides: Ride[]; events: AgentEvent[] };
