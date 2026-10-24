// shared/config.js
// Game balance numbers used by BOTH the server (authoritative) and the client (HUD / aim assist).
// Change a number here, restart the server, and the whole game follows.
export const GAME = {
  // players
  playerHp: 100,
  attackRange: 2.8,        // metres
  attackDamage: 34,        // zombieHp 60 -> two hits per zombie
  attackCooldown: 0.55,    // seconds (the server accepts a swing a little earlier to forgive network jitter)
  attackCone: 0.35,        // cos of the half-angle in front of the player that a swing can hit (~70 degrees)
  attackMax: 2,            // zombies hit by a single swing
  respawnDelay: 6,         // seconds a fallen player waits
  spawnShield: 3,          // seconds of invulnerability after (re)spawning
  regenDelay: 6,           // seconds without damage before health regenerates
  regenRate: 2,            // hp per second

  // zombies
  zombieCount: 14,
  zombieHp: 60,
  zombieAggro: 20,         // start chasing a player closer than this
  zombieLose: 30,          // stop chasing beyond this
  zombieWalk: 0.9,         // m/s while wandering
  zombieChase: 3.4,        // m/s (player walks 5.2, runs 9: you can always outrun them)
  zombieReach: 1.5,
  zombieRadius: 0.45,
  zombieDamage: 12,
  zombieWindup: 0.5,       // seconds between reaching a player and the first bite (a hit interrupts it)
  zombieAttackCooldown: 1.1,
  zombieRespawn: 20,       // seconds until a killed zombie is replaced somewhere far away

  // missions
  killGoal: 15,
};

// zombie animation / AI states (sent to clients)
export const ZST = { IDLE: 0, WALK: 1, CHASE: 2, ATTACK: 3, STUN: 4 };
