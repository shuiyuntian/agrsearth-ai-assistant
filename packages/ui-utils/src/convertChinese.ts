/**
 * 文件作用：简繁转换统一封装（模板仓 vendored 共享包 @cesiumai/ui-utils）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-09-14
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-09-14) 自平台仓 extensions/_shared/ui-utils/src/convertChinese.ts vendor
 *                       （内容同源；opencc-js 字典由平台宿主统一提供，构建时将 opencc-js 列为 external）
 *
 * 版权所有 (C) 2026 CesiumAI 项目
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
