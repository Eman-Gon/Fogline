import { zipSync, strToU8 } from 'fflate';
// @ts-expect-error JavaScript schedule adapter
import { parseGtfs } from './gtfs.mjs';
// @ts-expect-error JavaScript journey adapter
import { validateJourney } from './journey.mjs';
export function fixture(overrides:Record<string,string>={}) {
 const data:Record<string,string>={
 'feed_info.txt':'feed_version,feed_start_date,feed_end_date\ntest,20260101,20261231\n',
 'routes.txt':'route_id,route_short_name,route_long_name,route_type\n15,15,Test route,3\n33,33,Other route,3\n',
 'stops.txt':'stop_id,stop_name,stop_lat,stop_lon\n10001,Board,37,-122\n10002,"Middle, quoted",,\n10003,Alight,37.1,-122\n',
 'directions.txt':'route_id,direction_id,direction\n15,1,Inbound\n15,0,Outbound\n',
 'trips.txt':'route_id,service_id,trip_id,trip_headsign,direction_id,shape_id\n15,work,t1,Downtown,1,s\n15,work,t2,Downtown,1,s\n15,work,wrong,Other end,0,s\n15,work,night,Downtown,1,s\n',
 'stop_times.txt':'trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\nt1,08:00:00,08:00:00,10001,1,0,0\nt1,08:10:00,08:10:00,10002,2,0,0\nt1,08:30:00,08:30:00,10003,3,0,0\nt2,08:15:00,08:15:00,10001,1,0,0\nt2,08:25:00,08:25:00,10002,2,0,0\nt2,08:45:00,08:45:00,10003,3,0,0\nwrong,08:20:00,08:20:00,10003,1,0,0\nwrong,08:40:00,08:40:00,10001,2,0,0\nnight,25:00:00,25:00:00,10001,1,0,0\nnight,25:10:00,25:10:00,10002,2,0,0\nnight,25:30:00,25:30:00,10003,3,0,0\n',
 'calendar.txt':'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nwork,1,1,1,1,1,0,0,20260101,20261231\n',
 'calendar_dates.txt':'service_id,date,exception_type\nwork,20261012,2\nwork,20261011,1\n',
 'shapes.txt':'shape_id,shape_pt_sequence,shape_pt_lat,shape_pt_lon\ns,1,37,-122\ns,2,37.1,-122\n'
 };
 return parseGtfs(zipSync(Object.fromEntries(Object.entries({...data,...overrides}).map(([k,v])=>[k,strToU8(v)]))));
}
export function chosen(c:any) {const p=Object.values(c.patterns).find((p:any)=>p.direction==='1') as any;return {...validateJourney({line:'15',patternId:p.id,boardIndex:0,alightIndex:2},c),days:[1,2,3,4,5],buffer:7};}
