import type { Commute, JourneyResult } from './commute-types';
import type { Profile } from './planner';
import type { TrackedRide } from './tracking-types';

export type AgentSettings = { enabled: boolean; timezone: string; wakeStart: number; wakeEnd: number; line: string; headsign: string };
export type ServerPlan = { start: number; leave: number; trip: number; arrive: number; odds: number; buffer: number };
export type Briefing = { speech: string; plan: ServerPlan | null; source: 'live' | 'sample' | 'schedule' | 'unavailable'; stage?: MorningStage; checkedAt: string; sourceAt: string | null; reason: string; alerts: string[]; journey?: JourneyResult };
export type MorningStage = 'planned' | 'unconfirmed' | 'preparing' | 'ready' | 'walking' | 'riding' | 'arrived' | 'skipped';
export type Ride = { extraPrep?: number; deadlineOverride?: number; skipped?: boolean; boarded?:string; noticePlan?:{tripId:string;leave:number}; wakeRan?: string; liveRanAt?: number; liveNotice?: string; collectRanAt?: number; date: string; started: string | null; left: string | null; arrived: string | null; measured: number | null; nextReady: number | null; acknowledged: boolean; alertDue?: number | null };
export type AgentEvent = {trackingId?:string;actor?:'agent';noticeKind?:'prepare'|'leave'|'change'|'wake'|'live';planKey?:string; id: string; at: string; kind: 'decision' | 'push' | 'call'; text: string; dryRun: boolean; delivery?: { status: 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled'; at?: string; providerId?: string; error?: string } };
export type AccountState = { tracking?: TrackedRide; trackingHistory?: TrackedRide[]; version: 1; configRevision?:number; commute?: Commute; sessions?: {hash:string;expires:number}[]; pairCode?: {hash:string;expires:number}; revision: number; readyOverride?: { date: string; minutes: number }; learningAppliedThrough: string | null; profile: Profile; settings: AgentSettings; briefing: Briefing | null; rides: Ride[]; events: AgentEvent[] };
