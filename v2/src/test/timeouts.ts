/**
 * The time limit for a test that checks a rule over many cases in one loop:
 * random trip forms against random logs, every catalogue coast in every wind
 * direction, every change of water type on a 0.1° grid, a log of 200 cards
 * typed into. Vitest's default is 5 s. These take 0.2–0.8 s alone, but a
 * full run on a busy machine ran them many times slower: the trip-form test
 * took 0.8 s alone and 5.4 s, once 11 s, beside the rest of the suite. A test
 * over its limit fails `npm test`, and so the deploy.
 *
 * A larger limit costs no hang detection here: Vitest can't stop a
 * synchronous loop at its limit (it fails the test once the loop has ended
 * late), and a test that awaits only Vue's next tick has nothing to hang on.
 * A test that waits for timers or the network keeps the default.
 */
export const CPU_BOUND_MS = 30_000
