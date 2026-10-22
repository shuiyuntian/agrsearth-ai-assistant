/**
 * 文件作用：简繁转换统一封装（平台级共享）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-20
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-20) 初始创建：提供 convertText(text, 's2t'|'t2s') 统一 API
 *                       与 useChineseConvert 组合式函数；opencc-js 字典（约 1MB）
 *                       由平台宿主统一提供（import map /esm-libs/opencc-js.mjs +
 *                       UMD 回退 window.OpenCC），扩展包构建时须将 opencc-js 列为
 *                       external，不再各自打包字典
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */
import OpenCC from 'opencc-js'

/** 转换方向：s2t 简体→繁体（台湾），t2s 繁体（台湾）→简体 */
export type ConvertDirection = 's2t' | 't2s'

type Converter = (text: string) => string

/** 转换器按需创建并缓存，避免重复加载字典 */
const converters: Partial<Record<ConvertDirection, Converter>> = {}

function getConverter(direction: ConvertDirection): Converter {
  if (!converters[direction]) {
    converters[direction] = direction === 's2t'
      ? OpenCC.Converter({ from: 'cn', to: 'tw' })
      : OpenCC.Converter({ from: 'tw', to: 'cn' })
  }
  return converters[direction]!
}

/**
 * 简繁转换
 * @param text - 待转换文本
 * @param direction - 's2t' 简体转繁体；'t2s' 繁体转简体
 * @returns 转换后的文本；空值原样返回
 */
export function convertText(text: string | undefined | null, direction: ConvertDirection): string | undefined | null {
  if (!text) return text
  return getConverter(direction)(String(text))
}

/**
 * 简繁转换组合式函数
 * @returns convertText 及 toSimplified/toTraditional 便捷方法
 */
export function useChineseConvert() {
  /** 繁体 → 简体 */
  const toSimplified = (text: string | undefined | null) => convertText(text, 't2s')
  /** 简体 → 繁体 */
  const toTraditional = (text: string | undefined | null) => convertText(text, 's2t')

  return { convertText, toSimplified, toTraditional }
}
