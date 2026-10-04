export type Commute = {
  line: string; code: string; patternId: string; direction: string; directionLabel: string; headsign: string;
  boardIndex: number; alightIndex: number; stopId: string; stopName: string; alightId: string; alightName: string;
  boardingMargin?: number; deadlineFirm?: boolean; catalogVersion: string; days: number[]; buffer: number;
};
export type ScheduledPlan = {tripId:string;patternId:string;boardIndex:number;alightIndex:number;serviceDay:string;stopsRemaining:number|null;position?:{vehicle:string;line:string;lat:number;lon:number;recordedAt:number}|null;observedAt:number|null;beAtStop:number;boardingMargin:number;range:null;confidence:string;destinationSource:string;line:string;headsign:string;departure:number;expected:number;arrival:number;source:'live'|'schedule';vehicle:string|null;leave:number;start:number;arrive:number;deadline:number;reachable?:boolean;slackMinutes?:number};
export type JourneyResult = {status:string;day:string;plan:ScheduledPlan|null;departures:ScheduledPlan[];reason:string;advisories?:{title:string;url:string;description:string}[];advisoryCoverage?:string;alternative?:ScheduledPlan|null;lateOptions?:ScheduledPlan[];warnings?:string[];notices?:{id:string;header:string;description:string;url:string}[];rejected?:{tripId:string;expected:number;reason:string}[];modelStatus?:string;catalogWarning?:string|null};
export type PatternStop = {id:string;code:string;name:string;lat:number|null;lon:number|null;sequence:number;pickup:string;dropoff:string;accessibility:string};
export type Pattern = {id:string;line:string;direction:string;label:string;headsign:string;stops:PatternStop[];shape:number[][]};
export type PatternFeed = {line:string;code:string;name:string;version:string;patterns:Pattern[];error?:string};
