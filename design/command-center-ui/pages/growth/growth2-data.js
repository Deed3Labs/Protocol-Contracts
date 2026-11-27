/* ── Growth: one funnel, one lens ─────────────────────────────────────────
   Every number on the page comes from the rows below, so totals always add up.
   Each row is the six-step funnel: visits, joined, invited, opened, activated, first $10 spend. */
const STG = ['Visits','Joined','Invited','Opened','Activated','First spend'];
const STEP = ['Visit → join','Join → invite','Invite → open','Open → active','Active → spend'];
const STEP_LONG = ['visit to join','join to invite','invite to open','open to active','active to first spend'];
const D = {
  source: { name:'Source', rows:[
    {n:'Posters', f:[4812,1106,255,160,108,97]},
    {n:'Direct',  f:[12988,98,22,14,9,6]},
    {n:'Social',  f:[10420,61,14,9,4,4]},
    {n:'Search',  f:[8190,37,9,5,3,2]} ]},
  city: { name:'City', rows:[
    {n:'Redlands', f:[11208,520,120,76,51,45], s:'33 posters'},
    {n:'San Bernardino', f:[9102,330,76,48,32,28], s:'18 posters'},
    {n:'Riverside', f:[6655,240,55,34,22,20], s:'13 posters'},
    {n:'Fontana', f:[1850,52,12,8,5,4], s:'4 posters'},
    {n:'Rialto', f:[1210,38,9,6,4,4], s:'4 posters'},
    {n:'Highland', f:[1120,40,9,5,3,3], s:'4 posters'},
    {n:'Loma Linda', f:[1040,30,7,4,3,2], s:'4 posters'},
    {n:'Colton', f:[980,26,6,4,2,2], s:'4 posters'},
    {n:'Elsewhere', f:[3245,26,6,3,2,1], s:'No posters'} ]},
  shop: { name:'Shop', posters:1, rows:[
    {n:"Rosa’s Panadería", s:'Redlands · 4 posters', f:[842,219,50,32,22,22]},
    {n:'Inland Cycle Works', s:'Redlands · 3 posters', f:[611,128,29,18,12,11]},
    {n:'Mesa Laundry', s:'San Bernardino · 3', f:[530,127,29,18,12,10]},
    {n:'Uptown Barber', s:'Redlands · 3 posters', f:[402,125,29,19,14,13]},
    {n:'Citrus Bowl Café', s:'Riverside · 3 posters', f:[366,70,16,10,6,6]},
    {n:'Redlands Tire & Lube', s:'Redlands · 2 posters', f:[301,36,8,5,3,2]},
    {n:'State St. Books', s:'Redlands · 3 posters', f:[288,81,19,12,8,7]},
    {n:'La Michoacana', s:'San Bernardino · 3', f:[254,64,15,9,6,6]},
    {n:'Arrowhead Nails', s:'San Bernardino · 2', f:[221,40,9,6,4,3]},
    {n:'Orange St. Laundromat', s:'Redlands · 2 posters', f:[197,39,9,6,4,3]},
    {n:'Community boards', s:'6 boards', f:[314,47,11,6,4,3]},
    {n:'20 more shops', s:'Inland Empire · 68 posters', f:[486,130,31,19,13,11]} ]},
  design: { name:'Design', posters:1, rows:[
    {n:'A · The neighbor', s:'41 posters', f:[2011,501,116,73,49,44]},
    {n:'B · $10 on us', s:'38 posters', f:[2104,465,107,67,45,40]},
    {n:'C · The map', s:'23 posters', f:[697,140,32,20,14,13]} ]},
  page: { name:'Page', onlyStep:0, rows:[
    {n:'/join', f:[9600,1012]}, {n:'/', s:'Home', f:[8200,121]}, {n:'/how', f:[2900,74]}, {n:'/housing', f:[820,58]}, {n:'/coop', f:[500,37]},
    {n:'/s/:shop', s:'Poster pages hand off to /join', f:[4812,0]}, {n:'/shops', s:'Hands off to /join', f:[1800,0]}, {n:'/contribute', s:'Hands off to /join', f:[1000,0]} ]},
  week: { name:'Invite week', minStep:2 }
};
const COHORT = [['15 Sep',25,[16,28,36,44,48]],['22 Sep',25,[20,32,40,48,52]],['29 Sep',50,[18,30,38,42]],['6 Oct',75,[21,33,40]],['13 Oct',75,[19,31]],['20 Oct',50,[12]]];
