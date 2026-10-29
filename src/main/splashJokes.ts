// Shown on the splash, one at random per start. Kept short enough to sit under the name: a few lines, narrow.
export const JOKES: string[] = [
  `*** Netsplit: irc.eu.net <-> irc.us.net
    Everyone is quit. Nobody is surprised.`,

  `<ghost_> I swear I was online
*** ghost_ has quit (Ping timeout: 240 seconds)`,

  ` /\\_/\\
( o.o )  /join #cats
 > ^ <   *** Topic: mrrp`,

  `/msg bot xdcc send #42
...waiting in queue (position 1 of 3)
...waiting in queue (position 1 of 3)
...waiting in queue (position 1 of 3)`,

  `   |
  /|\\    Dolq: sharp enough
 / | \\   for IRC, blunt enough
   |     not to cut you.
  (_)`,

  `<dae> brb
<dae> (3 hours later)
<dae> back, did I miss anything?`,

  `*** mira sets mode: +o mira
<mira> power corrupts
*** mira was kicked by mira`,

  `* nova is now known as nova_
* nova_ is now known as nova__
* nova__ is now known as why_is_this_taken`,

  `<dae> hello?
        ... (lag: 47 s)
<nova> hi, 47 seconds ago`,
];

/** One joke, chosen with `random` (a number in [0, 1), Math.random by default). */
export function pickJoke(random: () => number = Math.random): string {
  return JOKES[Math.min(JOKES.length - 1, Math.floor(random() * JOKES.length))];
}
