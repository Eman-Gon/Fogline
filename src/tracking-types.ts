import type { Commute, JourneyResult, ScheduledPlan } from './commute-types';
import type { Profile } from './planner';

export type TrackingSample = { checkedAt: number; observedAt: number | null; source: 'live' | 'schedule' | 'unavailable'; expected: number | null; arrival: number | null; delay: number | null };
export type TrackingReport = { at: number; kind: 'delay' | 'recovered' | 'disruption' | 'unavailable'; text: string };
export type TrackedRide = {
  id: string; active: boolean; origin: 'saved' | 'quick'; createdAt: number; expiresAt: number;
  commute: Commute; profile: Profile; trip: ScheduledPlan; journey: JourneyResult;
  lastCheckedAt: number; nextCheckAt: number; researchAttemptAt: number; departureResearchDone?: boolean;
  samples: TrackingSample[]; reports: TrackingReport[];
  delayStreak: number; lastObservation: number | null; lastDelay: number | null;
  reportedDelay: number | null; lastProblem?: string;
  started?: number; left?: number; boarded?: number; arrived?: number; endedReason?: string;
};
