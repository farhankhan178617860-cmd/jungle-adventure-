// shared/missions.js
// ---------------------------------------------------------------------------
// Mission definitions. Add a new mission here (plus a validator in
// server/missions.js) and the HUD will show it automatically.
//   event  : name of the action that advances the mission
//   goal   : how many distinct items must be reported
//   server : true -> only the server can advance it (e.g. kills); clients cannot report it
// ---------------------------------------------------------------------------
import { GAME } from './config.js';

export function missionDefs(world) {
  return [
    {
      id: 'relics', event: 'collect',
      title: 'प्राचीन अवशेष',
      desc: 'हर रुइन्स की वेदी से चमकता अवशेष उठाओ',
      goal: world.relics.length,
    },
    {
      id: 'explore', event: 'visit',
      title: 'रुइन्स की खोज',
      desc: 'जंगल के सभी पुराने रुइन्स में कदम रखो',
      goal: world.ruins.length,
    },
    {
      id: 'zombies', event: 'kill', server: true,
      title: 'ज़ॉम्बी शिकारी',
      desc: `सब मिलकर ${GAME.killGoal} ज़ॉम्बी मारो`,
      goal: GAME.killGoal,
    },
  ];
}
