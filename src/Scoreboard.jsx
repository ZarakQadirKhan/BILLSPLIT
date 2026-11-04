import React from 'react';
import { Trophy } from 'lucide-react';
import { elapsedLabel } from '../shared/scoreboard.js';
import { Avatar } from './ui.jsx';
import './scoreboard.css';

export default function Scoreboard({ rows = [], people = [], userId }) {
  const ranked = rows.filter(r => r.averageMs != null);
  return <section className="card scoreboard" aria-label="Repayment scoreboard">
    <div className="section-heading"><h2><Trophy size={21}/> The payback scoreboard</h2><span className="badge">Fastest first</span></div>
    <p className="muted">Average time to clear your share. Based on shared bills you can see.</p>
    {!ranked.length && <p className="notice">The first confirmed, fully repaid bill starts the rankings.</p>}
    <ol className="scoreboard-list">{rows.map(row => {
      const person = people.find(p => p.id === row.personId);
      const rank = row.averageMs == null ? null : ranked.findIndex(r => r.averageMs === row.averageMs) + 1;
      return <li key={row.personId} className={row.personId === userId ? 'scoreboard-you' : ''}>
        <span className="scoreboard-rank" aria-label={rank ? `Rank ${rank}` : 'Unranked'}>{rank ? `#${rank}` : '—'}</span>
        <Avatar name={person?.name || 'Friend'} small/>
        <div className="scoreboard-person"><strong>{person?.name || 'Friend'}{row.personId === userId ? ' (you)' : ''}</strong><small>{row.completedBills} timed {row.completedBills === 1 ? 'bill' : 'bills'} · {row.openBills} open{row.pendingBills ? ` · ${row.pendingBills} awaiting approval` : ''}</small>
          {row.oldestOpenAt && <small>Oldest open: {elapsedLabel(Math.max(0, Date.now() - Date.parse(row.oldestOpenAt)))}</small>}
          {row.untrackedBills > 0 && <small>{row.untrackedBills} older paid {row.untrackedBills === 1 ? 'bill has' : 'bills have'} incomplete timing</small>}
        </div>
        <strong className="scoreboard-time">{elapsedLabel(row.averageMs)}<small>average</small></strong>
      </li>;
    })}</ol>
    <details><summary>How the clock works</summary><p>Starts when the bill is sent. Stops at the final payment report that is later confirmed. Waiting for approval doesn’t slow your score. Partial payments and multiple recipients count as one bill only once your whole share is confirmed.</p><p>Rejected reports never count as paid and never restart the clock. Open bills stay visible above. Older bills without reliable timestamps are excluded from the average.</p></details>
  </section>;
}
