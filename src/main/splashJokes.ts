// Shown on the splash, one at random per start: well-known chat memes, drawn as a small figure with the chat lines beside it.
// Kept short enough to sit under the name: six lines, narrow.
export const JOKES: string[] = [
  // Hello there / General Kenobi
  `  O     <obiwan> Hello there!
 /|\\==-
 / \\
 \\O/    <grievous> General Kenobi!
 -|-
 / \\`,

  // Press F to pay respects
  `  .---.      <dae> prod just went down. my fault.
 / RIP \\     <nova> F
 | prod |    <mira> F
 |______|    <kai> F
             <bot> F`,

  // Wait, it's all...? Always has been
  ` _O_    <dae> wait, it's all just text over TCP?
  |
 / \\
    O=- <nova> *click* always has been.
   /|
   / \\`,

  // Sir, this is a Wendy's
  ` @(o o)@    <dae> how do I fix my graphics driver?
  ( v )     <mod> Sir, this is a #wendys
   \\_/      *** dae was kicked by mod`,

  // You shall not pass
  `    /\\      *** balrog has joined #moria
   /__\\     *** gandalf sets mode: +b balrog
  ( oo )|   <gandalf> YOU SHALL NOT PASS!
  /|vv|\\|   *** balrog was kicked by gandalf
   |  |`,

  // The typing bubble that ends in k.
  ` .--------.    nova is typing...
 |  . . . |    nova is typing...
 '-.------'    nova is typing...
   |/          <nova> k.`,

  // Rickroll
  `  ,@@@,     <dae> found the docs for the new API
  (o_o)     <dae> https://youtu.be/dQw4w9WgXcQ
 \\/|~|\\/    *** nova quit (never gonna give you up)
   / \\`,

  // This is fine
  `  ( ) ) ( )  (    *** netsplit: 9000 users quit
 ) ( ( ) ( )  )   *** Topic: everything is on fire
   /\\_/\\   _
  ( o.o )_[_]     <dae> this is fine. :)
   > ^ <   |
  ------------`,

  // Left on read
  ` .-------.    <dae> hey
 | hey   |    <dae> hello?
 | hello?|    <dae> you there?
 | Seen  |    -NickServ- nova last seen 3 days ago
 '-------'`,

  // Ah shit, here we go again
  `   ___      *** Connection lost (Ping timeout)
  (o_o)     *** Reconnecting...
 /|[=]|\\    Ah shit, here we go again.
  | | |
 _/ \\_/`,
];

/** One joke, chosen with `random` (a number in [0, 1), Math.random by default). */
export function pickJoke(random: () => number = Math.random): string {
  return JOKES[Math.min(JOKES.length - 1, Math.floor(random() * JOKES.length))];
}
