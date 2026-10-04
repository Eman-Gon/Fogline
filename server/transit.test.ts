import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error JavaScript transit adapter.
import { readAlerts, readArrivals, readLines, readSchedule, readStops, readVehicles } from './transit.mjs';
test('511 PascalCase alerts retain their text and affected route',()=>{
 const items=readAlerts({Entities:[{Alert:{InformedEntities:[{RouteId:'T'}],HeaderText:{Translations:[{Text:'T delayed',Language:'en'}]},DescriptionText:{Translations:[{Text:'Use the next train'}]}}}]});
 assert.equal(items[0].header,'T delayed');assert.equal(items[0].description,'Use the next train');assert.deepEqual(items[0].routes,['T']);
});
test('SIRI arrivals keep the T line and Chinatown destination',()=>{
 const items=readArrivals({Siri:{ServiceDelivery:{StopMonitoringDelivery:{MonitoredStopVisit:{MonitoringRef:'17166',MonitoredVehicleJourney:{LineRef:'T',PublishedLineName:'T',DestinationName:'Chinatown - Rose Pak Station',VehicleRef:'1452',MonitoredCall:{StopPointName:'4th St & King St',AimedArrivalTime:'2026-10-04T20:15:00Z',ExpectedArrivalTime:'2026-10-04T20:18:00Z'}}}}}}});
 assert.equal(items.length,1);
 assert.equal(items[0].line,'T');
 assert.equal(items[0].destination,'Chinatown - Rose Pak Station');
 assert.equal(items[0].stop,'4th St & King St');
 assert.equal(items[0].aimed,'2026-10-04T20:15:00Z');
 assert.equal(items[0].expected,'2026-10-04T20:18:00Z');
});
test('an unwrapped stop-monitoring payload still parses',()=>{
 const items=readArrivals({ServiceDelivery:{StopMonitoringDelivery:{MonitoredStopVisit:[{MonitoredVehicleJourney:{LineRef:'T',DestinationName:'Sunnydale',MonitoredCall:{AimedDepartureTime:'2026-10-04T20:20:00Z'}}}]}}});
 assert.equal(items[0].destination,'Sunnydale');
 assert.equal(items[0].aimed,'2026-10-04T20:20:00Z');
});
test('SIRI timetable uses the targeted journey and call',()=>{
 const items=readSchedule({Siri:{ServiceDelivery:{StopTimetableDelivery:{TimetabledStopVisit:[{TargetedVehicleJourney:{LineRef:'T',DestinationName:'Chinatown',TargetedCall:{AimedDepartureTime:'2026-10-04T20:15:00Z'}}}]}}}});
 assert.equal(items[0].line,'T');
 assert.equal(items[0].destination,'Chinatown');
 assert.equal(items[0].aimed,'2026-10-04T20:15:00Z');
});
test('line, stop, and vehicle feeds keep the fields the map needs',()=>{
 const lines=readLines([{Id:'T',Name:'THIRD',PublicCode:'T',TransportMode:'metro'}]);
 assert.equal(lines[0].id,'T'); assert.equal(lines[0].mode,'metro');
 const stops=readStops({Contents:{dataObjects:{ScheduledStopPoint:[{id:'17872',Name:'4th & Brannan Southbound',Location:{Latitude:'37.778341',Longitude:'-122.396613'}}]}}});
 assert.equal(stops[0].name,'4th & Brannan Southbound'); assert.equal(stops[0].lat,37.778341);
 const vehicles=readVehicles({Siri:{ServiceDelivery:{VehicleMonitoringDelivery:{VehicleActivity:{MonitoredVehicleJourney:{LineRef:'T',DestinationName:'Chinatown - Rose Pak Station',Bearing:'345',VehicleRef:'1452',VehicleLocation:{Latitude:'37.7601624',Longitude:'-122.388565'}}}}}}});
 assert.equal(vehicles[0].line,'T'); assert.equal(vehicles[0].destination,'Chinatown - Rose Pak Station'); assert.equal(vehicles[0].bearing,345);
});
test('standard GTFS alert casing stays supported',()=>{
 const items=readAlerts({entity:[{alert:{informed_entity:[{route_id:'T'}],header_text:{translation:[{text:'Delay'}]}}}]});assert.equal(items[0].header,'Delay');assert.deepEqual(items[0].routes,['T']);
});
