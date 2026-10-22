
"use strict";

/**
 * AI Lexicon - Content Script
 *
 * Responsibilities:
 * - Kiểm tra domain được phép hoạt động.
 * - Tìm ô nhập liệu ChatGPT/Gemini.
 * - Điền nội dung vào ô chat và gửi.
 * - Gửi câu hỏi đến AI Lexicon thông qua background.js.
 * - Phát hiện thao tác sao chép câu trả lời.
 */

const AI_LEXICON_CONFIG = Object.freeze({
  defaultTool: "answer",
  copyDelay: 500,
  supportedHosts: [
    "chatgpt.com",
    "chat.openai.com",
    "gemini.google.com",
  ],
});

let aiLexiconInitialized = false;
let copyListenersInstalled = false;
let lastCopiedText = "";
let lastCopiedAt = 0;

/**
 * Kiểm tra hostname có thuộc domain hỗ trợ không.
 */
function isSupportedHost(hostname = window.location.hostname) {
  return AI_LEXICON_CONFIG.supportedHosts.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`),
  );
}

/**
 * Đọc cấu hình domainToggle từ Chrome storage.
 *
 * Tương thích với cấu hình domainToggle dạng:
 * - boolean
 * - array các domain
 * - object chứa danh sách domain
 *
 * Nếu dự án đang dùng cấu trúc khác, cần điều chỉnh hàm này
 * theo schema thực tế trong storage.
 */
async function isDomainEnabled() {
  if (!chrome?.storage?.sync) {
    return isSupportedHost();
  }

  try {
    const { domainToggle } = await chrome.storage.sync.get([
      "domainToggle",
    ]);

    if (domainToggle === undefined || domainToggle === null) {
      return isSupportedHost();
    }

    if (typeof domainToggle === "boolean") {
      return domainToggle && isSupportedHost();
    }

    if (Array.isArray(domainToggle)) {
      return domainToggle.some((domain) =>
        matchesConfiguredDomain(domain),
      );
    }

    if (typeof domainToggle === "object") {
      const hostname = window.location.hostname;
      const configuredDomains = Object.entries(domainToggle)
        .filter(([, enabled]) => enabled === true)
        .map(([domain]) => domain);

      return configuredDomains.some((domain) =>
        matchesConfiguredDomain(domain, hostname),
      );
    }

    return isSupportedHost();
  } catch (error) {
    console.error("[AI Lexicon] Cannot read domain settings:", error);
    return false;
  }
}

function matchesConfiguredDomain(
  domain,
  hostname = window.location.hostname,
) {
  if (typeof domain !== "string" || !domain.trim()) {
    return false;
  }

  const normalizedDomain = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");

  const normalizedHost = hostname.toLowerCase();

  return (
    normalizedHost === normalizedDomain ||
    normalizedHost.endsWith(`.${normalizedDomain}`)
  );
}

/**
 * Tìm ô nhập liệu trên ChatGPT.
 */
function findComposerGPT() {
  return (
    document.querySelector("#prompt-textarea") ||
    document.querySelector('textarea[data-id="root"]') ||
    document.querySelector(
      '[contenteditable="true"][data-placeholder]',
    ) ||
    document.querySelector(
      '[contenteditable="true"][role="textbox"]',
    )
  );
}

/**
 * Tìm ô nhập liệu trên Gemini.
 */
function findComposerGemini() {
  return (
    document.querySelector(
      'div[contenteditable="true"][role="textbox"]',
    ) ||
    document.querySelector(
      'rich-textarea [contenteditable="true"]',
    ) ||
    document.querySelector("textarea")
  );
}

/**
 * Giữ tên hàm findComposer để tương thích code cũ.
 */
function findComposer() {
  if (window.location.hostname.includes("gemini.google.com")) {
    return findComposerGemini();
  }

  return findComposerGPT();
}

/**
 * Gán nội dung cho textarea hoặc contenteditable.
 */
function setComposerText(composer, text) {
  if (!composer || typeof text !== "string") {
    return false;
  }

  composer.focus();

  if (
    composer instanceof HTMLTextAreaElement ||
    composer instanceof HTMLInputElement
  ) {
    const prototype =
      composer instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;

    const setter = Object.getOwnPropertyDescriptor(
      prototype,
      "value",
    )?.set;

    if (setter) {
      setter.call(composer, text);
    } else {
      composer.value = text;
    }

    composer.dispatchEvent(
      new Event("input", { bubbles: true }),
    );

    composer.dispatchEvent(
      new Event("change", { bubbles: true }),
    );

    return true;
  }

  if (composer.isContentEditable) {
    composer.textContent = text;

    composer.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text,
      }),
    );

    return true;
  }

  return false;
}

/**
 * Gửi Enter vào ô chat.
 */
function submitComposer(composer) {
  if (!composer) {
    return false;
  }

  composer.focus();

  composer.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );

  return true;
}

/**
 * Đưa nội dung vào ô chat và gửi.
 */
function sendMessageToComposer(text) {
  const composer = findComposer();

  if (!composer) {
    console.warn("[AI Lexicon] Chat composer not found");
    return false;
  }

  if (!setComposerText(composer, text)) {
    console.warn("[AI Lexicon] Cannot set composer text");
    return false;
  }

  // Cho framework của trang xử lý sự kiện input trước khi gửi.
  setTimeout(() => submitComposer(composer), 100);

  return true;
}

/**
 * Các action tương thích với luồng message cũ của extension.
 */
const actionList = Object.freeze({
  doingGPT(message) {
    const text =
      typeof message === "string"
        ? message
        : message?.text;

    if (typeof text !== "string" || !text.trim()) {
      console.warn("[AI Lexicon] Empty message for doingGPT");
      return false;
    }

    return sendMessageToComposer(text);
  },

  async answerGPT(message) {
    const text =
      typeof message === "string"
        ? message
        : message?.text;

    if (typeof text !== "string" || !text.trim()) {
      console.warn("[AI Lexicon] Empty text for answerGPT");
      return null;
    }

    return askAiLexicon(text);
  },
});

/**
 * Gửi câu hỏi tới AI Lexicon thông qua background.js.
 *
 * background.js nhận:
 * {
 *   action: "aiLexiconCall",
 *   tool: "answer",
 *   arguments: { question: "..." }
 * }
 */
function askAiLexicon(
  question,
  tool = AI_LEXICON_CONFIG.defaultTool,
) {
  if (typeof question !== "string" || !question.trim()) {
    return Promise.reject(
      new Error("Question must not be empty"),
    );
  }

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: "aiLexiconCall",
        tool,
        arguments: {
          question: question.trim(),
        },
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(
            new Error(chrome.runtime.lastError.message),
          );
          return;
        }

        if (!response?.ok) {
          reject(
            new Error(
              response?.error ||
                "AI Lexicon request failed",
            ),
          );
          return;
        }

        resolve(response.result);
      },
    );
  });
}

/**
 * Lấy phần văn bản trong kết quả MCP.
 */
function extractMCPText(result) {
  if (!result) {
    return "";
  }

  if (typeof result === "string") {
    return result;
  }

  if (typeof result.structuredContent?.answer === "string") {
    return result.structuredContent.answer;
  }

  if (!Array.isArray(result.content)) {
    return "";
  }

  return result.content
    .filter((item) => item?.type === "text")
    .map((item) => item.text || "")
    .join("\n");
}

/**
 * Gửi nội dung clipboard sang AI Lexicon.
 *
 * Chỉ dùng hàm này khi muốn kiểm tra/đặt câu hỏi với
 * nội dung clipboard. Nó không tự động gửi câu trả lời
 * ngược vào ChatGPT/Gemini.
 */
async function handleCopiedText(text) {
  if (typeof text !== "string" || !text.trim()) {
    return null;
  }

  try {
    const result = await askAiLexicon(text);
    const answer = extractMCPText(result);

    console.info("[AI Lexicon] MCP result:", result);
    console.info("[AI Lexicon] Answer:", answer);

    // Cho các listener hoặc code khác dùng nếu cần.
    window.dispatchEvent(
      new CustomEvent("ai-lexicon-result", {
        detail: { result, answer },
      }),
    );

    return result;
  } catch (error) {
    console.error("[AI Lexicon] Request failed:", error);
    return null;
  }
}

/**
 * Đọc clipboard. Clipboard API có thể bị từ chối tùy
 * quyền và chính sách của trang/trình duyệt.
 */
async function readClipboardText() {
  if (!navigator.clipboard?.readText) {
    throw new Error("Clipboard readText API is unavailable");
  }

  return navigator.clipboard.readText();
}

/**
 * Tránh gửi cùng một đoạn clipboard liên tục.
 */
function isDuplicateClipboardText(text) {
  const now = Date.now();

  if (
    text === lastCopiedText &&
    now - lastCopiedAt < 1500
  ) {
    return true;
  }

  lastCopiedText = text;
  lastCopiedAt = now;

  return false;
}

/**
 * Đọc clipboard rồi chuyển sang AI Lexicon.
 */
async function processClipboard() {
  try {
    const text = await readClipboardText();

    if (!text?.trim() || isDuplicateClipboardText(text)) {
      return;
    }

    await handleCopiedText(text);
  } catch (error) {
    console.warn(
      "[AI Lexicon] Cannot read clipboard:",
      error.message,
    );
  }
}

/**
 * Lắng nghe nút copy của ChatGPT.
 */
function installCopyListenerGPT() {
  document.addEventListener(
    "click",
    (event) => {
      const target =
        event.target instanceof Element
          ? event.target
          : event.target?.parentElement;

      const copyButton = target?.closest(
        '[data-testid="copy-turn-action-button"]',
      );

      if (!copyButton) {
        return;
      }

      setTimeout(processClipboard, AI_LEXICON_CONFIG.copyDelay);
    },
    true,
  );
}

/**
 * Lắng nghe nút copy của Gemini.
 */
function installCopyListenerGemini() {
  document.addEventListener(
    "click",
    (event) => {
      const target =
        event.target instanceof Element
          ? event.target
          : event.target?.parentElement;

      const copyButton = target?.closest(
        '[data-mat-icon-name="copy"], button[aria-label*="Copy"], button[aria-label*="Sao chép"]',
      );

      if (!copyButton) {
        return;
      }

      setTimeout(processClipboard, AI_LEXICON_CONFIG.copyDelay);
    },
    true,
  );
}

/**
 * Đăng ký listener copy theo domain.
 */
function installCopyListeners() {
  if (copyListenersInstalled) {
    return;
  }

  copyListenersInstalled = true;

  if (window.location.hostname.includes("gemini.google.com")) {
    installCopyListenerGemini();
  } else {
    installCopyListenerGPT();
  }
}

/**
 * Nhận action từ background.js hoặc extension pages.
 */
function installRuntimeMessageListener() {
  chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {
      const handler = actionList[message?.action];

      if (typeof handler !== "function") {
        return false;
      }

      Promise.resolve()
        .then(() => handler(message))
        .then((result) => {
          sendResponse({
            ok: true,
            result,
          });
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error.message || "Action failed",
          });
        });

      return true;
    },
  );
}

/**
 * Khởi tạo content script.
 */
async function initializeContentScript() {
  if (aiLexiconInitialized) {
    return;
  }

  const enabled = await isDomainEnabled();

  if (!enabled) {
    console.info("[AI Lexicon] Disabled for this domain");
    return;
  }

  aiLexiconInitialized = true;

  installRuntimeMessageListener();
  installCopyListeners();

  console.info(
    "[AI Lexicon] Content script initialized:",
    window.location.hostname,
  );
}

if (document.readyState === "loading") {
  window.addEventListener(
    "DOMContentLoaded",
    initializeContentScript,
    { once: true },
  );
} else {
  initializeContentScript();
}


// Fill the ChatGPT composer when the MCP server sends its welcome notification.
function fillServerWelcome(message, attempts = 20) {
  if (!isSupportedHost() || !window.location.hostname.includes("chatgpt")) return;
  const composer = findComposerGPT();
  if (!composer) {
    if (attempts > 0) setTimeout(() => fillServerWelcome(message, attempts - 1), 500);
    return;
  }
  if (typeof message !== "string" || !message.trim()) return;
  const current = composer.isContentEditable
    ? (composer.innerText || composer.textContent || "")
    : (composer.value || "");
  if (current.includes(message)) return;
  setComposerText(composer, current.trim() ? current.trim() + "\n\n" + message : message);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "AI_LEXICON_WELCOME") fillServerWelcome(message.message);
});
