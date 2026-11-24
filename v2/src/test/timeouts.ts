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
 *
 * Also a test that loads the app's modules afresh (vi.resetModules, then
 * import) as the first of its file, which pays for transforming them too:
 * main.ts booted with the real auth store, the app shell's modules with
 * storage blocked. Alone that takes 0.6–1.1 s; on a machine running several
 * suites at once it took over 5 s, and the next test in the file then failed
 * too, as the first one's imports finished under it. Loading a module waits
 * for no timer and no network, so it has nothing to hang on either.
 */
export const CPU_BOUND_MS = 30_000
