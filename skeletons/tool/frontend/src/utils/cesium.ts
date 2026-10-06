/**
 * 文件作用：Cesium 全局对象取用工具（宿主经 window.Cesium 提供运行时——球平台 import map 无
 *          cesium 键，扩展 ESM 产物禁止裸 import 'cesium'；契约见 @cesiumai/vite-config 的
 *          contracts/gis-platform-ui.host-contract.json 快照注记）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-10-06
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-10-06) 模板仓骨架内置（对齐平台仓 measure 等在架包 getCesium 模式）：
 *     实体/相机/颜色等 Cesium 对象一律经本工具取 window.Cesium
 *
 * 版权所有 (C) 2026 CesiumAI 项目
 */

/** 取宿主加载的 Cesium 全局对象（window.Cesium） */
export function getCesium(): any {
  const C = (window as any).Cesium
  if (!C) {
    throw new Error('[extension] window.Cesium 未就绪（须在球平台宿主内激活）')
  }
  return C
}
