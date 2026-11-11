/**
 * Both UI languages' string tables, for the tests (and the model checks) that
 * compare against the text itself. The app reads them only through t(), and
 * reaches the English one only by i18n.ts's dynamic import, which keeps it
 * out of the main chunk; a test may import it like this.
 */
import { STRINGS_DA } from '@/lib/strings'
import { STRINGS_EN } from '@/lib/strings.en'

export const STRINGS: Record<string, Record<string, string>> = { da: STRINGS_DA, en: STRINGS_EN }
