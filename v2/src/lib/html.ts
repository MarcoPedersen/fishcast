/**
 * HTML escaping for the few places that hand markup STRINGS to a library rather
 * than rendering through a Vue template: Leaflet popups and divIcons, which
 * Leaflet writes with `innerHTML`. Vue escapes {{ }} for us; these strings
 * bypassed that entirely.
 *
 * Location names are untrusted. A shared setup link, a Nominatim reverse-geocode
 * (crowd-edited OSM data) or the user can supply one, and it syncs to every
 * device on the account. A name like `Molen<img src=x onerror=…>` ran script the
 * moment its pin's popup opened, with the Supabase session in localStorage
 * within reach.
 */

const ENTITIES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}

/** Escape a value for use as HTML text or inside a quoted attribute. */
export function escapeHtml(value: unknown): string {
  if (value == null || value === false) return ''
  return String(value).replace(/[&<>"']/g, (c) => ENTITIES[c])
}

/** Markup that has already been escaped, so html`` passes it through as-is. */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string { return this.value }
}

/**
 * Tagged template that escapes EVERY interpolated value, except nested html``
 * fragments (already escaped). Escaping by default means a field added to a
 * popup later is safe without anyone remembering to wrap it — forgetting one
 * value is exactly how the original hole happened.
 *
 * `null`, `undefined` and `false` render as nothing, so `${cond && html`…`}`
 * and `${cond ? html`…` : ''}` both work.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0]
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    out += (v instanceof SafeHtml ? v.value : escapeHtml(v)) + strings[i + 1]
  }
  return new SafeHtml(out)
}
