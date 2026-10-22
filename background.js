
const WS_URL = "ws://localhost:3000/ws";
const CLIENT_INFO = {
  name: "ai-lexicon-chrome-extension",
  version: "1.0.0",
};
const PROTOCOL_VERSION = "2025-03-26";
const RECONNECT_DELAY = 3000;
const REQUEST_TIMEOUT = 20000;

let socket = null;
let nextId = 1;
let reconnectTimer = null;
let initialized = false;

const pending = new Map();
const toolNames = new Set();

/**
 * Kết nối tới AI Lexicon MCP WebSocket server.
 */
function connectWS() {
  if (
    socket &&
    [WebSocket.CONNECTING, WebSocket.OPEN].includes(socket.readyState)
  ) {
    return;
  }

  clearTimeout(reconnectTimer);

  const ws = new WebSocket(WS_URL);
  socket = ws;

  ws.addEventListener("open", () => {
    console.info("[AI Lexicon] WebSocket connected");

    initializeMCP(ws).catch((error) => {
      console.error("[AI Lexicon] MCP initialization failed:", error);
      ws.close();
    });
  });

  ws.addEventListener("message", ({ data }) => {
    handleWSMessage(data);
  });

  ws.addEventListener("error", (error) => {
    console.error("[AI Lexicon] WebSocket error:", error);
  });

  ws.addEventListener("close", () => {
    // Bỏ qua sự kiện từ socket cũ.
    if (socket !== ws) return;

    socket = null;
    initialized = false;
    toolNames.clear();

    rejectPendingRequests(
      new Error("AI Lexicon WebSocket disconnected"),
    );

    console.warn("[AI Lexicon] WebSocket disconnected");
    scheduleReconnect();
  });
}

/**
 * Khởi tạo MCP session và lấy danh sách tools.
 */
async function initializeMCP(ws) {
  await sendRequest("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: CLIENT_INFO,
  });

  if (socket !== ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("WebSocket disconnected during initialization");
  }

  ws.send(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
  );

  const result = await sendRequest("tools/list", {});

  if (socket !== ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("WebSocket disconnected while loading tools");
  }

  toolNames.clear();

  for (const tool of result?.tools ?? []) {
    if (typeof tool.name === "string") {
      toolNames.add(tool.name);
    }
  }

  initialized = true;

  console.info("[AI Lexicon] MCP initialized");
  console.info("[AI Lexicon] Available tools:", [...toolNames]);
}

/**
 * Xử lý JSON-RPC response từ server.
 */
function handleWSMessage(data) {
  let message;

  try {
    message = JSON.parse(data);
  } catch {
    console.error("[AI Lexicon] Invalid JSON response:", data);
    return;
  }

  // Message không có id là notification.
  if (message.id === undefined || message.id === null) {
    console.debug("[AI Lexicon] Server notification:", message);
    return;
  }

  const request = pending.get(message.id);

  if (!request) {
    console.warn("[AI Lexicon] Unmatched response id:", message.id);
    return;
  }

  clearTimeout(request.timer);
  pending.delete(message.id);

  if (message.error) {
    request.reject(
      new Error(
        message.error.message || "AI Lexicon JSON-RPC request failed",
      ),
    );
    return;
  }

  request.resolve(message.result);
}

/**
 * Gửi JSON-RPC request và chờ phản hồi.
 */
function sendRequest(method, params = {}) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("WebSocket is not connected"));
  }

  const id = nextId++;
  const ws = socket;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Request timed out: ${method}`));
    }, REQUEST_TIMEOUT);

    pending.set(id, { resolve, reject, timer });

    try {
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          method,
          params,
        }),
      );
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      reject(error);
    }
  });
}

/**
 * Gọi MCP tool theo tên.
 */
async function callTool(name, args = {}) {
  if (!initialized) {
    throw new Error("AI Lexicon MCP is not initialized");
  }

  if (typeof name !== "string" || !toolNames.has(name)) {
    throw new Error(`Unknown MCP tool: ${name}`);
  }

  if (
    args === null ||
    typeof args !== "object" ||
    Array.isArray(args)
  ) {
    throw new Error("Tool arguments must be an object");
  }

  return sendRequest("tools/call", {
    name,
    arguments: args,
  });
}

/**
 * Trả trạng thái kết nối.
 */
function getStatus() {
  return {
    connected: socket?.readyState === WebSocket.OPEN,
    initialized,
    tools: [...toolNames],
  };
}

/**
 * Từ chối các request đang chờ khi socket đóng.
 */
function rejectPendingRequests(error) {
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(error);
  }

  pending.clear();
}

/**
 * Lên lịch kết nối lại.
 */
function scheduleReconnect() {
  clearTimeout(reconnectTimer);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWS();
  }, RECONNECT_DELAY);
}

/**
 * Action handlers: định tuyến theo message.action.
 * Thêm action mới tại đây, không cần thêm if.
 */
const methods = Object.freeze({
  aiLexiconCall: async (message) => {
    const tool = message.tool || "answer";
    const args = message.arguments ?? {};

    const result = await callTool(tool, args);

    return {
      ok: true,
      result,
    };
  },

  aiLexiconStatus: () => ({
    ok: true,
    ...getStatus(),
  }),
  "notifications/ai-lexicon/welcome": (message) => {
    const greeting =
      message.params?.message || "AI Lexicon connected";

    console.info("[AI Lexicon] Server:", greeting);

    chrome.runtime.sendMessage({
      action: "aiLexiconWelcome",
      message: greeting,
    }).catch(() => {
      // Không có content script đang lắng nghe.
    });
  }
});

/**
 * Message dispatcher từ content.js hoặc extension pages.
 */
chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    const handler = methods[message?.action];

    if (typeof handler !== "function") {
      return false;
    }

    Promise.resolve()
      .then(() => handler(message, sender))
      .then(sendResponse)
      .catch((error) => {
        console.error(
          `[AI Lexicon] ${message.action} failed:`,
          error,
        );

        sendResponse({
          ok: false,
          error: error.message || "Unexpected error",
        });
      });

    // Giữ sendResponse mở cho xử lý bất đồng bộ.
    return true;
  },
);

// Khởi động kết nối khi service worker chạy.
connectWS();
