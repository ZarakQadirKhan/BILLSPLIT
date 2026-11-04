import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScoreboard, elapsedLabel } from '../shared/scoreboard.js';

const start = '2026-11-01T00:00:00Z', hour = 3600000;
const at = hours => new Date(Date.parse(start) + hours * hour).toISOString();
const people = [{id:'a',claimed:true},{id:'b',claimed:true},{id:'c',claimed:true}];
test('scoreboard counts fully repaid bills once and excludes rejected reports and approval delays', () => {
  const bills = [{id:'one',status:'published',publishedAt:start},{id:'two',status:'published',publishedAt:at(1)}];
  const debts = [{id:'a1',bill_id:'one',debtor_id:'a',amount:600,paid_amount:600},{id:'a2',bill_id:'one',debtor_id:'a',amount:400,paid_amount:400},{id:'a3',bill_id:'two',debtor_id:'a',amount:300,paid_amount:300}];
  const repayments = [
    {status:'rejected',created_at:at(20),allocations:[{debtId:'a1',amount:600}]},
    {status:'confirmed',created_at:at(1),reviewed_at:at(24),allocations:[{debtId:'a1',amount:200}]},
    {status:'confirmed',created_at:at(4),reviewed_at:at(30),allocations:[{debtId:'a1',amount:400},{debtId:'a2',amount:400}]},
    {status:'confirmed',created_at:at(7),reviewed_at:at(31),allocations:[{debtId:'a3',amount:300}]},
  ];
  let score = buildScoreboard({people,bills,debts,repayments,now:Date.parse(at(40))})[0];
  assert.equal(score.personId,'a'); assert.equal(score.completedBills,2); assert.equal(score.averageMs,5*hour);
  debts[1].paid_amount=0; debts[1].pending_amount=400;
  score = buildScoreboard({people,bills,debts,repayments,now:Date.parse(at(40))}).find(s=>s.personId==='a');
  assert.equal(score.completedBills,1); assert.equal(score.openBills,1); assert.equal(score.pendingBills,1); assert.equal(score.averageMs,6*hour);assert.equal(score.oldestOpenAt,new Date(start).toISOString());
  debts[1].pending_amount=0; debts[1].updated_at=at(39);debts[1].last_rejected_at=at(39);
  assert.equal(buildScoreboard({people,bills,debts,repayments,now:Date.parse(at(40))}).find(s=>s.personId==='a').oldestOpenAt,new Date(start).toISOString());
});

test('scoreboard ignores drafts and untracked history rather than inventing timestamps', () => {
  const bills=[{id:'old',status:'published',date:'2020-01-01'},{id:'draft',status:'draft',publishedAt:start}];
  const debts=[{id:'old',bill_id:'old',debtor_id:'a',amount:100,status:'confirmed',updated_at:at(1)},{id:'draft',bill_id:'draft',debtor_id:'a',amount:100,status:'confirmed',marked_paid_at:at(1)}];
  const rows=buildScoreboard({people,bills,debts,repayments:[],now:Date.parse(at(4))});
  assert.equal(rows.find(r=>r.personId==='a').averageMs,null);assert.equal(rows.find(r=>r.personId==='a').untrackedBills,1);
  assert.equal(elapsedLabel(null),'No score yet'); assert.equal(elapsedLabel(0),'Under 1 min');assert.equal(elapsedLabel(25*hour),'1d 1h');
});
