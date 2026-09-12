import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const REPO = process.env.DSH_PALM_REPO ?? resolve(HERE, '..')
const s = readFileSync(join(REPO, 'packages', 'dsh-palm', 'src', 'mobile', 'mobile-styles.ts'), 'utf8')
const start = s.indexOf('= `') + 2
const end = s.lastIndexOf('`')
const css = s.slice(start, end)
const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
const min = noComments.replace(/[ \t\r\n]+/g, ' ').replace(/ ?([{}:;,>~+]) ?/g, '$1').trim()
const pct = (a, b) => Math.round((1 - a / b) * 100)
console.log('raw chars:', css.length)
console.log('no-comments:', noComments.length, '(-' + pct(noComments.length, css.length) + '%)')
console.log('minified(light):', min.length, '(-' + pct(min.length, css.length) + '%)')
