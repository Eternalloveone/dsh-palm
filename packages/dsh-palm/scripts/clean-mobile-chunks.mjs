/**
 * 清掉上一次构建留在 lib/mobile 里的分块。
 *
 * 为什么需要：手机端的分块文件名带内容哈希（shared-<hash>.js、ChatView-<hash>.js），
 * 而 tsdown 的三段产物共用一个 outDir，`clean` 必须关掉（否则会把 node 半身与
 * client 半身互相清空）。于是每次构建都多出一整套新哈希，旧的从不消失——实测累积
 * 到 157 个分块、27 MB，被 `files: lib/**` 原样打进发布包（34 MB 压缩 / 124 MB 解压）。
 *
 * 只删 lib/mobile 目录，不碰 lib/mobile.js（入口）、lib/index.js、lib/client.js 与
 * 类型声明。构建失败时旧分块已删，但入口文件仍在，下一次构建会补齐。
 */
import { rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const target = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'mobile')
rmSync(target, { recursive: true, force: true })