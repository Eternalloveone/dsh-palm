import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'ModelView.test.tsx')
let text = readFileSync(P, 'utf8')

if (!text.includes('重新加载')) {
  text = text.replace(
    "import { cleanup, render, screen, waitFor } from '@testing-library/react'",
    "import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'",
  )

  const block = [
    '',
    "  it('加载失败时给重试入口，点了会重新拉一次（不让人重进页面）', async () => {",
    "    modelsFn.mockRejectedValueOnce(new Error('boom'))",
    "    render(<ModelView sessionId=\"s1\" onBack={() => {}} />)",
    "    const retry = await screen.findByText('重新加载')",
    "    modelsFn.mockResolvedValueOnce(catalog())",
    "    fireEvent.click(retry)",
    '    await waitFor(() => { expect(modelsFn).toHaveBeenCalledTimes(2) })',
    '  })',
    '',
  ].join('\r\n')

  // 插在最后一个 describe 的收尾之前
  const end = text.lastIndexOf('})')
  text = text.slice(0, end) + block + text.slice(end)
  writeFileSync(P, text)
}

console.log('已加重试测试:', text.includes('重新加载'))
