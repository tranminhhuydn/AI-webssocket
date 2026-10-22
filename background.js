
const DEFAULT_WS_URL = "ws://localhost:3000/ws";
let wsUrl = DEFAULT_WS_URL;
let disconnectRequested = false;
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
function connectWS(port) {
  if (port !== undefined && port !== null && String(port).trim() !== "") {
    const parsedPort = Number.parseInt(String(port), 10);
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      throw new Error("Port must be an integer between 1 and 65535");
    }
    wsUrl = `ws://localhost:${parsedPort}/ws`;
  }

  disconnectRequested = false;
  clearTimeout(reconnectTimer);

  if (socket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(socket.readyState)) {
    if (socket.url === wsUrl) return;
    const previousSocket = socket;
    socket = null;
    previousSocket.close();
  }

  const ws = new WebSocket(wsUrl);
  socket = ws;

  ws.addEventListener("open", () => {
    console.info("[AI Lexicon] WebSocket connected:", wsUrl);
    notifyConnectionState("WS_CONNECTED");

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
    notifyConnectionState("WS_DISCONNECTED");
    if (!disconnectRequested) scheduleReconnect();
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

  // Server notifications không có id; xử lý welcome trước khi bỏ qua notification khác.
  if (message.id === undefined || message.id === null) {
    if (message.method === "notifications/ai-lexicon/welcome") {
      const greeting =
        typeof message.params?.message === "string"
          ? message.params.message
          : "AI Lexicon connected";

      chrome.runtime.sendMessage({
        type: "AI_LEXICON_WELCOME",
        message: greeting,
        server: message.params?.server,
        version: message.params?.version,
      }).catch(() => {
        // Không có popup hoặc extension page đang lắng nghe; lời chào vẫn có trong Service Worker console.
      });
      return;
    }

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
  if (disconnectRequested) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWS();
  }, RECONNECT_DELAY);
}

function disconnectWS() {
  disconnectRequested = true;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  initialized = false;
  toolNames.clear();
  rejectPendingRequests(new Error("AI Lexicon WebSocket disconnected by user"));

  const currentSocket = socket;
  socket = null;
  if (currentSocket && currentSocket.readyState < WebSocket.CLOSING) {
    currentSocket.close(1000, "Disconnected by user");
  }

  notifyConnectionState("WS_DISCONNECTED");
  return { ok: true, connected: false, url: wsUrl };
}

function notifyConnectionState(type) {
  chrome.runtime.sendMessage({ type, url: wsUrl }).catch(() => {
    // Popup/content script may not be open.
  });
}

/**
 * Action handlers: định tuyến theo message.action.
 * Thêm action mới tại đây, không cần thêm if.
 */
const methods = Object.freeze({
  connectWS: (message) => {
    connectWS(message.port);
    return { ok: true, status: "connecting", url: wsUrl };
  },

  disconnectWS: () => disconnectWS(),

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
