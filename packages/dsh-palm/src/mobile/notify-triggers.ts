/**
 * 通知「触发条件」输入框的解析（秒 / 分钟 → 毫秒）。
 *
 * 单独抽出来是因为这里有一个真出过的坑：`Number('')` 是 **0**，而 0 是一个合法的
 * 阈值/间隔 —— 用户把输入框清空后点保存，手机上会写进「回复超过 0 秒就通知」，
 * 于是每条回复都弹一次。空值、纯空格、非整数一律判为无效，让调用方把提示打出来。
 */

/** 两个输入框解析成功后的毫秒值。 */
export interface NotifyTriggerValues {
  turnThresholdMs: number
  turnCooldownMs: number
}

/**
 * 解析两个输入框的文本；任何一个不合法就返回 undefined。
 *
 * 只接受十进制非负整数（iOS 数字键盘给出的就是这种）。上限取 24 小时：
 * 再大的阈值等于永远不通知，用户多半是手滑多按了几个 0。
 */
export function parseNotifyTriggerInputs(secondsText: string, minutesText: string): NotifyTriggerValues | undefined {
  const seconds = secondsText.trim()
  const minutes = minutesText.trim()
  if (seconds === '' || minutes === '') return undefined
  if (!/^\d+$/.test(seconds) || !/^\d+$/.test(minutes)) return undefined
  const secondsValue = Number(seconds)
  const minutesValue = Number(minutes)
  if (!Number.isSafeInteger(secondsValue) || !Number.isSafeInteger(minutesValue)) return undefined
  if (secondsValue > 86_400 || minutesValue > 1_440) return undefined
  return {
    turnThresholdMs: secondsValue * 1_000,
    turnCooldownMs: minutesValue * 60_000,
  }
}
