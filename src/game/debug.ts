import { createFranchise, getTeam } from './season';
import { Match } from './match';
import { WEATHER } from './data';

const seed = 11;
const franchise = createFranchise(seed);
const week = franchise.schedule[0];
const opponent = getTeam(franchise, week.opponentId);
const match = new Match({
  franchise,
  opponent,
  week,
  weather: WEATHER[week.weather],
  seed: seed + 7,
});
match.begin();
let steps = 0;
let plays = 0;
let lastPhase = '';
while (match.phase !== 'final' && steps < 120000) {
  steps++;
  const phase = match.phase;
  if (phase === 'playcall') {
    const pick = match.cards[(seed + steps * 13) % match.cards.length];
    console.log(
      `\n[${match.state.quarter}Q ${match.state.clock.toFixed(1)}] ${match.state.down}&${match.state.toGo} at ${match.state.spot} | ${pick.name} (${pick.kind}) vs ${match.defenseHint.label} | score ${match.state.scoreUs}-${match.state.scoreThem}`,
    );
    match.choosePlay(pick.id);
    plays++;
  } else if (phase === 'ready') {
    match.update(1 / 60);
  } else if (phase === 'live') {
    const sim = match.sim!;
    if (sim.phase === 'dropback' && sim.isPass && sim.elapsed > 1.9) {
      const reads = sim.getReads().sort((a, b) => b.percent - a.percent);
      if (reads[0]) {
        console.log(`  READ ${reads[0].slot} ${reads[0].percent}%`);
        match.throwAt(reads[0].projected.x, reads[0].projected.y);
      }
    }
    if (sim.phase === 'carry') {
      const gap = sim.play.runGap;
      match.setStick(1, gap === 'right' ? 0.35 : gap === 'left' ? -0.35 : 0.1, sim.elapsed > 0.6);
    } else match.setStick(0, 0, false);
    match.update(1 / 60);
  } else if (phase === 'result') {
    const o = match.lastOutcome!;
    console.log(
      `  -> ${o.kind.toUpperCase()} ${o.yards >= 0 ? '+' : ''}${o.yards} | ${o.description} | clock ${match.state.clock.toFixed(1)} | ${match.state.down}&${match.state.toGo} at ${match.state.spot} | rewinds ${match.state.rewinds}`,
    );
    match.advance();
  } else if (phase === 'fourth') {
    console.log('  4TH DOWN DECISION', match.fieldGoalDistance);
    match.chooseFourth(match.canGoForFieldGoal ? 'fg' : 'go');
  } else if (phase === 'kick') {
    match.update(1 / 60);
    if (match.kick && match.kick.pos > 0.45) match.kickNow();
  } else if (phase === 'defense') {
    if (!match.drive && lastPhase !== 'defense') console.log('  defense without a drive?');
    if (match.drive && match.driveRevealed === 0 && lastPhase !== 'defense') {
      console.log('  DEFENSE:', match.drive.plays.map((p) => p.text).join(' / '), '| next', match.drive.nextSpot);
    }
    match.update(1 / 60);
  } else if (phase === 'quarter' || phase === 'halftime') {
    console.log('  BREAK', phase, match.state.scoreUs, match.state.scoreThem);
    match.continueQuarter();
  } else {
    match.update(1 / 60);
  }
  lastPhase = phase;
}
console.log('\nFINAL', match.state.scoreUs, match.state.scoreThem, 'plays', plays);
console.log('stats', JSON.stringify(match.stats, null, 1));
console.log('summary', match.getSummary());
