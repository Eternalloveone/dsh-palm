import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FILE = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const PLAIN = "import { processState } from './mobile/api/process-state.ts'"

const lines = readFileSync(FILE, 'utf8').split('\n')
const hasTyped = lines.some(line => line.includes('type OrdinarySearchSession'))
const next = hasTyped ? lines.filter(line => line !== PLAIN) : lines
writeFileSync(FILE, next.join('\n'))
console.log(`removed ${lines.length - next.length} plain import(s); typed import present: ${hasTyped}`)
