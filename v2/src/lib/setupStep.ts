/** A step of the setup: Tidsvinduer (step 1), then Lokationer. Their route names. */
export type SetupStep = 'availability' | 'locations'

/**
 * The first step a setup lacks: its time windows, then a spot. null when it
 * has both, a whole setup (stores/setup hasSetup). The dashboard sends a
 * visit with no setup back to the welcome page (router), so Find pladser's
 * and Målarter's way on leads here first. With time windows made and no
 * spot yet, "Start opsætning" sent that visit back to step 1.
 */
export function firstMissingStep(s: { availability: readonly unknown[]; locations: readonly unknown[] }): SetupStep | null {
  if (!s.availability.length) return 'availability'
  if (!s.locations.length) return 'locations'
  return null
}

/** The way on's label to each step (lib/strings keys): the setup starts at step 1, else goes on. */
export const SETUP_STEP_LABEL: Record<SetupStep, string> = {
  availability: 'setup_start',
  locations: 'setup_continue',
}
