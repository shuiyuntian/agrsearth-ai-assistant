#!/usr/bin/env node
// 文件作用：mock-browser Node ES 模块
// 作者：JasonLee <shuiyuntian@foxmail.com>
// 创建日期：2026-07-22
// 版本：1.0.0
// 修改记录：
//   - 1.0.0 (2026-07-22) 初始创建
//
// 版权所有 (C) 2026 AGRSEarth 项目

/**
 * mock-browser —— 模拟浏览器端 Cesium 应用：
 *  1. 连 orchestrator 的 GET /channel/events?sessionId=test（SSE）；
 *  2. 收到 command 帧 → 打印，并 POST /channel/result {id, result:{success:true, mock:true}}。
 *
 * 用法：node scripts/mock-browser.mjs [sessionId] [baseUrl]
 */
const sessionId = process.argv[2] ?? "test";
const baseUrl = process.argv[3] ?? "http://localhost:9600";

const eventsUrl = `${baseUrl}/channel/events?sessionId=${encodeURIComponent(sessionId)}`;
const resultUrl = `${baseUrl}/channel/result`;

console.log(`[mock-browser] connecting ${eventsUrl}`);

const resp = await fetch(eventsUrl, {
  headers: { Accept: "text/event-stream" },
});
if (!resp.ok || !resp.body) {
  console.error(`[mock-browser] connect failed: HTTP ${resp.status}`);
  process.exit(1);
}
console.log(`[mock-browser] connected as session "${sessionId}"`);

const reader = resp.body.getReader();
const decoder = new TextDecoder();
let buffer = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });

  let idx;
  while ((idx = buffer.indexOf("\n\n")) !== -1) {
    const frame = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 2);
    for (const line of frame.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      await handleFrame(data);
    }
  }
}

console.log("[mock-browser] disconnected");

async function handleFrame(data) {
  let msg;
  try {
    msg = JSON.parse(data);
  } catch {
    console.warn(`[mock-browser] bad frame: ${data.slice(0, 120)}`);
    return;
  }

  if (msg.type !== "command") {
    console.log(`[mock-browser] event: ${data}`);
    return;
  }

  const cmd = msg.command;
  console.log(`[mock-browser] command ${cmd.id} type=${cmd.type} args=${JSON.stringify(cmd)}`);

  // 模拟浏览器执行成功，按命令类型回传 schema 需要的结果字段
  // （MCP 侧 tool handler 会从 result 里取 actualDuration / position / entities 等
  //   构造 output 并过 zod outputSchema 校验）
  const result = buildMockResult(cmd);
  const body = { id: cmd.id, result };
  const r = await fetch(resultUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  console.log(`[mock-browser] result ${cmd.id} -> HTTP ${r.status}`);
}

function buildMockResult(cmd) {
  switch (cmd.type) {
    case "camera_fly_to":
      return { success: true, mock: true, actualDuration: cmd.duration ?? 3 };
    case "camera_get_position":
      return {
        success: true,
        mock: true,
        position: { longitude: 116.4074, latitude: 39.9042, height: 5000 },
        orientation: { heading: 0, pitch: -15, roll: 0 },
      };
    case "entity_list":
      return { success: true, mock: true, entities: [], count: 0 };
    case "entity_remove":
      return {
        success: true,
        mock: true,
        removedEntityId: cmd.entityId ?? "mock-entity",
        removedEntityName: cmd.namePattern ?? "mock",
        removedCount: 1,
      };
    default:
      return { success: true, mock: true };
  }
}
