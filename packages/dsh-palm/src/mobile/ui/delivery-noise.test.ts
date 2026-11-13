/**
 * 交付判据的契约：只把"看完就扔"的东西判成噪声，真实产出一个都不能误杀。
 */
import { describe, expect, it } from 'vitest'
import { hasMeaningfulDelivery, isNoiseArtifact } from './delivery-noise.ts'

describe('isNoiseArtifact（什么不算交付）', () => {
  it('日志 / 临时 / 缓存 / 映射文件是噪声', () => {
    expect(isNoiseArtifact('/a/run.log')).toBe(true)
    expect(isNoiseArtifact('C:\\t\\x.tmp')).toBe(true)
    expect(isNoiseArtifact('/a/b.map')).toBe(true)
    expect(isNoiseArtifact('/a/b.bak')).toBe(true)
    expect(isNoiseArtifact('/a/b.cache')).toBe(true)
  })

  it('工具脚本是噪声（脚本是过程，不是产出）', () => {
    expect(isNoiseArtifact('D:\\work\\dsh-palm\\patch.mjs')).toBe(true)
    expect(isNoiseArtifact('/a/deploy.ps1')).toBe(true)
    expect(isNoiseArtifact('/a/x.bat')).toBe(true)
  })

  it('依赖 / 版本库 / 临时目录是噪声', () => {
    expect(isNoiseArtifact('/repo/node_modules/x/index.js')).toBe(true)
    expect(isNoiseArtifact('C:\\repo\\.git\\config')).toBe(true)
    expect(isNoiseArtifact('/a/tmp/out.txt')).toBe(true)
  })

  it('真实产出一个都不误杀', () => {
    expect(isNoiseArtifact('src/mobile/views/ChatView.tsx')).toBe(false)
    expect(isNoiseArtifact('README.md')).toBe(false)
    expect(isNoiseArtifact('styles/370-v21.css')).toBe(false)
    expect(isNoiseArtifact('packages/dsh-palm/package.json')).toBe(false)
    expect(isNoiseArtifact('firmware/esppet_config.c')).toBe(false)
  })

  it('空路径当噪声（画不出任何东西）', () => {
    expect(isNoiseArtifact('')).toBe(true)
  })
})

describe('hasMeaningfulDelivery（这一轮值不值得一张卡）', () => {
  it('全是噪声 → 不出卡', () => {
    expect(hasMeaningfulDelivery(['/a/x.log', '/a/patch.mjs'])).toBe(false)
  })

  it('只要有一个真实产出 → 出卡', () => {
    expect(hasMeaningfulDelivery(['/a/x.log', 'src/App.tsx'])).toBe(true)
  })

  it('没有产物 → 不出卡', () => {
    expect(hasMeaningfulDelivery([])).toBe(false)
  })
})
