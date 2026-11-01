/**
 * S25 首页/入口的阶段必须说得清（只读）。
 *
 * 守的格子：J1×I6（阶段显式）、J1×I9（失败可举证）。
 *
 * 用户场景：点开 app 看到首页——**现在到底是在跑、还是没在跑、还是连不上宿主**，
 * 必须一眼能分清；不许用"一直转圈的骨架"糊过去。
 *
 * 判据：
 *   ① 首页不是永久骨架：3 秒内要么出内容，要么出明确的空态/错误文案；
 *   ② 「运行中 N」徽标与宿主 `mobile.runningSessions` 同源（数字一致，差 1 就红）；
 *   ③ 宿主接口失败时首页要说明"连不上"，不能白屏装没事。
 */
import { homeUrl, rpc } from '../lib/env.mjs'

const STAGE_WORDS = /加载|正在|运行中|没有|空|失败|错误|连不上|重试|会话/

export const scenario = {
  id: 'home-stage-clarity',
  title: '首页阶段说得清：不永久骨架、徽标同源、失败明说',
  async run(ctx) {
    const { context, check } = ctx
    const page = await context.newPage()
    try {
      // ① 正常打开：3 秒内必须有"像样"的画面
      await page.goto(homeUrl(), { waitUntil: 'domcontentloaded' })
      let stageOk = false
      for (let i = 0; i < 30 && !stageOk; i += 1) {
        await page.waitForTimeout(200)
        stageOk = await page.evaluate(words => {
          const text = document.body.innerText ?? ''
          const hasSkeleton = document.querySelectorAll('[class*=skeleton], [class*=loading]').length > 0
          const hasContent = document.querySelectorAll('.mobile-row, [class*=workspace], [class*=project]').length > 0
          return new RegExp(words).test(text) && (hasContent || !hasSkeleton)
        }, STAGE_WORDS.source)
      }
      check('home-shows-a-stage-not-blank', stageOk, {})

      // ② 徽标与宿主同源：页面上读到的数字必须等于**同一时刻**宿主答复的条数。
      //    在跑的数量会变（别的会话刚好收工），所以取几次，任一次对上就算同源；
      //    一次都对不上才算缺陷。
      let badgeMatched = false
      let badgeSnapshot = {}
      for (let attempt = 0; attempt < 4 && !badgeMatched; attempt += 1) {
        const hostRunning = await rpc('mobile.runningSessions', {})
        const hostCount = (hostRunning?.value?.sessionIds ?? hostRunning?.sessionIds ?? []).length
        const badge = await page.evaluate(() => {
          const match = /运行中\s*(\d+)/.exec(document.body.innerText ?? '')
          return match === null ? 0 : Number(match[1])
        })
        badgeSnapshot = { badge, hostCount, attempt }
        badgeMatched = badge === hostCount
        if (!badgeMatched) await page.waitForTimeout(800)
      }
      check('running-badge-matches-host', badgeMatched, badgeSnapshot)

      // ③ 接口全失败：首页必须明说，不许白屏装没事
      await page.route('**/m/api/**', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"result":{"ok":false,"error":{"code":"internal","message":"boom"}}}' }))
      await page.goto(homeUrl(), { waitUntil: 'domcontentloaded' })
      let explained = false
      for (let i = 0; i < 40 && !explained; i += 1) {
        await page.waitForTimeout(250)
        explained = await page.evaluate(() => {
          const text = document.body.innerText ?? ''
          return /失败|错误|连不上|重试|稍后/.test(text) && text.trim().length > 0
        })
      }
      check('home-explains-when-host-fails', explained, {})
      await page.unroute('**/m/api/**')
    } finally {
      await page.close()
    }
  },
}
