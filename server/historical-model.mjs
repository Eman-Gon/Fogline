// An offline candidate only. Interval labels remain inferred; this module never
// changes the rider's plan or claims a calibrated boarding probability.
const quantile=(values,q)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor((sorted.length-1)*q)];};
export function evaluateHistoricalCandidate(samples,{minimumTrain=30,minimumTest=20,minimumDays=5}={}) {
  const groups=Map.groupBy(samples,s=>s.cohort),results=[];
  for(const [cohort,rows] of groups){
    const days=[...new Set(rows.map(s=>s.serviceDate))].sort();
    if(days.length<minimumDays){results.push({cohort,status:'insufficient-days',days:days.length});continue;}
    const split=days[Math.max(1,Math.floor(days.length*.7))];
    const train=rows.filter(s=>s.serviceDate<split),test=rows.filter(s=>s.serviceDate>=split);
    // Rows already contain at most one forecast per trip instance and horizon.
    if(train.length<minimumTrain||test.length<minimumTest){results.push({cohort,status:'insufficient-trips',train:train.length,test:test.length});continue;}
    const lowerResidual=quantile(train.map(s=>s.lower-s.expected),.05),upperResidual=quantile(train.map(s=>s.upper-s.expected),.95);
    const width=(upperResidual-lowerResidual)/60000;
    let contained=0,early=0;
    for(const s of test){if(s.expected+lowerResidual<=s.lower&&s.expected+upperResidual>=s.upper)contained++;if(s.upper<s.expected+lowerResidual)early++;}
    results.push({cohort,status:'shadow-only',train:train.length,test:test.length,heldOutFrom:split,lowerResidual,upperResidual,intervalWidthMinutes:width,fullObservedIntervalCoverage:contained/test.length,definiteEarlyBoundFailures:early/test.length});
  }
  return {version:'historical-residual-interval-v1',enabled:false,reason:'Shadow evaluation uses inferred passage intervals. Boarding reliability and arrival ranges require independent validation before promotion.',cohorts:results};
}
